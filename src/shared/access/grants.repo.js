/**
 * Grants repository (V2.2 §3 — RBAC).
 * Parameterised SQL only. Tables: shared.user_roles, shared.users.
 *
 * A grant is (user_id, role_id, business) — business '*' means all brands.
 * Brand access is the user's shared.users.permitted_businesses array plus
 * default_business.
 */

"use strict";

const { ex: exec } = require("../../config/database");
async function userExists({ client, user_id }) {
  const { rows } = await exec(client)(
    `SELECT user_id, email, is_active, permitted_businesses, default_business
       FROM shared.users WHERE user_id = $1 LIMIT 1`,
    [user_id],
  );
  return rows[0] || null;
}

/** A user's role grants, with role names resolved. */
async function listUserRoles({ client, user_id }) {
  const { rows } = await exec(client)(
    `SELECT ur.user_id, ur.role_id, ur.business, ur.granted_by,
            ur.granted_at, ur.expires_at,
            r.role_name, r.is_system
       FROM shared.user_roles ur
       JOIN shared.roles r ON r.role_id = ur.role_id
      WHERE ur.user_id = $1
      ORDER BY r.is_system DESC, r.role_name ASC`,
    [user_id],
  );
  return rows;
}

/**
 * Login users who can be granted a role in `business` — i.e. those who already
 * have access to it — each with their current role_ids so the bulk-assign
 * picker can flag people who already hold the role. Roles attach to login
 * accounts (shared.users), never to bare staff_profiles, so this is the correct
 * candidate set. `search` matches email or display name (user or contact).
 */
async function listGrantableUsers({ client, business, search }) {
  const params = [business];
  let filter = "";
  if (search) {
    filter = ` AND (u.email ILIKE $2 OR u.display_name ILIKE $2 OR c.display_name ILIKE $2)`;
    params.push(`%${search}%`);
  }
  const { rows } = await exec(client)(
    `SELECT u.user_id, u.email,
            COALESCE(u.display_name, c.display_name) AS display_name,
            u.profile_type, u.status, u.external_label,
            sp.profile_id, sp.job_title,
            COALESCE(
              (SELECT array_agg(ur.role_id::text)
                 FROM shared.user_roles ur
                WHERE ur.user_id = u.user_id),
              '{}'::text[]
            ) AS role_ids
       FROM shared.users u
       LEFT JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
       LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
      WHERE $1 = ANY(u.permitted_businesses)${filter}
      ORDER BY COALESCE(u.display_name, c.display_name, u.email) ASC
      LIMIT 500`,
    params,
  );
  return rows;
}

/** Users holding a given role (for the role detail view). */
async function listRoleMembers({ client, role_id }) {
  const { rows } = await exec(client)(
    `SELECT ur.user_id, ur.business, ur.granted_at, ur.expires_at,
            u.email, u.is_active
       FROM shared.user_roles ur
       JOIN shared.users u ON u.user_id = ur.user_id
      WHERE ur.role_id = $1
      ORDER BY u.email ASC`,
    [role_id],
  );
  return rows;
}

async function grantRole({
  client,
  user_id,
  role_id,
  business,
  granted_by,
  expires_at,
}) {
  const { rows } = await exec(client)(
    `INSERT INTO shared.user_roles
       (user_id, role_id, business, granted_by, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, role_id, business)
     DO UPDATE SET granted_by = EXCLUDED.granted_by,
                   granted_at = now(),
                   expires_at = EXCLUDED.expires_at
     RETURNING *`,
    [user_id, role_id, business, granted_by ?? null, expires_at ?? null],
  );
  return rows[0];
}

async function revokeRole({ client, user_id, role_id, business }) {
  const { rowCount } = await exec(client)(
    `DELETE FROM shared.user_roles
      WHERE user_id = $1 AND role_id = $2 AND business = $3`,
    [user_id, role_id, business],
  );
  return rowCount > 0;
}

/** Does this user currently hold this role for this business (or '*')? */
async function hasRole({ client, user_id, role_id }) {
  const { rows } = await exec(client)(
    `SELECT 1 FROM shared.user_roles
      WHERE user_id = $1 AND role_id = $2
        AND (expires_at IS NULL OR expires_at > now())
      LIMIT 1`,
    [user_id, role_id],
  );
  return rows.length > 0;
}

// ── brand access ───────────────────────────────────────────

async function getUserAccess({ client, user_id }) {
  const { rows } = await exec(client)(
    `SELECT user_id, email, is_active, permitted_businesses, default_business
       FROM shared.users WHERE user_id = $1 LIMIT 1`,
    [user_id],
  );
  return rows[0] || null;
}

async function setUserAccess({
  client,
  user_id,
  permitted_businesses,
  default_business,
}) {
  const { rows } = await exec(client)(
    `UPDATE shared.users
        SET permitted_businesses = COALESCE($2::text[], permitted_businesses),
            default_business      = COALESCE($3, default_business)
      WHERE user_id = $1
      RETURNING user_id, email, is_active, permitted_businesses, default_business`,
    [user_id, permitted_businesses ?? null, default_business ?? null],
  );
  return rows[0] || null;
}

/** Count distinct users actively holding a role (for last-owner protection). */
async function countActiveRoleHolders({ client, role_id }) {
  const { rows } = await exec(client)(
    `SELECT count(DISTINCT ur.user_id)::int AS n
       FROM shared.user_roles ur
       JOIN shared.users u ON u.user_id = ur.user_id
      WHERE ur.role_id = $1
        AND u.is_active = true
        AND (ur.expires_at IS NULL OR ur.expires_at > now())`,
    [role_id],
  );
  return rows[0].n;
}

/** Configured brand keys, for validating grant/access business values. */
async function validBrands({ client }) {
  const { rows } = await exec(client)(
    `SELECT business_key FROM shared.business_config`,
  );
  return rows.map((r) => r.business_key);
}

module.exports = {
  userExists,
  listUserRoles,
  listGrantableUsers,
  listRoleMembers,
  grantRole,
  revokeRole,
  hasRole,
  getUserAccess,
  setUserAccess,
  countActiveRoleHolders,
  validBrands,
};
