/**
 * Permission catalog (V2.2 §3 — RBAC). SINGLE SOURCE OF TRUTH for modules AND
 * for the friendly names/descriptions the admin UI shows.
 *
 * The authoritative vocabulary for the role → permission matrix. The module
 * keys below are EXACTLY the keys the routes enforce via
 * requirePermission(module, action) — nothing more, nothing less — so a grant
 * authored against this catalog always lines up with what the middleware
 * checks, and the permissions table can never accumulate keys nothing
 * enforces (or miss keys that something does).
 *
 * Each module also carries a CEO-friendly `label`, a plain-English
 * `description`, and a `group` (matching the admin sidebar sections) so every
 * surface that grants permissions — the role×module matrix, the role editor,
 * the workflow trigger picker — reads the SAME names the CEO sees in the nav.
 * Renaming a module for the whole system is a one-line edit here.
 *
 * Used to (a) drive + label the matrix UI and (b) reject writes that reference
 * a module/action/scope outside the vocabulary.
 *
 * ── Keeping this in sync (do not skip when adding/removing a module) ──
 * This list must equal the distinct enforced module keys. Regenerate with:
 *
 *   grep -rhoP 'requirePermission\(\s*"\K[a-z_]+' src/ --include="*.js" \
 *     | sort -u
 *
 * If you add a new module (new route gated on a new requirePermission key),
 * add a MODULE_CATALOG entry here (key + group + label + description) AND map
 * it in the admin nav (apps/admin/src/lib/modules.ts `permission` field) so the
 * sidebar hides it from users who lack access. If you retire a module, remove
 * its entry here and ship a migration that purges its rows from
 * shared.permissions. See README "RBAC & module governance".
 */

"use strict";

// Sidebar sections the CEO already navigates by. The grant grid groups its
// columns under these so "where do I give access to Messaging?" is answered by
// scanning the People group — the same place Messaging lives in the nav.
const GROUPS = [
  { key: "run", label: "Run" },
  { key: "workspace", label: "Workspace" },
  { key: "operate", label: "Operate" },
  { key: "finance", label: "Finance" },
  { key: "people", label: "People" },
  { key: "grow", label: "Grow" },
  { key: "system", label: "System" },
];

