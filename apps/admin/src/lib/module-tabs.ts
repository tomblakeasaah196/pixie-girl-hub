import { MODULE_BY_KEY } from "@/lib/modules";

/**
 * Module tab registry — the single source of truth for the *tabs inside*
 * modules, so the ⌘K command palette can search them (not just the modules
 * themselves). Searching "shades", "credit notes", "chart of accounts" or
 * "approval queue" now lands the user on the exact tab.
 *
 * ── Keeping it honest ────────────────────────────────────────────────────
 * A tab entry's `route` must deep-link the tab. Pages read their active tab
 * from the `?tab=` query param (see hooks/useUrlTab.ts); the value after
 * `tab=` MUST equal the key the page switches on. When a page's tabs change,
 * update this file in the same PR (and docs/PRAXIS_KNOWLEDGE_BASE.md) — a tab
 * whose route no longer matches is a dead link.
 *
 * ── RBAC ─────────────────────────────────────────────────────────────────
 * A tab is never shown to a user who can't reach its parent module: the
 * palette filters every tab through the same permitted-module set the sidebar
 * uses (`moduleKey`). `requires` adds a finer per-tab gate (e.g. an approval
 * queue needs the *approve* action), and `ceoOnly` restricts to the CEO. So a
 * user without Catalogue access sees no Catalogue tabs at all.
 */

export interface ModuleTab {
  /**
   * Parent module key (a key in MODULES). Drives RBAC (the tab is hidden
   * unless the module is permitted) and the "Module › Tab" label + icon.
   */
  moduleKey: string;
  /** Tab label, exactly as the page's tab bar shows it. */
  label: string;
  /** In-app route that deep-links this tab (`/module?tab=<key>`). */
  route: string;
  /** Extra search terms beyond the label + parent module label. */
  keywords?: string[];
  /**
   * Optional finer RBAC gate layered on top of the parent module's view
   * permission — e.g. an approval queue only a user with the `approve` action
   * should see. Checked against the auth store's `can(module, action)`.
   */
  requires?: { module: string; action: string };
  /** Tab is CEO-only (matches the page hiding it behind `isCeo`). */
  ceoOnly?: boolean;
}

/**
 * Build a `/module?tab=key` route from the parent module's base route. Falls
 * back to a bare `/key` only if the module is somehow missing (never in prod).
 */
function tabRoute(moduleKey: string, tabKey: string): string {
  const base = MODULE_BY_KEY[moduleKey]?.route ?? `/${moduleKey}`;
  return `${base}?tab=${tabKey}`;
}

function tabs(
  moduleKey: string,
  defs: Array<{
    key: string;
    label: string;
    keywords?: string[];
    requires?: { module: string; action: string };
    ceoOnly?: boolean;
    /** Override the derived `/module?tab=key` route (for sub-route "tabs"). */
    route?: string;
  }>,
): ModuleTab[] {
  return defs.map((d) => ({
    moduleKey,
    label: d.label,
    route: d.route ?? tabRoute(moduleKey, d.key),
    keywords: d.keywords,
    requires: d.requires,
    ceoOnly: d.ceoOnly,
  }));
}

/**
 * Every searchable tab, grouped by module. Order is cosmetic — the palette
 * scores by query relevance.
 */
