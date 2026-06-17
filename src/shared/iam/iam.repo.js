/**
 * IAM & Security repository (V2.2 §3 — IAM module).
 *
 * Pure database queries — no business logic, no side-effects. Every
 * function accepts either the shared pool (via `query()`) or an
 * explicit `client` for transactional work. Parameterised SQL only.
 *
 * Tables touched:
 *   shared.users, shared.staff_profiles, shared.contacts,
 *   shared.user_sessions, shared.user_roles, shared.roles,
 *   shared.permissions, shared.staff_invitations,
 *   shared.access_reviews, shared.access_review_entries,
 *   shared.audit_log
 */

"use strict";

const { query } = require("../../config/database");

// ── Dashboard stats ─────────────────────────────────────────

async function getSecurityStats(business) {
  // Failed logins in the last 24 hours, grouped by user
  const failedLoginsQ = query(
    `SELECT user_name, user_email, COUNT(*)::int AS count
       FROM shared.audit_log
      WHERE action = 'login'
        AND metadata->>'success' = 'false'
        AND occurred_at >= now() - interval '24 hours'
        AND business = $1
      GROUP BY user_name, user_email
      ORDER BY count DESC`,
    [business],
  );

  // Inactive accounts (last login > 90 days or never logged in)
  const inactiveQ = query(
    `SELECT COUNT(*)::int AS count
       FROM shared.users u
      WHERE u.status = 'active'
        AND NOT EXISTS (
          SELECT 1 FROM shared.audit_log a
           WHERE a.user_id = u.user_id AND a.action = 'login'
             AND a.occurred_at >= now() - interval '90 days'
        )`,
  );

  // Locked accounts
  const lockedQ = query(
    `SELECT COUNT(*)::int AS count
       FROM shared.users
      WHERE status = 'locked'`,
  );

  // Pending staff invitations
  const pendingInvitesQ = query(
    `SELECT COUNT(*)::int AS count
       FROM shared.staff_invitations
      WHERE status = 'pending'`,
  );

  // Users without MFA (active users with totp_enabled = false or null)
  const noMfaQ = query(
    `SELECT COUNT(*)::int AS count
       FROM shared.users
      WHERE status = 'active'
        AND (totp_enabled = false OR totp_enabled IS NULL)`,
  );

  // Total active users
  const totalUsersQ = query(
    `SELECT COUNT(*)::int AS count
       FROM shared.users
      WHERE status = 'active'`,
  );

  // Active sessions
  const activeSessionsQ = query(
    `SELECT COUNT(*)::int AS count
       FROM shared.user_sessions
      WHERE expires_at > now()`,
  );

  // Recent security events (last 20)
  const recentEventsQ = query(
    `SELECT log_id, occurred_at, user_id, user_name, user_email,
            action, table_name, record_id, metadata, ip_address
       FROM shared.audit_log
      WHERE business = $1
        AND action IN (
          'login','logout','permission_change','password_change',
          'secret_rotation','provision_login','deactivate_login',
          'invite_sent','account_created','admin_reset_password',
          'provision_external','reactivate_login','totp_enabled',
          'totp_disabled','access.grant_role','access.revoke_role',
          'access.set_permissions'
        )
      ORDER BY occurred_at DESC
      LIMIT 20`,
    [business],
  );

  const [
    failedLogins,
    inactive,
    locked,
    pendingInvites,
    noMfa,
    totalUsers,
    activeSessions,
    recentEvents,
  ] = await Promise.all([
    failedLoginsQ,
    inactiveQ,
    lockedQ,
    pendingInvitesQ,
    noMfaQ,
    totalUsersQ,
    activeSessionsQ,
    recentEventsQ,
  ]);

  return {
    failed_logins_24h: failedLogins.rows,
    inactive_accounts: inactive.rows[0].count,
    locked_accounts: locked.rows[0].count,
    pending_invites: pendingInvites.rows[0].count,
    users_without_mfa: noMfa.rows[0].count,
    total_users: totalUsers.rows[0].count,
    active_sessions: activeSessions.rows[0].count,
    recent_events: recentEvents.rows,
  };
}

// ── User management ─────────────────────────────────────────

