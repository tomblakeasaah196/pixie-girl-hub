/**
 * Identity & Access Administration routes (V2.2 §3 — RBAC).
 * Mounted at /api/v1/access. Gated on the `settings` permission; the
 * owner/CEO bypasses all permission checks. Auth + brand context are applied
 * upstream at the /api/v1 mount.
 *
 *   /catalog                              the module×action grid for the matrix
 *   /roles, /roles/:id                    role definitions
 *   /roles/:id/permissions                the role's permission matrix
 *   /users/:id/roles, .../roles/:role_id  user-role grants
 *   /users/:id/access                     per-user brand access
 */

"use strict";

const express = require("express");
const controller = require("./access.controller");
const validator = require("./access.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();

// ── catalog ────────────────────────────────────────────────
router.get(
  "/catalog",
  requirePermission("settings", "view"),
  controller.getCatalog,
);

// ── roles ──────────────────────────────────────────────────
router.get(
  "/roles",
  requirePermission("settings", "view"),
  controller.listRoles,
);
router.post(
  "/roles",
  requirePermission("settings", "create"),
  validator.validateRoleCreate,
  controller.createRole,
);
router.get(
  "/roles/:role_id",
  requirePermission("settings", "view"),
  controller.getRole,
);
router.patch(
  "/roles/:role_id",
  requirePermission("settings", "edit"),
  validator.validateRoleUpdate,
  controller.updateRole,
);
router.delete(
  "/roles/:role_id",
  requirePermission("settings", "delete"),
  controller.deleteRole,
);

// ── permission matrix ──────────────────────────────────────
router.get(
  "/roles/:role_id/permissions",
  requirePermission("settings", "view"),
  controller.getRolePermissions,
);
router.put(
  "/roles/:role_id/permissions",
  requirePermission("settings", "edit"),
  validator.validatePermissions,
  controller.setRolePermissions,
);

// ── contact-type visibility (contacts §6.12) ───────────────
router.get(
  "/roles/:role_id/contact-types",
  requirePermission("settings", "view"),
  controller.getRoleContactTypes,
);
router.put(
  "/roles/:role_id/contact-types",
  requirePermission("settings", "edit"),
  validator.validateContactTypes,
  controller.setRoleContactTypes,
);

// ── user-role grants ───────────────────────────────────────
router.get(
  "/users/:user_id/roles",
  requirePermission("settings", "view"),
  controller.listUserRoles,
);
router.post(
  "/users/:user_id/roles",
  requirePermission("settings", "create"),
  validator.validateGrantRole,
  controller.grantUserRole,
);
router.delete(
  "/users/:user_id/roles/:role_id",
  requirePermission("settings", "delete"),
  validator.validateRevokeQuery,
  controller.revokeUserRole,
);

// ── brand access ───────────────────────────────────────────
router.get(
  "/users/:user_id/access",
  requirePermission("settings", "view"),
  controller.getUserAccess,
);
router.put(
  "/users/:user_id/access",
  requirePermission("settings", "edit"),
  validator.validateUserAccess,
  controller.setUserAccess,
);

module.exports = router;
