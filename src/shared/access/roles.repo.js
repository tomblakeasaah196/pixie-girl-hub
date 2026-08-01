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

// ── contact-type visibility (contacts §6.12) ───────────────
// A role's allow-list of contact_type values it may see, in
// shared.role_contact_type_access. NO row = unrestricted (sees every type);
// a row restricts the role to its listed types (empty = sees none).

/** A role's contact-type access row, or null when the role is unrestricted. */
async function getContactTypeAccess({ client, role_id }) {
  const { rows } = await exec(client)(
    `SELECT contact_types, updated_by, updated_at
       FROM shared.role_contact_type_access
      WHERE role_id = $1
      LIMIT 1`,
    [role_id],
  );
  return rows[0] || null;
}

/** Restrict a role to `contact_types` (upsert). Empty array = sees no contacts. */
async function setContactTypeAccess({ client, role_id, contact_types, updated_by }) {
  const { rows } = await exec(client)(
    `INSERT INTO shared.role_contact_type_access (role_id, contact_types, updated_by)
     VALUES ($1, $2::text[], $3)
     ON CONFLICT (role_id) DO UPDATE
       SET contact_types = EXCLUDED.contact_types,
           updated_by    = EXCLUDED.updated_by,
           updated_at    = now()
     RETURNING contact_types, updated_by, updated_at`,
    [role_id, contact_types, updated_by ?? null],
  );
  return rows[0];
}

/** Remove a role's restriction row → the role becomes unrestricted again. */
async function clearContactTypeAccess({ client, role_id }) {
  const { rowCount } = await exec(client)(
    `DELETE FROM shared.role_contact_type_access WHERE role_id = $1`,
    [role_id],
  );
  return rowCount > 0;
}

/**
 * Effective contact-type visibility for a set of roles (the union model).
 *   → null      when ANY role is unrestricted (no row) — sees every type.
 *   → string[]  the deduped union of the restricted roles' allowed types
 *               ([] means every role is restricted to nothing → sees none).
 * An empty role set returns [] (no roles ⇒ no contact access), though the
 * RBAC permission check 403s such a caller before this is consulted.
 */
async function contactTypesForRoles({ client, role_ids }) {
  if (!Array.isArray(role_ids) || role_ids.length === 0) return [];
  const { rows } = await exec(client)(
    `SELECT role_id, contact_types
       FROM shared.role_contact_type_access
      WHERE role_id = ANY($1::uuid[])`,
    [role_ids],
  );
  const managed = new Map(rows.map((r) => [r.role_id, r.contact_types || []]));
  // Any role without a row is unrestricted → the whole set is unrestricted.
  if (role_ids.some((id) => !managed.has(id))) return null;
  const union = new Set();
  for (const types of managed.values()) for (const t of types) union.add(t);
  return [...union];
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
  getContactTypeAccess,
  setContactTypeAccess,
  clearContactTypeAccess,
  contactTypesForRoles,
};