async function listUsers({ business, search, status, page = 1, limit = 25 }) {
  const where = [];
  const params = [];
  let i = 1;

  // Filter to users who have access to this business
  where.push(`($${i} = ANY(u.permitted_businesses) OR u.is_ceo = true)`);
  params.push(business);
  i++;

  if (search) {
    where.push(
      `(u.email ILIKE $${i} OR u.display_name ILIKE $${i} OR c.display_name ILIKE $${i})`,
    );
    params.push(`%${search}%`);
    i++;
  }
  if (status) {
    where.push(`u.status = $${i}`);
    params.push(status);
    i++;
  }

  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const countQ = query(
    `SELECT count(*)::int AS total
       FROM shared.users u
       LEFT JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
       LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
       ${w}`,
    params,
  );

  const offset = (page - 1) * limit;
  const dataQ = query(
    `SELECT u.user_id, u.email,
            COALESCE(u.display_name, c.display_name) AS display_name,
            u.profile_type, u.external_label, u.status,
            COALESCE(u.totp_enabled, false) AS totp_enabled,
            (SELECT max(a.occurred_at) FROM shared.audit_log a
              WHERE a.user_id = u.user_id AND a.action = 'login') AS last_login_at,
            u.failed_login_count, u.is_ceo,
            u.permitted_businesses, u.default_business_key,
            sp.profile_id,
            r.role_name,
            r.role_id
       FROM shared.users u
       LEFT JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
       LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
       LEFT JOIN shared.user_roles ur ON ur.user_id = u.user_id
       LEFT JOIN shared.roles r ON r.role_id = ur.role_id
       ${w}
      ORDER BY u.created_at DESC
      LIMIT $${i} OFFSET $${i + 1}`,
    [...params, limit, offset],
  );

  const [countRes, dataRes] = await Promise.all([countQ, dataQ]);
  return {
    data: dataRes.rows,
    page,
    limit,
    total: countRes.rows[0].total,
  };
}

async function getUserDetail(userId) {
  const { rows } = await query(
    `SELECT u.user_id, u.email,
            COALESCE(u.display_name, c.display_name) AS display_name,
            u.profile_type, u.external_label, u.status,
            COALESCE(u.totp_enabled, false) AS totp_enabled,
            u.totp_verified_at,
            (SELECT max(a.occurred_at) FROM shared.audit_log a
              WHERE a.user_id = u.user_id AND a.action = 'login') AS last_login_at,
            u.failed_login_count, u.is_ceo,
            u.permitted_businesses, u.default_business_key,
            u.force_password_reset, u.created_at,
            sp.profile_id, sp.employee_number, sp.job_title,
            sp.business AS staff_business,
            c.display_name AS staff_display_name, c.email AS staff_email,
            c.primary_phone,
            COALESCE(
              (SELECT json_agg(json_build_object(
                'role_id', r.role_id,
                'role_name', r.role_name,
                'business', ur.business,
                'granted_at', ur.granted_at,
                'expires_at', ur.expires_at
              ))
              FROM shared.user_roles ur
              JOIN shared.roles r ON r.role_id = ur.role_id
              WHERE ur.user_id = u.user_id),
              '[]'::json
            ) AS roles
       FROM shared.users u
       LEFT JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
       LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
      WHERE u.user_id = $1`,
    [userId],
  );
  return rows[0] || null;
}

async function provisionStaffLogin(
  client,
  profileId,
  { email, password_hash, default_business, permitted_businesses },
) {
  const { rows } = await client.query(
    `INSERT INTO shared.users
       (staff_profile_id, email, password_hash, display_name,
        default_business_key, permitted_businesses, status,
        profile_type, force_password_reset)
     SELECT $1, $2, $3,
            COALESCE(c.display_name, $2),
            $4, $5, 'active', 'staff', true
       FROM shared.staff_profiles sp
       JOIN shared.contacts c ON c.contact_id = sp.contact_id
      WHERE sp.profile_id = $1
     RETURNING user_id, email, display_name, status, profile_type`,
    [profileId, email, password_hash, default_business, permitted_businesses],
  );
  return rows[0] || null;
}

async function provisionExternalUser(
  client,
  { email, password_hash, display_name, external_label, default_business, permitted_businesses },
) {
  const { rows } = await client.query(
    `INSERT INTO shared.users
       (email, password_hash, display_name, external_label,
        default_business_key, permitted_businesses, status,
        profile_type, force_password_reset)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', 'external', true)
     RETURNING user_id, email, display_name, status, profile_type, external_label`,
    [email, password_hash, display_name, external_label, default_business, permitted_businesses],
  );
  return rows[0];
}

