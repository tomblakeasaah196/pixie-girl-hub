/**
 * Staff invitations repository (F-15). Shared tables: shared.staff_invitations,
 * shared.users, shared.user_roles. Parameterised SQL only.
 */

"use strict";

const { query } = require("../../config/database");

const ex = (c) => (c ? c.query.bind(c) : query);

async function createInvite({ invite }) {
  const { rows } = await query(
    `INSERT INTO shared.staff_invitations
       (email, display_name, token_hash, role_ids, business_keys,
        default_business, is_ceo, staff_profile_id, invited_by, expires_at)
     VALUES ($1,$2,$3,$4::uuid[],$5::text[],$6,COALESCE($7,false),$8,$9,$10)
     RETURNING *`,
    [
      invite.email,
      invite.display_name || null,
      invite.token_hash,
      invite.role_ids || [],
      invite.business_keys || [],
      invite.default_business || null,
      invite.is_ceo === undefined ? null : invite.is_ceo,
      invite.staff_profile_id || null,
      invite.invited_by || null,
      invite.expires_at,
    ],
  );
  return rows[0];
}

async function listInvites({ status, page = 1, page_size = 50 }) {
  const where = [];
  const params = [];
  let i = 1;
  if (status) {
    where.push(`status = $${i++}`);
    params.push(status);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows: c } = await query(
    `SELECT count(*)::int AS total FROM shared.staff_invitations ${w}`,
    params,
  );
  const offset = (page - 1) * page_size;
  const { rows } = await query(
    `SELECT invitation_id, email, display_name, role_ids, business_keys,
            default_business, is_ceo, status, invited_by, expires_at,
            accepted_at, accepted_user_id, created_at
       FROM shared.staff_invitations ${w}
      ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i}`,
    [...params, page_size, offset],
  );
  return { data: rows, page, page_size, total: c[0].total };
}

async function getById({ id }) {
  const { rows } = await query(
    `SELECT * FROM shared.staff_invitations WHERE invitation_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function getByTokenHash({ client, token_hash }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.staff_invitations WHERE token_hash = $1`,
    [token_hash],
  );
  return rows[0] || null;
}

async function setStatus({ client, id, status, fields = {} }) {
  const set = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [col, val] of Object.entries(fields)) {
    set.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE shared.staff_invitations SET ${set.join(", ")}, updated_at = now()
      WHERE invitation_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── users / roles (accept) ────────────────────────────────
async function userExistsByEmail({ client, email }) {
  const { rows } = await ex(client)(
    `SELECT user_id FROM shared.users WHERE email = $1 LIMIT 1`,
    [email],
  );
  return rows[0] || null;
}

async function createUser({ client, user }) {
  // status='active' drives is_active via the 000113 sync trigger; permitted_businesses
  // drives shared.user_business_access via the same migration's AFTER trigger.
  const { rows } = await ex(client)(
    `INSERT INTO shared.users
       (email, password_hash, display_name, status, is_ceo,
        default_business, permitted_businesses, force_password_reset)
     VALUES ($1,$2,$3,'active',COALESCE($4,false),$5,$6::text[],false)
     RETURNING user_id, email`,
    [
      user.email,
      user.password_hash,
      user.display_name || null,
      user.is_ceo === undefined ? null : user.is_ceo,
      user.default_business || null,
      user.permitted_businesses || [],
    ],
  );
  return rows[0];
}

async function assignRole({ client, user_id, role_id, business, granted_by }) {
  await ex(client)(
    `INSERT INTO shared.user_roles (user_id, role_id, business, granted_by)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id, role_id, business) DO NOTHING`,
    [user_id, role_id, business, granted_by || null],
  );
}

module.exports = {
  createInvite,
  listInvites,
  getById,
  getByTokenHash,
  setStatus,
  userExistsByEmail,
  createUser,
  assignRole,
};