export const MODULE_TABS: ModuleTab[] = [
  // ── Run ────────────────────────────────────────────────
  ...tabs("sales", [
    { key: "quick-sale", label: "Quick Sale", keywords: ["pos", "sell", "counter"] },
    { key: "orders", label: "Orders", keywords: ["sales orders"] },
    { key: "preorders", label: "Pre-orders", keywords: ["pre-order", "made to order", "backorder", "production"] },
    { key: "quotations", label: "Quotations", keywords: ["quotes", "estimate"] },
    { key: "delivery-pending", label: "Delivery Pending", keywords: ["fee", "awaiting"] },
    { key: "pos-reconciliation", label: "POS Reconciliation", keywords: ["cash up", "till"] },
    { key: "payments", label: "Payments", keywords: ["receipts", "collected"] },
  ]),
  ...tabs("crm", [
    { key: "today", label: "Today", keywords: ["agenda", "focus"] },
    { key: "pipeline", label: "Pipeline", keywords: ["deals", "kanban", "stages"] },
    { key: "clients", label: "Clients", keywords: ["accounts", "customers"] },
    { key: "reports", label: "Reports", keywords: ["analytics", "conversion"] },
  ]),
  ...tabs("service_jobs", [
    { key: "my", label: "My Jobs", keywords: ["queue", "assigned"] },
    { key: "board", label: "Job Board", keywords: ["assignments"] },
    { key: "qc", label: "QC Queue", keywords: ["quality", "review"] },
    { key: "accountability", label: "Wig Accountability", keywords: ["ledger", "custody"] },
    { key: "scorecards", label: "Team Scorecards", keywords: ["performance"] },
    { key: "types", label: "Service Types" },
    { key: "recipes", label: "Recipes", keywords: ["chemical", "formula"] },
    { key: "reconciliation", label: "Chemical Reconciliation", keywords: ["stock"] },
  ]),
  ...tabs("workspace", [
    { key: "goals", label: "Goals", keywords: ["okr", "targets"], ceoOnly: true },
    { key: "tasks", label: "Tasks", keywords: ["to-do", "todo"] },
    { key: "calendar", label: "Calendar", keywords: ["schedule", "events"] },
    { key: "notes", label: "Notes", ceoOnly: true },
    { key: "chief-of-staff", label: "AI Chief of Staff", keywords: ["cos"], ceoOnly: true },
    { key: "my-hr", label: "My HR", keywords: ["payslip", "leave", "attendance"] },
  ]),

  // ── Operate ────────────────────────────────────────────
  ...tabs("stock", [
    { key: "overview", label: "Overview", keywords: ["inventory", "on hand"] },
    { key: "receive", label: "Goods Reception", keywords: ["grn", "receive", "intake"] },
    { key: "movements", label: "Movements", keywords: ["ledger", "history"] },
    { key: "transfers", label: "Transfers", keywords: ["move", "between locations"] },
    { key: "adjustments", label: "Adjustments", keywords: ["count", "shrinkage"] },
    { key: "alerts", label: "Alerts", keywords: ["low stock", "reorder"] },
    { key: "locations", label: "Locations", keywords: ["warehouse", "bins"] },
  ]),
  ...tabs("catalogue", [
    { key: "styled", label: "Styled", keywords: ["storefront", "products"] },
    { key: "base", label: "Base", keywords: ["stock product", "china"] },
    { key: "categories", label: "Categories", keywords: ["merchandising"] },
    { key: "collections", label: "Collections" },
    { key: "shades", label: "Shades", keywords: ["colour", "color"] },
    { key: "bundles", label: "Bundles", keywords: ["offers", "sets"] },
    { key: "services", label: "Services" },
    { key: "config", label: "Config", keywords: ["settings", "catalogue settings"] },
  ]),
  ...tabs("logistics", [
    { key: "queue", label: "Queue", keywords: ["deliveries", "pending"] },
    { key: "active", label: "Active", keywords: ["in transit"] },
    { key: "delivered", label: "Delivered", keywords: ["completed"] },
    { key: "issues", label: "Issues", keywords: ["failed", "returns"] },
    { key: "all", label: "All Deliveries" },
    { key: "agencies", label: "Agencies", keywords: ["couriers"] },
    { key: "rates", label: "Shipping Rates", keywords: ["zones", "pricing"] },
  ]),
  ...tabs("purchasing", [
    { key: "overview", label: "Overview" },
    { key: "purchase-orders", label: "Purchase Orders", keywords: ["po", "imports"] },
    { key: "suppliers", label: "Suppliers", keywords: ["vendors"] },
    { key: "grn-invoices", label: "GRN & Invoices", keywords: ["goods received", "bills"] },
  ]),
  ...tabs("production", [
    { key: "overview", label: "Overview" },
    { key: "factory", label: "Factory Account", keywords: ["china", "wallet"] },
    { key: "runs", label: "Production Runs", keywords: ["landed cost", "jobs"] },
  ]),
  ...tabs("retail", [
    { key: "partners", label: "Partners", keywords: ["consignment"] },
    { key: "stock", label: "Consignment Stock" },
    { key: "movements", label: "Movements" },
    { key: "settlements", label: "Settlements", keywords: ["payouts", "reconcile"] },
  ]),
  ...tabs("stylists", [
    { key: "Directory", label: "Directory", keywords: ["partners"] },
    { key: "Applications", label: "Applications", keywords: ["onboarding"] },
    { key: "Assignments", label: "Assignments" },
    { key: "Payouts", label: "Payouts", keywords: ["commission"] },
    { key: "Reviews", label: "Reviews" },
    { key: "Referrals", label: "Referrals" },
    { key: "Programme", label: "Programme", keywords: ["program", "tiers"] },
  ]),

  // ── Finance ────────────────────────────────────────────
  ...tabs("invoicing", [
    { key: "invoices", label: "Invoices", keywords: ["bills"] },
    { key: "ar-ageing", label: "Owed to Us", keywords: ["receivable", "debtors", "aging", "ar ageing"] },
    { key: "credit-notes", label: "Refunds", keywords: ["credit notes", "cn"] },
    { key: "settings", label: "Settings", keywords: ["document settings"] },
  ]),
  ...tabs("accounting", [
    { key: "reports", label: "Reports", keywords: ["financials", "p&l", "balance sheet"] },
    { key: "journals", label: "Journals", keywords: ["gl", "entries"] },
    { key: "coa", label: "Chart of Accounts", keywords: ["ledger accounts"] },
    { key: "tax", label: "Tax Center", keywords: ["vat", "wht"] },
    { key: "periods", label: "Periods", keywords: ["close", "fiscal"] },
    { key: "bank", label: "Bank", keywords: ["reconciliation", "statements"] },
  ]),
  ...tabs("pricing", [
    { key: "advisor", label: "Advisor", keywords: ["recommend", "margin"] },
    { key: "scenarios", label: "Scenarios", keywords: ["what if"] },
    { key: "rules", label: "Rules" },
    { key: "floors", label: "Floors", keywords: ["minimum", "guardrail"] },
    { key: "overrides", label: "Overrides" },
    { key: "proposals", label: "Proposals", keywords: ["approval"] },
    { key: "settings", label: "Settings" },
  ]),
  ...tabs("cash", [
    { key: "my-requests", label: "My Requests", keywords: ["advance", "disbursement"] },
    { key: "drafts", label: "Drafts" },
    {
      key: "approval-queue",
      label: "Approval Queue",
      keywords: ["approve", "pending"],
      requires: { module: "expenses", action: "approve" },
    },
    {
      key: "all-requests",
      label: "All Cash Requests",
      requires: { module: "expenses", action: "approve" },
    },
  ]),

  // ── People ─────────────────────────────────────────────
  ...tabs("hr", [
    { key: "overview", label: "Overview" },
    { key: "directory", label: "Directory", keywords: ["staff", "employees"] },
    { key: "leave", label: "Leave", keywords: ["time off", "holiday"] },
    { key: "attendance", label: "Attendance", keywords: ["clock", "timesheet"] },
    { key: "devices", label: "Devices" },
    { key: "queries", label: "Queries", keywords: ["disciplinary"] },
    { key: "targets", label: "Targets" },
    { key: "rewards", label: "Rewards" },
    {
      key: "vacancies",
      label: "Vacancies",
      keywords: ["jobs", "openings", "careers", "applicants", "applications", "hiring", "recruit", "positions"],
      requires: { module: "recruitment", action: "view" },
    },
    {
      key: "recruitment",
      label: "Recruitment",
      keywords: ["hiring", "candidates", "jobs", "offers", "onboarding"],
      requires: { module: "recruitment", action: "view" },
    },
    { key: "analytics", label: "Analytics" },
    { key: "settings", label: "Settings" },
    { key: "onboarding", label: "Onboarding" },
  ]),
  ...tabs("retention", [
    { key: "strategies", label: "Strategies", keywords: ["campaigns", "automation"] },
    { key: "crowns", label: "Crowns", keywords: ["loyalty", "points", "tiers", "streak", "stars", "rewards"] },
    {
      key: "approvals",
      label: "Approvals",
      keywords: ["crown", "moderation", "ugc", "review queue"],
      requires: { module: "retention", action: "approve" },
    },
    { key: "rewards", label: "Rewards", keywords: ["gifts"] },
    { key: "referrals", label: "Referrals" },
    { key: "coupons", label: "Coupons", keywords: ["discount", "voucher"] },
    { key: "subscriptions", label: "Subscriptions" },
    { key: "bundles", label: "Bundles" },
    { key: "maintenance", label: "Maintenance" },
    { key: "analytics", label: "Analytics" },
  ]),
  ...tabs("orgworkflow", [
    { key: "org", label: "Org Chart", keywords: ["structure", "hierarchy"] },
    { key: "permissions", label: "Permissions", keywords: ["roles", "rbac", "access"] },
    { key: "workflows", label: "Workflows", keywords: ["approvals", "routing"] },
    { key: "pending", label: "Pending", keywords: ["approval queue"] },
  ]),

  // ── Grow ───────────────────────────────────────────────
  ...tabs("campaigns", [
    // Campaign "tabs" are sibling routes, not ?tab= panes.
    { key: "bundles", label: "Bundles", route: "/sales-campaigns/bundles", keywords: ["offers"] },
    { key: "codes", label: "Special Codes", route: "/sales-campaigns/codes", keywords: ["coupon", "promo"] },
  ]),
  ...tabs("social", [
    { key: "board", label: "Board", keywords: ["posts", "planner"] },
    { key: "calendar", label: "Calendar", keywords: ["schedule"] },
    { key: "performance", label: "Performance", keywords: ["analytics", "score"] },
    { key: "team", label: "Team" },
    { key: "accounts", label: "Accounts", keywords: ["channels", "instagram", "connect"] },
  ]),
  ...tabs("marketing", [
    { key: "campaigns", label: "Campaigns", keywords: ["email", "newsletter", "broadcast", "send"] },
    { key: "templates", label: "Templates", keywords: ["mail", "editor", "write"] },
    { key: "segments", label: "Segments", keywords: ["audience", "contacts"] },
    { key: "design", label: "Design", keywords: ["header", "footer", "frame"] },
  ]),

  // ── System ─────────────────────────────────────────────
  ...tabs("storefront_studio", [
    { key: "theme", label: "Theme", keywords: ["colours", "look"] },
    { key: "branding", label: "Branding", keywords: ["logo"] },
    { key: "toolbar", label: "Toolbar" },
    { key: "navigation", label: "Navigation", keywords: ["menu"] },
    { key: "pages", label: "Pages" },
    { key: "content", label: "Content", keywords: ["vocabulary", "copy"] },
    { key: "popups", label: "Popups" },
    { key: "preview", label: "Preview" },
    { key: "revisions", label: "Revisions", keywords: ["history"] },
  ]),
  ...tabs("documents", [
    { key: "vault", label: "Vault", keywords: ["files", "filing cabinet"] },
    { key: "signatures", label: "Signatures", keywords: ["e-sign", "sign"] },
  ]),
];