async function deactivateUser(client, userId) {
  const { rows } = await client.query(
    `UPDATE shared.users
        SET status = 'disabled', updated_at = now()
      WHERE user_id = $1
     RETURNING user_id, email, status`,
    [userId],
  );
  // Also remove all tracked sessions
  await client.query(
    `DELETE FROM shared.user_sessions WHERE user_id = $1`,
    [userId],
  );
  return rows[0] || null;
}

async function reactivateUser(client, userId) {
  const { rows } = await client.query(
    `UPDATE shared.users
        SET status = 'active', failed_login_count = 0, updated_at = now()
      WHERE user_id = $1
     RETURNING user_id, email, status`,
    [userId],
  );
  return rows[0] || null;
}

async function updateUserStatus(userId, status) {
  const { rows } = await query(
    `UPDATE shared.users
        SET status = $2, updated_at = now()
      WHERE user_id = $1
     RETURNING user_id, email, status`,
    [userId, status],
  );
  return rows[0] || null;
}

async function findUserById(userId) {
  const { rows } = await query(
    `SELECT user_id, email, display_name, password_hash, status,
            is_ceo, permitted_businesses, default_business_key,
            COALESCE(totp_enabled, false) AS totp_enabled,
            totp_secret_enc, profile_type
       FROM shared.users
      WHERE user_id = $1`,
    [userId],
  );
  return rows[0] || null;
}

// ── Sessions ────────────────────────────────────────────────

