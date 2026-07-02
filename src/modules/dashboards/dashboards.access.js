/**
 * Dashboards (V2.2 §6.20) — access guard.
 *
 * The dashboard is reserved for the management circle (CEO/Owner, Top
 * Management, Operations Manager, Finance, Admin — migration 000251). Two
 * grant paths, checked in order:
 *
 *   1. RBAC matrix — shared.permissions `dashboards.view` / `dashboards.export`
 *      (via the cached grants lookup requirePermission also uses).
 *   2. Org-chart rights (VIEW only, additive) — the user holds a position that
 *      is management (shared.org_positions.is_management) or that is the
 *      dotted-line superior of another position where the line carries
 *      rights->>'can_view_dashboards' = 'true'. Dotted lines convey
 *      information rights, never approval/export rights, so this path never
 *      grants export — and it never *revokes* matrix access.
 *
 * Domain gates on top (capabilities): Finance tab + cost/margin tiles need
 * `accounting.view`; HR tab needs `hr_payroll.view`. CEO bypasses everything.
 */

"use strict";

const { query } = require("../../config/database");
const identityCache = require("../../shared/cache/identity-cache");
const { PermissionDeniedError } = require("../../utils/errors");

/** Matrix check (CEO bypass) for any module × action. */
async function hasGrant(user, moduleKey, action) {
  if (!user) return false;
  if (user.is_ceo) return true;
  const grants = await identityCache.getGrants({
    role_ids: user.role_ids,
    module: moduleKey,
    action,
  });
  return Array.isArray(grants) && grants.length > 0;
}

/**
 * Org-chart grant: management position, or dotted-line superior whose line
 * carries can_view_dashboards. Only consulted when the matrix says no.
 */
async function hasOrgDashboardRight(user_id) {
  const { rows } = await query(
    `SELECT 1
       FROM shared.users u
       JOIN shared.org_positions p ON p.profile_id = u.staff_profile_id
      WHERE u.user_id = $1
        AND (
          p.is_management = true
          OR EXISTS (
            SELECT 1
              FROM shared.org_position_dotted_lines dl
             WHERE dl.dotted_to_position_id = p.position_id
               AND dl.rights->>'can_view_dashboards' = 'true'
          )
        )
      LIMIT 1`,
    [user_id],
  );
  return rows.length > 0;
}

/** How this user may view dashboards: 'ceo' | 'matrix' | 'org' | null. */
async function viewGrantPath(user) {
  if (!user) return null;
  if (user.is_ceo) return "ceo";
  if (await hasGrant(user, "dashboards", "view")) return "matrix";
  if (await hasOrgDashboardRight(user.user_id)) return "org";
  return null;
}

/** Express middleware — dashboard VIEW (matrix OR org rights). */
async function requireDashboardView(req, _res, next) {
  const via = await viewGrantPath(req.user);
  if (!via) {
    throw new PermissionDeniedError(
      "Dashboards are reserved for management roles",
    );
  }
  req.dashboard_access = { via };
  // Aggregate KPIs are business-wide; record scope does not apply here.
  req.permission_scope = req.permission_scope || "all";
  return next();
}

/** Express middleware — dashboard EXPORT (matrix only; org rights never export). */
async function requireDashboardExport(req, _res, next) {
  if (!(await hasGrant(req.user, "dashboards", "export"))) {
    throw new PermissionDeniedError("No permission for dashboards.export");
  }
  return next();
}

/**
 * Capability set for this user — drives which tabs/tiles exist in every
 * domain payload and in the /domains response. Nothing gated here is ever
 * queried for an unauthorised user (the API is the security boundary).
 */
async function capabilities(user) {
  const [can_export, can_finance, can_hr] = await Promise.all([
    hasGrant(user, "dashboards", "export"),
    hasGrant(user, "accounting", "view"),
    hasGrant(user, "hr_payroll", "view"),
  ]);
  return {
    can_export,
    can_finance,
    can_hr,
    // Cost/margin visibility (field privacy) rides on accounting.view.
    can_cost: can_finance,
    // Only the CEO may aggregate across businesses (canon §4.1).
    all_entities: user.is_ceo === true,
  };
}

module.exports = {
  requireDashboardView,
  requireDashboardExport,
  capabilities,
  hasGrant,
  hasOrgDashboardRight,
  viewGrantPath,
};
