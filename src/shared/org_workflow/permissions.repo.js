/**
 * Permissions repository (V2.2 §3 — RBAC).
 *
 * Backs the `requirePermission` middleware. A grant EXISTS row means the
 * role is allowed that module × action; the row's record_scope drives
 * the 'all' | 'team' | 'own' filtering done in each module's repo.
 *
 * Table: shared.permissions (role_id, module, action, record_scope, hidden_fields)
 */

"use strict";

const { query } = require("../../config/database");

/**
 * Return the grant rows a set of roles holds for one module × action.
 * Empty array = denied.
 *
 * @param {object}   opts
 * @param {string[]} opts.role_ids  Role UUIDs the user holds.
 * @param {string}   opts.module    Module key (e.g. 'sales_campaigns').
 * @param {string}   opts.action    'view'|'create'|'edit'|'delete'|'approve'|'export'
 * @returns {Promise<Array<{role_id, module, action, record_scope, hidden_fields}>>}
 */
async function findGrants({ role_ids, module, action }) {
  if (!Array.isArray(role_ids) || role_ids.length === 0) return [];
  const { rows } = await query(
    `SELECT role_id, module, action, record_scope, hidden_fields
       FROM shared.permissions
      WHERE role_id = ANY($1::uuid[])
        AND module = $2
        AND action = $3`,
    [role_ids, module, action],
  );
  return rows;
}

/**
 * Union of hidden_fields for a role-set on a module (field-level privacy).
 * Used by services to strip sensitive columns before serialisation.
 */
async function findHiddenFields({ role_ids, module }) {
  if (!Array.isArray(role_ids) || role_ids.length === 0) return [];
  const { rows } = await query(
    `SELECT DISTINCT unnest(hidden_fields) AS field
       FROM shared.permissions
      WHERE role_id = ANY($1::uuid[]) AND module = $2`,
    [role_ids, module],
  );
  return rows.map((r) => r.field);
}

/**
 * All distinct grants a set of roles holds (all modules × actions).
 * Used by GET /auth/me/permissions to let the frontend gate the app grid.
 */
async function findAllForRoles({ role_ids }) {
  if (!Array.isArray(role_ids) || role_ids.length === 0) return [];
  const { rows } = await query(
    `SELECT DISTINCT module, action, record_scope
       FROM shared.permissions
      WHERE role_id = ANY($1::uuid[])
      ORDER BY module, action`,
    [role_ids],
  );
  return rows;
}

module.exports = { findGrants, findHiddenFields, findAllForRoles };