async function createSession({
  session_id,
  user_id,
  ip_address,
  user_agent,
  device_label,
  expires_at,
}) {
  const { rows } = await query(
    `INSERT INTO shared.user_sessions
       (session_id, user_id, ip_address, user_agent, device_label, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [session_id, user_id, ip_address, user_agent, device_label, expires_at],
  );
  return rows[0];
}

async function listSessions(userId) {
  const { rows } = await query(
    `SELECT session_id, user_id, ip_address, user_agent, device_label,
            created_at, last_seen_at, expires_at
       FROM shared.user_sessions
      WHERE user_id = $1
      ORDER BY last_seen_at DESC NULLS LAST`,
    [userId],
  );
  return rows;
}

async function listAllSessions({ page = 1, limit = 25 }) {
  const offset = (page - 1) * limit;
  const countQ = query(
    `SELECT count(*)::int AS total FROM shared.user_sessions`,
  );
  const dataQ = query(
    `SELECT s.session_id, s.user_id, s.ip_address, s.user_agent,
            s.device_label, s.created_at, s.last_seen_at, s.expires_at,
            u.email, u.display_name
       FROM shared.user_sessions s
       JOIN shared.users u ON u.user_id = s.user_id
      ORDER BY s.last_seen_at DESC NULLS LAST
      LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  const [countRes, dataRes] = await Promise.all([countQ, dataQ]);
  return {
    data: dataRes.rows,
    page,
    limit,
    total: countRes.rows[0].total,
  };
}

async function touchSession(sessionId) {
  await query(
    `UPDATE shared.user_sessions SET last_seen_at = now() WHERE session_id = $1`,
    [sessionId],
  );
}

async function deleteSession(sessionId) {
  const { rowCount } = await query(
    `DELETE FROM shared.user_sessions WHERE session_id = $1`,
    [sessionId],
  );
  return rowCount > 0;
}

async function deleteUserSessions(userId) {
  const { rowCount } = await query(
    `DELETE FROM shared.user_sessions WHERE user_id = $1`,
    [userId],
  );
  return rowCount;
}

async function deleteExpiredSessions() {
  const { rowCount } = await query(
    `DELETE FROM shared.user_sessions WHERE expires_at < now()`,
  );
  return rowCount;
}

// ── Access reviews ──────────────────────────────────────────

async function listReviews({ business, status, page = 1, limit = 25 }) {
  const where = ["ar.business = $1"];
  const params = [business];
  let i = 2;

  if (status) {
    where.push(`ar.status = $${i}`);
    params.push(status);
    i++;
  }

  const w = `WHERE ${where.join(" AND ")}`;

  const countQ = query(
    `SELECT count(*)::int AS total FROM shared.access_reviews ar ${w}`,
    params,
  );

  const offset = (page - 1) * limit;
  const dataQ = query(
    `SELECT ar.review_id, ar.business, ar.title, ar.description,
            ar.status, ar.initiated_by, ar.initiated_at, ar.due_date,
            ar.completed_at, ar.completed_by, ar.summary_note,
            ar.created_at, ar.updated_at,
            u.email AS initiator_email, u.display_name AS initiator_name,
            (SELECT count(*)::int FROM shared.access_review_entries e
              WHERE e.review_id = ar.review_id) AS entry_count,
            (SELECT count(*)::int FROM shared.access_review_entries e
              WHERE e.review_id = ar.review_id AND e.decision = 'pending') AS pending_count
       FROM shared.access_reviews ar
       LEFT JOIN shared.users u ON u.user_id = ar.initiated_by
       ${w}
      ORDER BY ar.initiated_at DESC
      LIMIT $${i} OFFSET $${i + 1}`,
    [...params, limit, offset],
  );

  const [countRes, dataRes] = await Promise.all([countQ, dataQ]);
  return {
    data: dataRes.rows,
    page,
    limit,
    total: countRes.rows[0].total,
  };
}

async function getReview(reviewId) {
  const reviewQ = query(
    `SELECT ar.review_id, ar.business, ar.title, ar.description,
            ar.status, ar.initiated_by, ar.initiated_at, ar.due_date,
            ar.completed_at, ar.completed_by, ar.summary_note,
            ar.created_at, ar.updated_at,
            u.email AS initiator_email, u.display_name AS initiator_name
       FROM shared.access_reviews ar
       LEFT JOIN shared.users u ON u.user_id = ar.initiated_by
      WHERE ar.review_id = $1`,
    [reviewId],
  );

  const entriesQ = query(
    `SELECT e.entry_id, e.review_id, e.user_id, e.user_name, e.user_email,
            e.role_name, e.businesses, e.permissions_snapshot,
            e.decision, e.reviewer_note, e.decided_by, e.decided_at,
            e.created_at,
            du.display_name AS decider_name
       FROM shared.access_review_entries e
       LEFT JOIN shared.users du ON du.user_id = e.decided_by
      WHERE e.review_id = $1
      ORDER BY e.user_name ASC`,
    [reviewId],
  );

  const [reviewRes, entriesRes] = await Promise.all([reviewQ, entriesQ]);
  if (!reviewRes.rows[0]) return null;

  return { ...reviewRes.rows[0], entries: entriesRes.rows };
}

async function createReview(
  client,
  { business, title, description, due_date, initiated_by },
) {
  const { rows } = await client.query(
    `INSERT INTO shared.access_reviews
       (business, title, description, due_date, initiated_by, initiated_at, status)
     VALUES ($1, $2, $3, $4, $5, now(), 'open')
     RETURNING *`,
    [business, title, description || null, due_date || null, initiated_by],
  );
  return rows[0];
}

async function updateReview(client, reviewId, patch) {
  const sets = [];
  const params = [reviewId];
  let i = 2;

  if (patch.status !== undefined) {
    sets.push(`status = $${i}`);
    params.push(patch.status);
    i++;
  }
  if (patch.completed_at !== undefined) {
    sets.push(`completed_at = $${i}`);
    params.push(patch.completed_at);
    i++;
  }
  if (patch.completed_by !== undefined) {
    sets.push(`completed_by = $${i}`);
    params.push(patch.completed_by);
    i++;
  }
  if (patch.summary_note !== undefined) {
    sets.push(`summary_note = $${i}`);
    params.push(patch.summary_note);
    i++;
  }

  if (sets.length === 0) return null;
  sets.push("updated_at = now()");

  const { rows } = await client.query(
    `UPDATE shared.access_reviews SET ${sets.join(", ")} WHERE review_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function createReviewEntries(client, reviewId, entries) {
  if (!entries.length) return [];

  const values = [];
  const params = [reviewId];
  let i = 2;

  for (const e of entries) {
    values.push(
      `($1, $${i}, $${i + 1}, $${i + 2}, $${i + 3}, $${i + 4}, $${i + 5})`,
    );
    params.push(
      e.user_id,
      e.user_name,
      e.user_email,
      e.role_name,
      e.businesses,
      JSON.stringify(e.permissions_snapshot),
    );
    i += 6;
  }

  const { rows } = await client.query(
    `INSERT INTO shared.access_review_entries
       (review_id, user_id, user_name, user_email, role_name, businesses, permissions_snapshot)
     VALUES ${values.join(", ")}
     RETURNING *`,
    params,
  );
  return rows;
}

async function updateReviewEntry(client, entryId, { decision, reviewer_note, decided_by }) {
  const { rows } = await client.query(
    `UPDATE shared.access_review_entries
        SET decision = $2,
            reviewer_note = $3,
            decided_by = $4,
            decided_at = now()
      WHERE entry_id = $1
     RETURNING *`,
    [entryId, decision, reviewer_note || null, decided_by],
  );
  return rows[0] || null;
}

async function getReviewEntry(entryId) {
  const { rows } = await query(
    `SELECT * FROM shared.access_review_entries WHERE entry_id = $1`,
    [entryId],
  );
  return rows[0] || null;
}

async function getReviewExportData(reviewId) {
  const review = await getReview(reviewId);
  return review;
}

/**
 * Snapshot all active users with their roles and permissions for bulk
 * insertion into access_review_entries.
 */
async function snapshotActiveUsers(client, business) {
  const { rows } = await client.query(
    `SELECT u.user_id, COALESCE(u.display_name, c.display_name, u.email) AS user_name,
            u.email AS user_email,
            r.role_name,
            u.permitted_businesses AS businesses,
            COALESCE(
              (SELECT json_agg(json_build_object(
                'module', p.module, 'action', p.action, 'record_scope', p.record_scope
              ))
              FROM shared.permissions p WHERE p.role_id = ur.role_id),
              '[]'::json
            ) AS permissions_snapshot
       FROM shared.users u
       LEFT JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
       LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
       LEFT JOIN shared.user_roles ur ON ur.user_id = u.user_id
       LEFT JOIN shared.roles r ON r.role_id = ur.role_id
      WHERE u.status = 'active'
        AND ($1 = ANY(u.permitted_businesses) OR u.is_ceo = true)
      ORDER BY u.email`,
    [business],
  );
  return rows;
}

// ── TOTP ────────────────────────────────────────────────────

async function setTotpSecret(userId, secretEnc) {
  await query(
    `UPDATE shared.users SET totp_secret_enc = $2, updated_at = now() WHERE user_id = $1`,
    [userId, secretEnc],
  );
}

async function getTotpSecret(userId) {
  const { rows } = await query(
    `SELECT totp_secret_enc, COALESCE(totp_enabled, false) AS totp_enabled, email
       FROM shared.users WHERE user_id = $1`,
    [userId],
  );
  return rows[0] || null;
}

async function enableTotp(userId) {
  await query(
    `UPDATE shared.users
        SET totp_enabled = true, totp_verified_at = now(), updated_at = now()
      WHERE user_id = $1`,
    [userId],
  );
}

async function disableTotp(userId) {
  await query(
    `UPDATE shared.users
        SET totp_enabled = false, totp_secret_enc = NULL,
            totp_verified_at = NULL, updated_at = now()
      WHERE user_id = $1`,
    [userId],
  );
}

// ── Audit extensions ────────────────────────────────────────

async function queryAuditLog({
  business,
  module,
  action,
  user_id,
  start_date,
  end_date,
  is_sensitive,
  search,
  page = 1,
  limit = 50,
}) {
  const where = ["a.business = $1"];
  const params = [business];
  let i = 2;

  if (module) {
    where.push(`a.module = $${i}`);
    params.push(module);
    i++;
  }
  if (action) {
    where.push(`a.action = $${i}`);
    params.push(action);
    i++;
  }
  if (user_id) {
    where.push(`a.user_id = $${i}`);
    params.push(user_id);
    i++;
  }
  if (start_date) {
    where.push(`a.occurred_at >= $${i}`);
    params.push(start_date);
    i++;
  }
  if (end_date) {
    where.push(`a.occurred_at <= $${i}`);
    params.push(end_date);
    i++;
  }
  if (is_sensitive !== undefined && is_sensitive !== null) {
    where.push(`a.is_sensitive = $${i}`);
    params.push(is_sensitive);
    i++;
  }
  if (search) {
    where.push(
      `(a.user_name ILIKE $${i} OR a.user_email ILIKE $${i} OR a.action ILIKE $${i})`,
    );
    params.push(`%${search}%`);
    i++;
  }

  const w = `WHERE ${where.join(" AND ")}`;

  const countQ = query(
    `SELECT count(*)::int AS total FROM shared.audit_log a ${w}`,
    params,
  );

  const offset = (page - 1) * limit;
  const dataQ = query(
    `SELECT a.log_id, a.occurred_at, a.user_id, a.user_name, a.user_email,
            a.user_class, a.business, a.module, a.action,
            a.table_name, a.record_id,
            a.ip_address, a.session_id, a.is_sensitive, a.metadata
       FROM shared.audit_log a
       ${w}
      ORDER BY a.occurred_at DESC
      LIMIT $${i} OFFSET $${i + 1}`,
    [...params, limit, offset],
  );

  const [countRes, dataRes] = await Promise.all([countQ, dataQ]);
  return {
    data: dataRes.rows,
    page,
    limit,
    total: countRes.rows[0].total,
  };
}

async function getAuditEntry(logId) {
  const { rows } = await query(
    `SELECT * FROM shared.audit_log WHERE log_id = $1`,
    [logId],
  );
  return rows[0] || null;
}

async function getRecordTrail(tableName, recordId) {
  const { rows } = await query(
    `SELECT log_id, occurred_at, user_id, user_name, action,
            before_state, after_state, metadata
       FROM shared.audit_log
      WHERE table_name = $1 AND record_id = $2
      ORDER BY occurred_at ASC`,
    [tableName, recordId],
  );
  return rows;
}

async function exportAuditLog({
  business,
  module,
  action,
  user_id,
  start_date,
  end_date,
  is_sensitive,
  search,
}) {
  const where = ["a.business = $1"];
  const params = [business];
  let i = 2;

  if (module) {
    where.push(`a.module = $${i}`);
    params.push(module);
    i++;
  }
  if (action) {
    where.push(`a.action = $${i}`);
    params.push(action);
    i++;
  }
  if (user_id) {
    where.push(`a.user_id = $${i}`);
    params.push(user_id);
    i++;
  }
  if (start_date) {
    where.push(`a.occurred_at >= $${i}`);
    params.push(start_date);
    i++;
  }
  if (end_date) {
    where.push(`a.occurred_at <= $${i}`);
    params.push(end_date);
    i++;
  }
  if (is_sensitive !== undefined && is_sensitive !== null) {
    where.push(`a.is_sensitive = $${i}`);
    params.push(is_sensitive);
    i++;
  }
  if (search) {
    where.push(
      `(a.user_name ILIKE $${i} OR a.user_email ILIKE $${i} OR a.action ILIKE $${i})`,
    );
    params.push(`%${search}%`);
    i++;
  }

  const w = `WHERE ${where.join(" AND ")}`;
  const { rows } = await query(
    `SELECT a.log_id, a.occurred_at, a.user_id, a.user_name, a.user_email,
            a.user_class, a.business, a.module, a.action,
            a.table_name, a.record_id,
            a.before_state, a.after_state,
            a.ip_address, a.user_agent, a.session_id,
            a.is_sensitive, a.metadata
       FROM shared.audit_log a
       ${w}
      ORDER BY a.occurred_at DESC`,
    params,
  );
  return rows;
}

// ── Password helpers ────────────────────────────────────────

async function updatePassword(client, userId, passwordHash) {
  await client.query(
    `UPDATE shared.users
        SET password_hash = $2,
            failed_login_count = 0,
            force_password_reset = true,
            updated_at = now()
      WHERE user_id = $1`,
    [userId, passwordHash],
  );
}

module.exports = {
  // Dashboard
  getSecurityStats,
  // Users
  listUsers,
  getUserDetail,
  provisionStaffLogin,
  provisionExternalUser,
  deactivateUser,
  reactivateUser,
  updateUserStatus,
  findUserById,
  updatePassword,
  // Sessions
  createSession,
  listSessions,
  listAllSessions,
  touchSession,
  deleteSession,
  deleteUserSessions,
  deleteExpiredSessions,
  // Access reviews
  listReviews,
  getReview,
  createReview,
  updateReview,
  createReviewEntries,
  updateReviewEntry,
  getReviewEntry,
  getReviewExportData,
  snapshotActiveUsers,
  // TOTP
  setTotpSecret,
  getTotpSecret,
  enableTotp,
  disableTotp,
  // Audit
  queryAuditLog,
  getAuditEntry,
  getRecordTrail,
  exportAuditLog,
};
