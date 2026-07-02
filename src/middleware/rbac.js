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
 *       action       = 'view' | 'create' | 'edit' | 'delete' | 'approve' | 'export' | 'publish'
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
const identityCache = require("../shared/cache/identity-cache");

const VALID_ACTIONS = new Set([
  "view",
  "create",
  "edit",
  "delete",
  "approve",
  "export",
  "publish",
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

    // Cached (30 s TTL; permission edits invalidate every grants entry) —
    // saves a DB round-trip on every permission-gated request.
    const grants = await identityCache.getGrants({
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
