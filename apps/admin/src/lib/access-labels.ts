import type { CatalogEntry, CatalogGroup } from "./access-api";

/**
 * Friendly permission-module names for the RBAC UI.
 *
 * The backend permission catalog (src/shared/access/access.catalog.js) is the
 * SINGLE SOURCE OF TRUTH and now sends `label`, `description`, and `group` with
 * every module. The maps below MIRROR it as an offline/typing fallback so the
 * grant UI still reads friendly names if it renders before the catalog loads.
 * Keep them in sync with the backend catalog.
 */

export const MODULE_LABELS: Record<string, string> = {
  dashboards: "Dashboard",
  sales: "Sales",
  crm: "CRM",
  service_jobs: "Stylist Studio",
  ai_insights: "Insights",
  calendar: "Calendar",
  tasks: "Tasks",
  attendance: "Attendance",
  stock: "Stock",
  catalogue: "Catalogue",
  logistics: "Logistics",
  purchasing: "Purchasing",
  production: "Production",
  retail_partners: "Retail Partners",
  stylist_programme: "Stylists",
  service_catalogue: "Service Catalogue",
  storefront: "E-Commerce",
  storefront_studio: "Storefront Studio",
  invoicing: "Invoicing",
  accounting: "Accounting",
  expenses: "Expenses",
  pricing: "Pricing",
  intercompany: "Intercompany",
  hr_payroll: "HR & Payroll",
  performance: "Performance",
  contacts: "Contacts",
  retention: "Retention",
  smartcomm: "Messaging",
  messaging_accounts: "Messaging Accounts",
  comms_studio: "Automated Messages Studio",
  customer_onboarding: "Customer Onboarding",
  org_workflow: "Org & Workflow",
  sales_campaigns: "Sales Campaigns",
  social: "Social Studio",
  email_campaigns: "Marketing",
  ad_analytics: "Ad Analytics",
  praxis_ai: "Praxis AI",
  settings: "Settings",
  platform_settings: "Platform Settings",
  business_setup: "Business Setup",
  iam: "IAM & Security",
  audit: "Audit Log",
  documents: "Documents",
  ai_governance: "AI Control",
  outbound_policy: "Outbound Policy",
  help_center: "Help Center",
};

export const MODULE_DESCRIPTIONS: Record<string, string> = {
  dashboards: "KPIs & today's numbers",
  sales: "Orders, quotes & payments",
  crm: "Deals & 360° customer profiles",
  service_jobs: "In-house styling jobs & bookings",
  ai_insights: "Praxis proactive alerts & suggestions",
  calendar: "Your calendar & shared business events",
  tasks: "Your to-dos & tasks assigned to you",
  attendance: "Clock in/out & your attendance (My HR)",
  stock: "One true inventory count",
  catalogue: "Products & variants",
  logistics: "Deliveries & couriers",
  purchasing: "Imports & purchase orders",
  production: "Landed cost & factory jobs",
  retail_partners: "Consignment & partner stock",
  stylist_programme: "Partner stylist programme",
  service_catalogue: "Bookable services & their pricing",
  storefront: "Online storefront admin",
  storefront_studio: "Storefront templates & wording",
  invoicing: "Billing & live accounts receivable",
  accounting: "The books — ledgers & journals",
  expenses: "Claims, advances & cash requests",
  pricing: "Margins, fees & price changes",
  intercompany: "Cross-brand settlement",
  hr_payroll: "Staff records, attendance admin & pay",
  performance: "Appraisals — score & review your team",
  contacts: "Shared contact directory",
  retention: "Loyalty, referrals & win-back",
  smartcomm:
    "WhatsApp, SMS & unified inbox — staff send and receive messages",
  messaging_accounts: "Connect WhatsApp / SMS numbers & channels",
  comms_studio:
    "Templates & copy for automatic customer messages (receipts, order updates)",
  customer_onboarding: "New-customer intake & profile setup",
  org_workflow: "Structure, roles & approvals",
  sales_campaigns: "Flash sales & landing pages",
  social: "Plan, prove, and score every post",
  email_campaigns: "Email & ad campaigns",
  ad_analytics: "Ad spend & performance",
  praxis_ai: "Your AI operator — acts only with your permissions",
  settings: "Configure the hub",
  platform_settings: "Platform-level configuration",
  business_setup: "Company profile, brands & payment gateways",
  iam: "Users, access, sessions & audit",
  audit: "Who did what, and when",
  documents: "Shared filing cabinet",
  ai_governance: "AI governance & guardrails",
  outbound_policy: "Rules for outbound customer messages",
  help_center: "Guides & FAQs",
};

