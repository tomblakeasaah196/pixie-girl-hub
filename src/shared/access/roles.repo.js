/**
 * Roles & permissions repository (V2.2 §3 — RBAC).
 * Parameterised SQL only. Tables: shared.roles, shared.permissions.
 *
 * Roles are system-wide (business IS NULL) or brand-scoped. The permission
 * matrix for a role is the set of shared.permissions rows it holds; saving the
 * matrix is a delete-then-insert within one transaction.
 */

"use strict";

const { ex: exec } = require("../../config/database");
const ROLE_WRITE_COLS = ["role_name", "description", "business"];

/** System roles (business IS NULL) plus roles scoped to this brand. */
async function listRoles({ client, business }) {
  const { rows } = await exec(client)(
    `SELECT r.*,
            (SELECT count(*)::int FROM shared.user_roles ur WHERE ur.role_id = r.role_id) AS member_count,
            (SELECT count(*)::int FROM shared.permissions p  WHERE p.role_id  = r.role_id) AS permission_count
       FROM shared.roles r
      WHERE r.business IS NULL OR r.business = $1
      ORDER BY r.is_system DESC, r.role_name ASC`,
    [business],
  );
  return rows;
}

async function findRole({ client, role_id }) {
  const { rows } = await exec(client)(
    `SELECT * FROM shared.roles WHERE role_id = $1 LIMIT 1`,
    [role_id],
  );
  return rows[0] || null;
}

async function findRoleByName({ client, role_name, business }) {
  const { rows } = await exec(client)(
    `SELECT * FROM shared.roles
      WHERE role_name = $1 AND business IS NOT DISTINCT FROM $2
      LIMIT 1`,
    [role_name, business ?? null],
  );
  return rows[0] || null;
}

async function createRole({ client, role_name, description, business }) {
  const { rows } = await exec(client)(
    `INSERT INTO shared.roles (role_name, description, business, is_system)
     VALUES ($1, $2, $3, false)
     RETURNING *`,
    [role_name, description ?? null, business ?? null],
  );
  return rows[0];
}

async function updateRole({ client, role_id, patch }) {
  const sets = [];
  const params = [];
  let i = 1;
  for (const col of ROLE_WRITE_COLS) {
    if (patch[col] === undefined) continue;
    sets.push(`${col} = $${i++}`);
    params.push(patch[col]);
  }
  if (sets.length === 0) return findRole({ client, role_id });
  params.push(role_id);
  const { rows } = await exec(client)(
    `UPDATE shared.roles SET ${sets.join(", ")} WHERE role_id = $${i} RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function deleteRole({ client, role_id }) {
  // shared.permissions + shared.user_roles cascade on role delete.
  await exec(client)(`DELETE FROM shared.roles WHERE role_id = $1`, [role_id]);
}

// ── permission matrix ──────────────────────────────────────

async function listPermissions({ client, role_id }) {
  const { rows } = await exec(client)(
    `SELECT permission_id, module, action, record_scope, hidden_fields
       FROM shared.permissions
      WHERE role_id = $1
      ORDER BY module ASC, action ASC`,
    [role_id],
  );
  return rows;
}

/** Replace a role's entire matrix atomically (delete-then-insert). */
async function replacePermissions({ client, role_id, grants }) {
  const run = exec(client);
  await run(`DELETE FROM shared.permissions WHERE role_id = $1`, [role_id]);
  for (const g of grants) {
    await run(
      `INSERT INTO shared.permissions
         (role_id, module, action, record_scope, hidden_fields)
       VALUES ($1, $2, $3, $4, $5::text[])`,
      [
        role_id,
        g.module,
        g.action,
        g.record_scope || "all",
        g.hidden_fields || [],
      ],
    );
  }
  return listPermissions({ client, role_id });
}

module.exports = {
  listRoles,
  findRole,
  findRoleByName,
  createRole,
  updateRole,
  deleteRole,
  listPermissions,
  replacePermissions,
};
