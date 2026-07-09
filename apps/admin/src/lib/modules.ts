import {
  LayoutDashboard,
  ShoppingBag,
  Users,
  Boxes,
  Package,
  Truck,
  ShoppingCart,
  Factory,
  Store,
  FileText,
  BookOpen,
  Receipt,
  Tag,
  Wallet,
  UserCog,
  Contact,
  Heart,
  GitBranch,
  Megaphone,
  Share2,
  Mail,
  Sparkles,
  Settings,
  FolderArchive,
  ShieldCheck,
  HelpCircle,
  Globe,
  MessageSquare,
  CalendarDays,
  Bell,
  Scissors,
  Palette,
  ArrowLeftRight,
  Gauge,
  Lightbulb,
  type LucideIcon,
} from "lucide-react";

export type ModuleGroup =
  | "run"
  | "operate"
  | "finance"
  | "people"
  | "grow"
  | "system";

export interface AppModule {
  key: string;
  label: string;
  description: string;
  group: ModuleGroup;
  route: string;
  icon: LucideIcon;
  /** Optional key into a live badge map (unread/pending counts). */
  badgeKey?: string;
  /**
   * Hidden from navigation (sidebar, "More", App Grid, command palette). The
   * route + code stay intact so it can be re-enabled for a client that needs
   * it — just flip this off. Used for modules out of scope for this project.
   */
  hidden?: boolean;
  /**
   * RBAC module key that gates this nav entry (a key in the backend permission
   * catalog, src/shared/access/access.catalog.js). A user who lacks
   * `<permission>:view` never sees this module in any nav surface, and the
   * route guard blocks direct URL access. Omit for personal/always-on modules
   * (Dashboard anchor, Workspace, Notifications). The API enforces access
   * regardless; this is the UI half of "never show what they can't access".
   */
  permission?: string;
}

export const GROUP_LABELS: Record<ModuleGroup, string> = {
  run: "Run",
  operate: "Operate",
  finance: "Finance",
  people: "People",
  grow: "Grow",
  system: "System",
};

export const GROUP_ORDER: ModuleGroup[] = [
  "run",
  "operate",
  "finance",
  "people",
  "grow",
  "system",
];

