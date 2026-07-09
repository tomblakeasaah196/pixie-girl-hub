/**
 * Permission catalog (V2.2 §3 — RBAC). SINGLE SOURCE OF TRUTH for modules.
 *
 * The authoritative vocabulary for the role → permission matrix. The module
 * keys below are EXACTLY the keys the routes enforce via
 * requirePermission(module, action) — nothing more, nothing less — so a grant
 * authored against this catalog always lines up with what the middleware
 * checks, and the permissions table can never accumulate keys nothing
 * enforces (or miss keys that something does).
 *
 * Used to (a) drive the matrix UI and (b) reject writes that reference a
 * module/action/scope outside the vocabulary.
 *
 * ── Keeping this in sync (do not skip when adding/removing a module) ──
 * This list must equal the distinct enforced module keys. Regenerate with:
 *
 *   grep -rhoP 'requirePermission\(\s*"\K[a-z_]+' src/ --include="*.js" \
 *     | sort -u
 *
 * If you add a new module (new route gated on a new requirePermission key),
 * add the key here AND map it in the admin nav (apps/admin/src/lib/modules.ts
 * `permission` field) so the sidebar hides it from users who lack access. If
 * you retire a module, remove its key here and ship a migration that purges
 * its rows from shared.permissions. See README "RBAC & module governance".
 */

"use strict";

// The distinct requirePermission keys enforced across src/ (44 modules).
// `settings` and `iam` gate the admin/access surfaces themselves.
const MODULES = [
  "accounting",
  "ad_analytics",
  "ai_governance",
  "ai_insights",
  "attendance",
  "audit",
  "business_setup",
  "calendar",
  "catalogue",
  "contacts",
  "crm",
  "customer_onboarding",
  "dashboards",
  "documents",
  "email_campaigns",
  "expenses",
  "help_center",
  "hr_payroll",
  "iam",
  "intercompany",
  "invoicing",
  "logistics",
  "messaging_accounts",
  "org_workflow",
  "outbound_policy",
  "platform_settings",
  "praxis_ai",
  "pricing",
  "production",
  "purchasing",
  "retail_partners",
  "retention",
  "sales",
  "sales_campaigns",
  "service_catalogue",
  "service_jobs",
  "settings",
  "smartcomm",
  "social",
  "stock",
  "storefront",
  "storefront_studio",
  "stylist_programme",
  "tasks",
];

// The full action set permitted by the schema (CHECK on shared.permissions
// is open text, but these are the only meaningful verbs). `export` is valid
// even though no route enforces it yet.
const ACTIONS = ["view", "create", "edit", "delete", "approve", "export"];

const RECORD_SCOPES = ["all", "own", "team"];

const MODULE_SET = new Set(MODULES);
const ACTION_SET = new Set(ACTIONS);
const SCOPE_SET = new Set(RECORD_SCOPES);

const isValidModule = (m) => MODULE_SET.has(m);
const isValidAction = (a) => ACTION_SET.has(a);
const isValidScope = (s) => SCOPE_SET.has(s);

/** The grid the matrix UI renders: every module with its allowed actions. */
function catalog() {
  return {
    modules: MODULES.map((module) => ({ module, actions: ACTIONS })),
    actions: ACTIONS,
    record_scopes: RECORD_SCOPES,
  };
}

module.exports = {
  MODULES,
  ACTIONS,
  RECORD_SCOPES,
  isValidModule,
  isValidAction,
  isValidScope,
  catalog,
};