export const MODULE_GROUP: Record<string, string> = {
  dashboards: "run",
  sales: "run",
  crm: "run",
  service_jobs: "run",
  ai_insights: "run",
  calendar: "workspace",
  tasks: "workspace",
  attendance: "workspace",
  stock: "operate",
  catalogue: "operate",
  logistics: "operate",
  purchasing: "operate",
  production: "operate",
  retail_partners: "operate",
  stylist_programme: "operate",
  service_catalogue: "operate",
  storefront: "operate",
  storefront_studio: "operate",
  invoicing: "finance",
  accounting: "finance",
  expenses: "finance",
  pricing: "finance",
  intercompany: "finance",
  hr_payroll: "people",
  performance: "people",
  contacts: "people",
  retention: "people",
  smartcomm: "people",
  messaging_accounts: "people",
  comms_studio: "people",
  customer_onboarding: "people",
  org_workflow: "people",
  sales_campaigns: "grow",
  social: "grow",
  email_campaigns: "grow",
  ad_analytics: "grow",
  praxis_ai: "grow",
  settings: "system",
  platform_settings: "system",
  business_setup: "system",
  iam: "system",
  audit: "system",
  documents: "system",
  ai_governance: "system",
  outbound_policy: "system",
  help_center: "system",
};

export const GROUP_LABELS: Record<string, string> = {
  run: "Run",
  workspace: "Workspace",
  operate: "Operate",
  finance: "Finance",
  people: "People",
  grow: "Grow",
  system: "System",
};

export const GROUP_ORDER = [
  "run",
  "workspace",
  "operate",
  "finance",
  "people",
  "grow",
  "system",
];

export function moduleLabel(module: string, entry?: CatalogEntry): string {
  return entry?.label ?? MODULE_LABELS[module] ?? module;
}

export function moduleDescription(module: string, entry?: CatalogEntry): string {
  return entry?.description ?? MODULE_DESCRIPTIONS[module] ?? "";
}

export function moduleGroup(module: string, entry?: CatalogEntry): string {
  return entry?.group ?? MODULE_GROUP[module] ?? "system";
}

export interface GroupedModules {
  key: string;
  label: string;
  modules: CatalogEntry[];
}

/**
 * Cluster catalog modules under their sidebar section, in section order. The
 * backend already returns modules pre-grouped and ordered; this stays robust if
 * an older backend returns them flat.
 */
export function groupModules(
  modules: CatalogEntry[],
  groups?: CatalogGroup[],
): GroupedModules[] {
  const order = (groups?.length ? groups.map((g) => g.key) : GROUP_ORDER).slice();
  const labelOf = (key: string) =>
    groups?.find((g) => g.key === key)?.label ?? GROUP_LABELS[key] ?? key;

  // Any group referenced by a module but not in the order list is appended.
  for (const m of modules) {
    const g = moduleGroup(m.module, m);
    if (!order.includes(g)) order.push(g);
  }

  return order
    .map((key) => ({
      key,
      label: labelOf(key),
      modules: modules.filter((m) => moduleGroup(m.module, m) === key),
    }))
    .filter((g) => g.modules.length > 0);
}
