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
    label: "Sales",
    description: "Orders, quotes, payments",
    group: "run",
    route: "/sales",
    icon: ShoppingBag,
    badgeKey: "sales",
  },
  {
    key: "crm",
    label: "CRM",
    description: "Deals & 360° profiles",
    group: "run",
    route: "/crm",
    icon: Users,
  },
  {
    key: "ecommerce",
    label: "E-Commerce",
    description: "Storefront admin",
    group: "run",
    route: "/ecommerce",
    icon: Globe,
  },
  {
    key: "workspace",
    label: "Workspace",
    description: "Tasks, calendar & my day",
    group: "run",
    route: "/workspace",
    icon: CalendarDays,
  },
  {
    key: "stock",
    label: "Stock",
    description: "One true count",
    group: "operate",
    route: "/stock",
    icon: Boxes,
  },
  {
    key: "catalogue",
    label: "Catalogue",
    description: "Products & variants",
    group: "operate",
    route: "/catalogue",
    icon: Package,
  },
  {
    key: "logistics",
    label: "Logistics",
    description: "Deliveries & couriers",
    group: "operate",
    route: "/logistics",
    icon: Truck,
  },
  {
    key: "purchasing",
    label: "Purchasing",
    description: "Imports & POs",
    group: "operate",
    route: "/purchasing",
    icon: ShoppingCart,
  },
  {
    key: "production",
    label: "Production",
    description: "Landed cost & jobs",
    group: "operate",
    route: "/production",
    icon: Factory,
  },
  {
    key: "retail",
    label: "Retail Partners",
    description: "Consignment",
    group: "operate",
    route: "/retail-partners",
    icon: Store,
  },
  {
    key: "stylists",
    label: "Stylists",
    description: "Partner programme",
    group: "operate",
    route: "/stylists",
    icon: Scissors,
  },
  {
    key: "invoicing",
    label: "Invoicing",
    description: "Billing & live AR",
    group: "finance",
    route: "/invoicing",
    icon: FileText,
    badgeKey: "invoicing",
  },
  {
    key: "accounting",
    label: "Accounting",
    description: "The books",
    group: "finance",
    route: "/accounting",
    icon: BookOpen,
  },
  {
    key: "expenses",
    label: "Expenses",
    description: "Claims & advances",
    group: "finance",
    route: "/expenses",
    icon: Receipt,
  },
  {
    key: "pricing",
    label: "Pricing",
    description: "Margin & fees",
    group: "finance",
    route: "/pricing",
    icon: Tag,
  },
  {
    key: "cash",
    label: "Cash Requests",
    description: "Disbursements",
    group: "finance",
    route: "/cash-requests",
    icon: Wallet,
    badgeKey: "cash",
  },
  {
    key: "intercompany",
    label: "Intercompany",
    description: "Cross-brand settlement",
    group: "finance",
    route: "/intercompany",
    icon: ArrowLeftRight,
  },
  {
    key: "hr",
    label: "HR & Payroll",
    description: "People & pay",
    group: "people",
    route: "/hr",
    icon: UserCog,
  },
  {
    key: "contacts",
    label: "Contacts",
    description: "Directory",
    group: "people",
    route: "/contacts",
    icon: Contact,
  },
  {
    key: "retention",
    label: "Retention",
    description: "Loyalty & referrals",
    group: "people",
    route: "/retention",
    icon: Heart,
  },
  {
    key: "smartcomm",
    label: "Messaging",
    description: "Unified inbox",
    group: "people",
    route: "/smartcomm",
    icon: MessageSquare,
  },
  {
    key: "orgworkflow",
    label: "Org & Workflow",
    description: "Structure, roles & approvals",
    group: "people",
    route: "/org-workflow",
    icon: GitBranch,
    badgeKey: "orgworkflow",
  },
  {
    key: "campaigns",
    label: "Sales Campaigns",
    description: "Flash sales & landing pages",
    group: "grow",
    route: "/sales-campaigns",
    icon: Megaphone,
    badgeKey: "campaigns",
  },
  {
    key: "social",
    label: "Social",
    description: "Posts & reach",
    group: "grow",
    route: "/social",
    icon: Share2,
  },
  {
    key: "marketing",
    label: "Marketing",
    description: "Email & ads",
    group: "grow",
    route: "/marketing",
    icon: Mail,
  },
  {
    key: "praxis",
    label: "Praxis AI",
    description: "Your agent",
    group: "grow",
    route: "/praxis",
    icon: Sparkles,
  },
  {
    key: "settings",
    label: "Settings",
    description: "Configure the hub",
    group: "system",
    route: "/settings",
    icon: Settings,
  },
  {
    key: "iam_security",
    label: "IAM & Security",
    description: "Audit, access & sessions",
    group: "system",
    route: "/iam-security",
    icon: ShieldCheck,
  },
  {
    key: "documents",
    label: "Documents",
    description: "Filing cabinet",
    group: "system",
    route: "/documents",
    icon: FolderArchive,
  },
  {
    key: "aicontrol",
    label: "AI Control",
    description: "Governance",
    group: "system",
    route: "/ai-control",
    icon: ShieldCheck,
  },
  {
    key: "storefront_studio",
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
