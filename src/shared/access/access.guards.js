/**
 * Access escalation guards (V2.2 §3 — RBAC).
 *
 * Pure functions (throw on violation). Two foundational protections hold no
 * matter who the actor is — they underpin the whole permission model:
 *   - the `owner` role can never be DELETED (it is the CEO/superuser role), and
 *   - only the owner (is_ceo) may GRANT or REVOKE the `owner` role, so no one
 *     can promote themselves (or anyone else) to CEO.
 *
 * Per owner directive (2026-07): editing a role's definition/permissions and
 * deleting a NON-owner role — including seeded SYSTEM roles — are governed by
 * the route-level `settings` permission alone. There is no extra owner-only
 * lock on system roles. (Reverting to owner-only is a one-function change here
 * plus the matching UI gate.) The Access UI surfaces the risk of editing or
 * deleting a seeded role and requires an explicit confirmation before deleting.
 */

"use strict";

const { PermissionDeniedError, ConflictError } = require("../../utils/errors");

// Seeded owner role (shared.roles) — the CEO/superuser role.
const OWNER_ROLE_ID = "11111111-1111-1111-1111-000000000001";

const isOwnerActor = (actor) => Boolean(actor && actor.is_ceo);
const isOwnerRole = (role) => role && role.role_id === OWNER_ROLE_ID;

// Editing a role's name/description. Gated by settings:edit at the route;
// system roles carry no extra lock (owner directive).
function assertCanMutateRole(_actor, _role) {
  // intentionally permissive — see file header.
}

// Deleting a role. A settings admin may delete any role EXCEPT the foundational
// `owner` role, which the CEO-bypass model depends on.
function assertCanDeleteRole(_actor, role) {
  if (isOwnerRole(role)) {
    throw new ConflictError("The owner role cannot be deleted");
  }
}

// Editing a role's permission matrix. Gated by settings:edit at the route;
// system roles carry no extra lock (owner directive).
function assertCanEditPermissions(_actor, _role) {
  // intentionally permissive — see file header.
}

function assertCanGrantRole(actor, role) {
  if (isOwnerRole(role) && !isOwnerActor(actor)) {
    throw new PermissionDeniedError("Only the owner can grant the owner role");
  }
}

function assertCanRevokeRole(actor, role) {
  if (isOwnerRole(role) && !isOwnerActor(actor)) {
    throw new PermissionDeniedError("Only the owner can revoke the owner role");
  }
}

module.exports = {
  OWNER_ROLE_ID,
  isOwnerActor,
  isOwnerRole,
  assertCanMutateRole,
  assertCanDeleteRole,
  assertCanEditPermissions,
  assertCanGrantRole,
  assertCanRevokeRole,
};