// Every enforced permission module, in display order, with the friendly name
// and one-line description shown in the grant UI. `group` matches GROUPS above.
// KEEP the labels aligned with the sidebar in apps/admin/src/lib/modules.ts.
const MODULE_CATALOG = [
  // ── Run ──────────────────────────────────────────────────
  { key: "dashboards", group: "run", label: "Dashboard", description: "KPIs & today's numbers" },
  { key: "sales", group: "run", label: "Sales", description: "Orders, quotes & payments" },
  { key: "crm", group: "run", label: "CRM", description: "Deals & 360° customer profiles" },
  { key: "service_jobs", group: "run", label: "Stylist Studio", description: "In-house styling jobs & bookings" },
  { key: "ai_insights", group: "run", label: "Insights", description: "Praxis proactive alerts & suggestions" },

  // ── Workspace (personal — on for everyone) ───────────────
  { key: "calendar", group: "workspace", label: "Calendar", description: "Your calendar & shared business events" },
  { key: "tasks", group: "workspace", label: "Tasks", description: "Your to-dos & tasks assigned to you" },
  { key: "goals", group: "workspace", label: "Goals", description: "Goals, milestones & notes (Chief of Staff)" },
  { key: "attendance", group: "workspace", label: "Attendance", description: "Clock in/out & your attendance (My HR)" },

  // ── Operate ──────────────────────────────────────────────
  { key: "stock", group: "operate", label: "Stock", description: "One true inventory count" },
  { key: "catalogue", group: "operate", label: "Catalogue", description: "Products & variants" },
  { key: "logistics", group: "operate", label: "Logistics", description: "Deliveries & couriers" },
  { key: "purchasing", group: "operate", label: "Purchasing", description: "Imports & purchase orders" },
  { key: "production", group: "operate", label: "Production", description: "Landed cost & factory jobs" },
  { key: "retail_partners", group: "operate", label: "Retail Partners", description: "Consignment & partner stock" },
  { key: "stylist_programme", group: "operate", label: "Stylists", description: "Partner stylist programme" },
  { key: "service_catalogue", group: "operate", label: "Service Catalogue", description: "Bookable services & their pricing" },
  { key: "storefront", group: "operate", label: "E-Commerce", description: "Online storefront admin" },
  { key: "storefront_studio", group: "operate", label: "Storefront Studio", description: "Storefront templates & wording" },

  // ── Finance ──────────────────────────────────────────────
  { key: "invoicing", group: "finance", label: "Invoicing", description: "Billing & live accounts receivable" },
  { key: "accounting", group: "finance", label: "Accounting", description: "The books — ledgers & journals" },
  { key: "expenses", group: "finance", label: "Expenses", description: "Claims, advances & cash requests" },
  { key: "pricing", group: "finance", label: "Pricing", description: "Margins, fees & price changes" },
  { key: "intercompany", group: "finance", label: "Intercompany", description: "Cross-brand settlement" },

  // ── People ───────────────────────────────────────────────
  { key: "hr_payroll", group: "people", label: "HR & Payroll", description: "Staff records, attendance admin & pay" },
  { key: "recruitment", group: "people", label: "Recruitment", description: "Hiring — AI-drafted JDs, offers, e-sign & onboarding" },
  { key: "performance", group: "people", label: "Performance", description: "Appraisals — score & review your team" },
  { key: "contacts", group: "people", label: "Contacts", description: "Shared contact directory" },
  { key: "retention", group: "people", label: "Retention", description: "Loyalty, referrals & win-back" },
  { key: "smartcomm", group: "people", label: "Messaging", description: "WhatsApp, SMS & unified inbox — staff send and receive messages" },
  { key: "messaging_accounts", group: "people", label: "Messaging Accounts", description: "Connect WhatsApp / SMS numbers & channels" },
  { key: "comms_studio", group: "people", label: "Automated Messages Studio", description: "Templates & copy for automatic customer messages (receipts, order updates)" },
  { key: "customer_onboarding", group: "people", label: "Customer Onboarding", description: "New-customer intake & profile setup" },
  { key: "org_workflow", group: "people", label: "Org & Workflow", description: "Structure, roles & approvals" },

  // ── Grow ─────────────────────────────────────────────────
  { key: "sales_campaigns", group: "grow", label: "Sales Campaigns", description: "Flash sales & landing pages" },
  { key: "social", group: "grow", label: "Social", description: "Posts & reach" },
  { key: "email_campaigns", group: "grow", label: "Marketing", description: "Email & ad campaigns" },
  { key: "ad_analytics", group: "grow", label: "Ad Analytics", description: "Ad spend & performance" },
  { key: "praxis_ai", group: "grow", label: "Praxis AI", description: "Your AI operator — acts only with your permissions" },

  // ── System ───────────────────────────────────────────────
  { key: "settings", group: "system", label: "Settings", description: "Configure the hub" },
  { key: "platform_settings", group: "system", label: "Platform Settings", description: "Platform-level configuration" },
  { key: "business_setup", group: "system", label: "Business Setup", description: "Company profile, brands & payment gateways" },
  { key: "iam", group: "system", label: "IAM & Security", description: "Users, access, sessions & audit" },
  { key: "audit", group: "system", label: "Audit Log", description: "Who did what, and when" },
  { key: "documents", group: "system", label: "Documents", description: "Shared filing cabinet" },
  { key: "ai_governance", group: "system", label: "AI Control", description: "AI governance & guardrails" },
  { key: "outbound_policy", group: "system", label: "Outbound Policy", description: "Rules for outbound customer messages" },
  { key: "help_center", group: "system", label: "Help Center", description: "Guides & FAQs" },
  { key: "apify_settings", group: "system", label: "Apify Integration", description: "Public social-metrics scraper credentials (Social Studio)" },
];

// The distinct requirePermission keys enforced across src/ (46 modules).
// Derived from the catalog above so the label/group data can never drift from
// the enforced key set. `settings`/`iam` gate the admin surfaces themselves.
const MODULES = MODULE_CATALOG.map((m) => m.key);

// module key → { label, description, group } for quick lookups.
const MODULE_META = Object.fromEntries(
  MODULE_CATALOG.map((m) => [
    m.key,
    { label: m.label, description: m.description, group: m.group },
  ]),
);

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

/**
 * The grid the matrix UI renders: every module (in display order) with its
 * friendly label, description, group, and allowed actions. `groups` gives the
 * ordered section headers so the UI can band the columns like the sidebar.
 */
function catalog() {
  return {
    modules: MODULE_CATALOG.map((m) => ({
      module: m.key,
      label: m.label,
      description: m.description,
      group: m.group,
      actions: ACTIONS,
    })),
    groups: GROUPS,
    actions: ACTIONS,
    record_scopes: RECORD_SCOPES,
  };
}

module.exports = {
  MODULES,
  MODULE_CATALOG,
  MODULE_META,
  GROUPS,
  ACTIONS,
  RECORD_SCOPES,
  isValidModule,
  isValidAction,
  isValidScope,
  catalog,
};