/**
 * The tabs a user may see, after RBAC gating. Mirrors the sidebar contract:
 * a tab is hidden unless its parent module is permitted (`permittedModuleKeys`),
 * any `requires` action is granted (`can`), and — for CEO-only tabs — the user
 * is the CEO.
 *
 * @param permittedModuleKeys the set from `usePermittedModuleKeys()`
 * @param can                 the auth store's permission predicate
 * @param isCeo               whether the current user is the CEO
 */
export function permittedTabs(
  permittedModuleKeys: Set<string>,
  can: (module: string, action: string) => boolean,
  isCeo: boolean,
): ModuleTab[] {
  return MODULE_TABS.filter((t) => {
    if (!permittedModuleKeys.has(t.moduleKey)) return false;
    if (t.ceoOnly && !isCeo) return false;
    if (t.requires && !can(t.requires.module, t.requires.action)) return false;
    return true;
  });
}

/**
 * Score a tab against a query (label + parent-module label + keywords). Same
 * ranking shape as the action scorer: label prefix wins, then label substring,
 * then a keyword / module-name hit. Zero = no match.
 */
export function scoreTab(tab: ModuleTab, q: string): number {
  const needle = q.trim().toLowerCase();
  if (!needle) return 0;
  const label = tab.label.toLowerCase();
  if (label.startsWith(needle)) return 3;
  if (label.includes(needle)) return 2;
  const moduleLabel = MODULE_BY_KEY[tab.moduleKey]?.label.toLowerCase() ?? "";
  if (moduleLabel.includes(needle)) return 1.5;
  if (tab.keywords?.some((k) => k.toLowerCase().includes(needle))) return 1;
  return 0;
}
