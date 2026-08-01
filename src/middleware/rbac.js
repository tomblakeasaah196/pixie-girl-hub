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

/**
 * The role IDs that apply under the current brand context. A role grant carries
 * the business it was made for ('*' = all brands) and must not apply under
 * another brand; cached projections that predate role_grants fall back to the
 * unscoped role set (30 s TTL, so the window is brief). Shared by the
 * permission check and the contact-type scope so the two never diverge on which
 * roles count for a request.
 */
function activeRoleIds(req) {
  const roleGrants = Array.isArray(req.user?.role_grants)
    ? req.user.role_grants
    : null;
  return req.brand && roleGrants
    ? [
        ...new Set(
          roleGrants
            .filter((g) => g.business === "*" || g.business === req.brand)
            .map((g) => g.role_id),
        ),
      ]
    : req.user?.role_ids || [];
}

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

    // Brand-scoped roles: only the grants valid under this brand context count.
    const role_ids = activeRoleIds(req);

    // Cached (30 s TTL; permission edits invalidate every grants entry) —
    // saves a DB round-trip on every permission-gated request.
    const grants = await identityCache.getGrants({
      role_ids,
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

/**
 * Approve-gated read visibility — for finance queues (expenses §6.7, cash
 * requests §6.32) where seeing OTHER people's records is a supervisor
 * privilege, not a side effect of holding `view`.
 *
 * A plain `view` grant — at ANY record_scope, including the historically
 * unenforced 'team' — is clamped to the caller's OWN records. Only a user who
 * can also `approve` the module (or the CEO) sees the whole brand's queue.
 * This deliberately overrides the record_scope that requirePermission derived
 * from the `view` grant, so it MUST run AFTER requirePermission(module, 'view')
 * on read routes. Sets `req.permission_scope` to:
 *   'all'  → CEO or holder of an `approve` grant on the module
 *   'own'  → everyone else (view-only staff)
 * which the module's list/detail reads already honour.
 *
 * Rationale: junior/team staff were seeing cash requests and expenses raised by
 * colleagues because 'team' fell through to "no filter" in the list queries.
 * Binding visibility to the approve capability makes "who can see the queue"
 * match "who acts on the queue", and is robust to mis-seeded record scopes.
 */
function approveGatedScope(moduleKey) {
  if (!moduleKey || typeof moduleKey !== "string") {
    throw new Error("approveGatedScope: moduleKey required");
  }
  return async function approveScopeCheck(req, _res, next) {
    if (!req.user) {
      throw new AppError("AUTH_REQUIRED", "Authentication required", 401);
    }
    if (req.user.is_ceo) {
      req.permission_scope = "all"; // CEO sees everything by design (§3)
      return next();
    }
    const grants = await identityCache.getGrants({
      role_ids: activeRoleIds(req),
      module: moduleKey,
      action: "approve",
    });
    req.permission_scope = grants && grants.length > 0 ? "all" : "own";
    return next();
  };
}

/**
 * Contact-type visibility (contacts §6.12). Resolves the caller's allowed
 * contact types from their brand-active roles and stashes it on
 * `req.contact_type_scope` for the contacts repo/service to enforce:
 *
 *   null       → unrestricted (sees every contact type). The CEO always is,
 *                as is anyone holding at least one unrestricted role.
 *   string[]   → the union of their restricted roles' allowed types
 *                ([] = sees no contacts).
 *
 * Mounted on the contacts router (all routes) so every read/write carries the
 * scope. Cached via identity-cache (invalidated on role access changes).
 */
async function contactTypeScope(req, _res, next) {
  if (!req.user) {
    throw new AppError("AUTH_REQUIRED", "Authentication required", 401);
  }
  if (req.user.is_ceo) {
    req.contact_type_scope = null; // CEO sees everything by design
    return next();
  }
  req.contact_type_scope = await identityCache.getContactTypeScope({
    role_ids: activeRoleIds(req),
  });
  return next();
}

/**
 * Hard CEO-only gate — for the handful of surfaces reserved to the owner
 * (e.g. the messaging channel-access matrix). Unlike requirePermission, no
 * role grant can satisfy this: the caller must be the CEO.
 */
function requireCeo(req, _res, next) {
  if (!req.user) {
    throw new AppError("AUTH_REQUIRED", "Authentication required", 401);
  }
  if (!req.user.is_ceo) {
    throw new AppError("PERMISSION_DENIED", "This action is reserved to the CEO", 403);
  }
  return next();
}

module.exports = {
  requirePermission,
  approveGatedScope,
  requireCeo,
  contactTypeScope,
  activeRoleIds,
};
