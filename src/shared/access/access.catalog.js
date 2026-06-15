/**
 * Permission catalog (V2.2 §3 — RBAC).
 *
 * The authoritative vocabulary for the role → permission matrix. The module
 * keys are exactly the keys the routes ENFORCE via requirePermission(module,
 * action) — harvested from the codebase, not the abbreviated keys in the
 * schema comment — so a grant authored against this catalog always lines up
 * with what the middleware checks. `settings` is added because the Access
 * module itself is gated on it.
 *
 * Used to (a) drive the matrix UI and (b) reject writes that reference a
 * module/action/scope outside the vocabulary, so the permissions table can
 * never accumulate keys nothing enforces.
 */

"use strict";

// Enforced module keys (the 36 requirePermission keys) + the access/admin key.
const MODULES = [
  "accounting",
  "ad_analytics",
  "ai_governance",
  "ai_insights",
  "attendance",
  "audit",
  "business_setup",
  "calendar",
  "contacts",
  "crm",
  "dashboards",
  "documents",
  "email_campaigns",
  "expenses",
  "hr_payroll",
  "iam",
  "intercompany",
  "invoicing",
  "logistics",
  "org_workflow",
  "pos",
  "praxis_ai",
  "pricing",
  "production",
  "purchasing",
  "retail_partners",
  "retention",
  "sales",
  "sales_campaigns",
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
