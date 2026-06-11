/**
 * RBAC middleware (V2.2 §3 — module / action / record / field controls).
 *
 * Usage:
 *   router.post(
 *     '/orders',
 *     authMiddleware,
 *     brandContextMiddleware,
 *     requirePermission('sales', 'create'),
 *     controller.createOrder
 *   );
 *
 * Permission table layout:
 *   shared.permissions(role_id, module, action, record_scope, allowed)
 *     where:
 *       module       = 'sales' (matches shared.permission_module_keys)
 *       action       = 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'export'
 *       record_scope = 'all' | 'own' | 'team'
 *
 * The scope ('own' / 'team') is enforced inside the repository layer,
 * because it requires SQL WHERE filters specific to each table.
 * This middleware only checks module × action allow/deny.
 *
 * CEO bypasses checks.
 */

"use strict";

const { AppError } = require("../utils/errors");
const permissionsRepo = require("../shared/org_workflow/permissions.repo");

const VALID_ACTIONS = new Set([
  "view",
  "create",
  "edit",
  "delete",
  "approve",
  "export",
]);

function requirePermission(moduleKey, action) {
  if (!moduleKey || typeof moduleKey !== "string") {
    throw new Error("requirePermission: moduleKey required");
  }
  if (!action || !VALID_ACTIONS.has(action)) {
    throw new Error(`requirePermission: invalid action "${action}"`);
  }

  return async function rbacCheck(req, _res, next) {
    if (!req.user) {
      throw new AppError("AUTH_REQUIRED", "Authentication required", 401);
    }

    // CEO bypass (V2.2 §3 — CEO sees everything by design)
    if (req.user.is_ceo) {
      req.permission_scope = "all";
      return next();
    }

    const grants = await permissionsRepo.findGrants({
      role_ids: req.user.role_ids,
      module: moduleKey,
      action,
    });

    if (!grants || grants.length === 0) {
      throw new AppError(
        "PERMISSION_DENIED",
        `No permission for ${moduleKey}.${action}`,
        403,
      );
    }

    // Use the most permissive scope they hold
    const scope = grants.some((g) => g.record_scope === "all")
      ? "all"
      : grants.some((g) => g.record_scope === "team")
        ? "team"
        : "own";

    req.permission_scope = scope;
    return next();
  };
}

module.exports = { requirePermission };