/** The full module catalogue. Routes mount under the AppShell. */
export const MODULES: AppModule[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    description: "KPIs & today",
    group: "run",
    route: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    key: "sales",
    permission: "sales",
    label: "Sales",
    description: "Orders, quotes, payments",
    group: "run",
    route: "/sales",
    icon: ShoppingBag,
    badgeKey: "sales",
  },
  {
    key: "crm",
    permission: "crm",
    label: "CRM",
    description: "Deals & 360° profiles",
    group: "run",
    route: "/crm",
    icon: Users,
  },
  {
    key: "service_jobs",
    permission: "service_jobs",
    label: "Stylist Studio",
    description: "In-house styling operations",
    group: "run",
    route: "/service-jobs",
    icon: Scissors,
  },
  // POS retired (owner directive) — replaced by the Quick Sale Form. The
  // module + backend routes are deleted; selling happens through Sales.
  {
    key: "ecommerce",
    permission: "storefront",
    label: "E-Commerce",
    description: "Storefront admin",
    group: "run",
    route: "/ecommerce",
    icon: Globe,
    hidden: true, // out of scope for this project; keep for future clients
  },
  {
    key: "workspace",
    label: "Workspace",
    description: "My day, calendar, tasks & My HR",
    group: "run",
    route: "/workspace",
    icon: CalendarDays,
  },
  {
    key: "insights",
    permission: "ai_insights",
    label: "Insights",
    description: "Praxis proactive alerts",
    group: "run",
    route: "/insights",
    icon: Lightbulb,
  },
  {
    key: "stock",
    permission: "stock",
    label: "Stock",
    description: "One true count",
    group: "operate",
    route: "/stock",
    icon: Boxes,
  },
  {
    key: "catalogue",
    permission: "catalogue",
    label: "Catalogue",
    description: "Products & variants",
    group: "operate",
    route: "/catalogue",
    icon: Package,
  },
  {
    key: "logistics",
    permission: "logistics",
    label: "Logistics",
    description: "Deliveries & couriers",
    group: "operate",
    route: "/logistics",
    icon: Truck,
  },
  {
    key: "purchasing",
    permission: "purchasing",
    label: "Purchasing",
    description: "Imports & POs",
    group: "operate",
    route: "/purchasing",
    icon: ShoppingCart,
  },
  {
    key: "production",
    permission: "production",
    label: "Production",
    description: "Landed cost & jobs",
    group: "operate",
    route: "/production",
    icon: Factory,
  },
  {
    key: "retail",
    permission: "retail_partners",
    label: "Retail Partners",
    description: "Consignment",
    group: "operate",
    route: "/retail-partners",
    icon: Store,
  },
  {
    key: "stylists",
    permission: "stylist_programme",
    label: "Stylists",
    description: "Partner programme",
    group: "operate",
    route: "/stylists",
    icon: Scissors,
  },
  {
    key: "invoicing",
    permission: "invoicing",
    label: "Invoicing",
    description: "Billing & live AR",
    group: "finance",
    route: "/invoicing",
    icon: FileText,
    badgeKey: "invoicing",
  },
  {
    key: "accounting",
    permission: "accounting",
    label: "Accounting",
    description: "The books",
    group: "finance",
    route: "/accounting",
    icon: BookOpen,
  },
  {
    key: "expenses",
    permission: "expenses",
    label: "Expenses",
    description: "Claims & advances",
    group: "finance",
    route: "/expenses",
    icon: Receipt,
  },
  {
    key: "pricing",
    permission: "pricing",
    label: "Pricing",
    description: "Margin & fees",
    group: "finance",
    route: "/pricing",
    icon: Tag,
  },
  {
    key: "cash",
    permission: "expenses",
    label: "Cash Requests",
    description: "Disbursements",
    group: "finance",
    route: "/cash-requests",
    icon: Wallet,
    badgeKey: "cash",
  },
  {
    key: "intercompany",
    permission: "intercompany",
    label: "Intercompany",
    description: "Cross-brand settlement",
    group: "finance",
    route: "/intercompany",
    icon: ArrowLeftRight,
    hidden: true, // out of scope for this project; keep for future clients
  },
  {
    key: "hr",
    permission: "hr_payroll",
    label: "HR & Staff",
    description: "People, attendance & pay",
    group: "people",
    route: "/hr",
    icon: UserCog,
  },
  {
    key: "payroll",
    permission: "hr_payroll",
    label: "Payroll",
    description: "Runs, payslips & disbursement",
    group: "people",
    route: "/payroll",
    icon: Wallet,
  },
  {
    key: "performance",
    permission: "hr_payroll",
    label: "Performance",
    description: "Appraisals & reviews",
    group: "people",
    route: "/performance",
    icon: Gauge,
  },
  {
    key: "contacts",
    permission: "contacts",
    label: "Contacts",
    description: "Directory",
    group: "people",
    route: "/contacts",
    icon: Contact,
  },
  {
    key: "retention",
    permission: "retention",
    label: "Retention",
    description: "Loyalty, referrals & strategies",
    group: "people",
    route: "/retention",
    icon: Heart,
  },
  {
    key: "smartcomm",
    permission: "smartcomm",
    label: "Messaging",
    description: "Unified inbox",
    group: "people",
    route: "/smartcomm",
    icon: MessageSquare,
  },
  {
    key: "orgworkflow",
    permission: "org_workflow",
    label: "Org & Workflow",
    description: "Structure, roles & approvals",
    group: "people",
    route: "/org-workflow",
    icon: GitBranch,
    badgeKey: "orgworkflow",
  },
  {
    key: "campaigns",
    permission: "sales_campaigns",
    label: "Sales Campaigns",
    description: "Flash sales & landing pages",
    group: "grow",
    route: "/sales-campaigns",
    icon: Megaphone,
    badgeKey: "campaigns",
  },
  {
    key: "social",
    permission: "social",
    label: "Social",
    description: "Posts & reach",
    group: "grow",
    route: "/social",
    icon: Share2,
  },
  {
    key: "marketing",
    permission: "email_campaigns",
    label: "Marketing",
    description: "Email & ads",
    group: "grow",
    route: "/marketing",
    icon: Mail,
  },
  {
    key: "praxis",
    permission: "praxis_ai",
    label: "Praxis AI",
    description:
      "Reads freely · writes only with your sign-off · acts with your permissions",
    group: "grow",
    route: "/praxis",
    icon: Sparkles,
  },
  {
    key: "settings",
    permission: "settings",
    label: "Settings",
    description: "Configure the hub",
    group: "system",
    route: "/settings",
    icon: Settings,
  },
  {
    key: "iam_security",
    permission: "iam",
    label: "IAM & Security",
    description: "Audit, access & sessions",
    group: "system",
    route: "/iam-security",
    icon: ShieldCheck,
  },
  {
    key: "documents",
    permission: "documents",
    label: "Documents",
    description: "Filing cabinet",
    group: "system",
    route: "/documents",
    icon: FolderArchive,
  },
  {
    key: "aicontrol",
    permission: "ai_governance",
    label: "AI Control",
    description: "Governance",
    group: "system",
    route: "/ai-control",
    icon: ShieldCheck,
  },
  {
    key: "storefront_studio",
    permission: "storefront_studio",
    label: "Storefront Studio",
    description: "Templates & vocabulary",
    group: "system",
    route: "/storefront-studio",
    icon: Palette,
  },
  {
    key: "notifications",
    label: "Notifications",
    description: "Feed & alerts",
    group: "system",
    route: "/notifications",
    icon: Bell,
  },
  {
    key: "help_center",
    permission: "help_center",
    label: "Help Center",
    description: "Guides & FAQs",
    group: "system",
    route: "/help",
    icon: HelpCircle,
  },
];

export const MODULE_BY_KEY: Record<string, AppModule> = Object.fromEntries(
  MODULES.map((m) => [m.key, m]),
);

/**
 * Is this module permitted for the current user? `can` comes from the auth
 * store (`useAuthStore(s => s.can)`); a CEO's `can` returns true for
 * everything, so CEOs always see the full catalogue. Modules with no
 * `permission` (Dashboard anchor, Workspace, Notifications) are always
 * permitted — they're personal, not RBAC-gated.
 */
export function moduleIsPermitted(
  m: AppModule,
  can: (module: string, action: string) => boolean,
): boolean {
  if (!m.permission) return true;
  return can(m.permission, "view");
}

/** Resolve the module that owns a given route path (longest-prefix match), so
 *  a route guard can find the permission gating the current screen. */
export function moduleForPath(pathname: string): AppModule | undefined {
  let best: AppModule | undefined;
  for (const m of MODULES) {
    if (pathname === m.route || pathname.startsWith(m.route + "/")) {
      if (!best || m.route.length > best.route.length) best = m;
    }
  }
  return best;
}

/** The default top-10 (Dashboard is anchored first). */
export const DEFAULT_TOP = [
  "dashboard",
  "workspace",
  "sales",
  "crm",
  "stock",
  "catalogue",
  "invoicing",
  "logistics",
  "praxis",
];

export const TOP_LIMIT = 10;
