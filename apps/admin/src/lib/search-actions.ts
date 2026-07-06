/**
 * Palette command / action registry.
 *
 * "Things you can DO from ⌘K" (as opposed to records you can FIND). Each
 * action is permission-aware — the palette filters them by `useAuthStore.can`
 * before rendering, so a staff member without invoicing.create never sees
 * "Create invoice".
 *
 * An action either:
 *   - navigates to a route (optionally with a query string that the target
 *     page reads to auto-open its create modal/form), or
 *   - calls `run()` — used for pure client-side commands like theme toggle
 *     and brand switch that don't map to a URL.
 *
 * Add a new action by appending to ACTIONS. No wiring in the palette itself.
 */

import {
  ShoppingBag,
  FileText,
  UserPlus,
  Package,
  Users,
  Receipt,
  Wallet,
  Sparkles,
  Sun,
  Moon,
  ArrowLeftRight,
  Settings,
  Bell,
  LogOut,
  KeyRound,
  Truck,
  Megaphone,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";

export type ActionCategory =
  | "create"
  | "view"
  | "toggle"
  | "brand"
  | "account";

export interface ActionContext {
  navigate: (to: string) => void;
  /** Close the palette after the action fires. */
  close: () => void;
  toggleTheme: () => void;
  switchBrand: (brand: string) => void;
  signOut: () => Promise<void> | void;
  /** All brand keys the current user can switch to. */
  availableBrands: string[];
}

export interface PaletteAction {
  key: string;
  label: string;
  hint?: string;
  keywords: string[];
  icon: LucideIcon;
  category: ActionCategory;
  section: string;
  /** RBAC gate: user must satisfy `can(module, action)` for this to show. */
  requires?: { module: string; action: string };
  /** Only surfaces when the user has more than one brand available. */
  requiresMultiBrand?: boolean;
  /** Which brand this action is scoped to (for brand-switch actions). */
  brand?: string;
  run: (ctx: ActionContext) => void | Promise<void>;
}

export const ACTIONS: PaletteAction[] = [
  // ── Create ────────────────────────────────────────────
  {
    key: "sale.new-order",
    label: "New sales order",
    hint: "Start a fresh order",
    keywords: ["new", "order", "sale", "sell", "checkout"],
    icon: ShoppingBag,
    category: "create",
    section: "Create",
    requires: { module: "sales", action: "create" },
    run: (ctx) => {
      ctx.close();
      ctx.navigate("/sales?new=1");
    },
  },
  {
    key: "invoicing.new",
    label: "Create invoice",
    keywords: ["new", "invoice", "bill", "raise"],
    icon: FileText,
    category: "create",
    section: "Create",
    requires: { module: "invoicing", action: "create" },
    run: (ctx) => {
      ctx.close();
      ctx.navigate("/invoicing?new=1");
    },
  },
  {
    key: "contacts.new",
    label: "Add contact",
    keywords: ["new", "contact", "customer", "supplier", "add"],
    icon: UserPlus,
    category: "create",
    section: "Create",
    run: (ctx) => {
      ctx.close();
      ctx.navigate("/contacts?new=1");
    },
  },
  {
    key: "catalogue.new-product",
    label: "New product",
    keywords: ["new", "product", "catalogue", "wig", "sku"],
    icon: Package,
    category: "create",
    section: "Create",
    requires: { module: "catalogue", action: "create" },
    run: (ctx) => {
      ctx.close();
      ctx.navigate("/catalogue?new=1");
    },
  },
  {
    key: "crm.new-deal",
    label: "New CRM deal",
    keywords: ["new", "deal", "pipeline", "opportunity"],
    icon: Users,
    category: "create",
    section: "Create",
    requires: { module: "crm", action: "create" },
    run: (ctx) => {
      ctx.close();
      ctx.navigate("/crm?new=1");
    },
  },
  {
    key: "expenses.new",
    label: "Submit expense",
    keywords: ["new", "expense", "claim", "reimbursement", "receipt"],
    icon: Receipt,
    category: "create",
    section: "Create",
    requires: { module: "expenses", action: "create" },
    run: (ctx) => {
      ctx.close();
      ctx.navigate("/expenses?new=1");
    },
  },
  {
    key: "cash.new-request",
    label: "Request cash",
    keywords: ["new", "cash", "advance", "request", "disbursement"],
    icon: Wallet,
    category: "create",
    section: "Create",
    requires: { module: "expenses", action: "create" },
    run: (ctx) => {
      ctx.close();
      ctx.navigate("/cash-requests?new=1");
    },
  },
  {
    key: "sales.log-payment",
    label: "Log a payment",
    keywords: ["payment", "receive", "record", "log", "cash", "transfer"],
    icon: Wallet,
    category: "create",
    section: "Create",
    requires: { module: "sales", action: "edit" },
    run: (ctx) => {
      ctx.close();
      ctx.navigate("/sales?logPayment=1");
    },
  },
  {
    key: "logistics.new-delivery",
    label: "New delivery",
    keywords: ["new", "delivery", "dispatch", "courier"],
    icon: Truck,
    category: "create",
    section: "Create",
    requires: { module: "logistics", action: "create" },
    run: (ctx) => {
      ctx.close();
      ctx.navigate("/logistics?new=1");
    },
  },
  {
    key: "campaigns.new",
    label: "New sales campaign",
    keywords: ["campaign", "flash", "sale", "landing"],
    icon: Megaphone,
    category: "create",
    section: "Create",
    requires: { module: "sales_campaigns", action: "create" },
    run: (ctx) => {
      ctx.close();
      ctx.navigate("/sales-campaigns?new=1");
    },
  },
  {
    key: "smartcomm.new-message",
    label: "New message",
    keywords: ["message", "chat", "whatsapp", "reply", "compose"],
    icon: MessageSquare,
    category: "create",
    section: "Create",
    requires: { module: "smartcomm", action: "view" },
    run: (ctx) => {
      ctx.close();
      ctx.navigate("/smartcomm?compose=1");
    },
  },

  // ── View / Navigate ───────────────────────────────────
  {
    key: "view.notifications",
    label: "Open notifications",
    keywords: ["notifications", "alerts", "bell", "unread"],
    icon: Bell,
    category: "view",
    section: "Go to",
    run: (ctx) => {
      ctx.close();
      ctx.navigate("/notifications");
    },
  },
  {
    key: "view.settings",
    label: "Open settings",
    keywords: ["settings", "preferences", "configure"],
    icon: Settings,
    category: "view",
    section: "Go to",
    run: (ctx) => {
      ctx.close();
      ctx.navigate("/settings");
    },
  },
  {
    key: "view.praxis",
    label: "Ask Praxis",
    keywords: ["praxis", "ai", "assistant", "ask", "question"],
    icon: Sparkles,
    category: "view",
    section: "Go to",
    run: (ctx) => {
      ctx.close();
      ctx.navigate("/praxis");
    },
  },

  // ── Toggles ───────────────────────────────────────────
  {
    key: "toggle.theme.light",
    label: "Switch to light theme",
    keywords: ["theme", "light", "day", "bright"],
    icon: Sun,
    category: "toggle",
    section: "Preferences",
    run: (ctx) => {
      ctx.toggleTheme();
      ctx.close();
    },
  },
  {
    key: "toggle.theme.dark",
    label: "Switch to dark theme",
    keywords: ["theme", "dark", "night", "black"],
    icon: Moon,
    category: "toggle",
    section: "Preferences",
    run: (ctx) => {
      ctx.toggleTheme();
      ctx.close();
    },
  },

  // ── Brand switch (only surfaces for multi-brand users) ──
  {
    key: "brand.pixiegirl",
    label: "Switch to Pixie Girl Global",
    keywords: ["pixie", "girl", "pxg", "switch", "brand", "entity"],
    icon: ArrowLeftRight,
    category: "brand",
    section: "Business",
    requiresMultiBrand: true,
    brand: "pixiegirl",
    run: (ctx) => {
      ctx.switchBrand("pixiegirl");
      ctx.close();
    },
  },
  {
    key: "brand.faitlynhair",
    label: "Switch to Faitlynhair",
    keywords: ["faitlyn", "hair", "flh", "switch", "brand", "entity"],
    icon: ArrowLeftRight,
    category: "brand",
    section: "Business",
    requiresMultiBrand: true,
    brand: "faitlynhair",
    run: (ctx) => {
      ctx.switchBrand("faitlynhair");
      ctx.close();
    },
  },

  // ── Account ───────────────────────────────────────────
  {
    key: "account.change-password",
    label: "Change password",
    keywords: ["password", "security", "reset", "change"],
    icon: KeyRound,
    category: "account",
    section: "Account",
    run: (ctx) => {
      ctx.close();
      ctx.navigate("/settings?section=security");
    },
  },
  {
    key: "account.sign-out",
    label: "Sign out",
    keywords: ["logout", "sign", "out", "quit"],
    icon: LogOut,
    category: "account",
    section: "Account",
    run: async (ctx) => {
      ctx.close();
      await ctx.signOut();
    },
  },
];

/**
 * Filter the catalogue by user permission + brand availability. `can` follows
 * the auth-store contract: CEOs (permissions ["*"]) return true for anything.
 */
export function permittedActions(
  can: (module: string, action: string) => boolean,
  availableBrands: string[],
  currentBrand: string | null,
  currentTheme: "dark" | "light",
): PaletteAction[] {
  return ACTIONS.filter((a) => {
    if (a.requires && !can(a.requires.module, a.requires.action)) return false;
    if (a.requiresMultiBrand && availableBrands.length < 2) return false;
    // Hide the "switch to X" row when X IS already the current brand.
    if (a.brand && a.brand === currentBrand) return false;
    // Hide the "switch to X theme" row when X IS the current theme.
    if (a.key === "toggle.theme.dark" && currentTheme === "dark") return false;
    if (a.key === "toggle.theme.light" && currentTheme === "light") return false;
    return true;
  });
}

/**
 * Score an action against a query using label + keywords. Same idea as the
 * server-side rank: starts-with wins, then substring on the label, then a
 * keyword hit. Zero score = no match, filter out.
 */
export function scoreAction(action: PaletteAction, q: string): number {
  const needle = q.toLowerCase();
  if (!needle) return 0.01; // let empty queries surface everything
  const label = action.label.toLowerCase();
  if (label.startsWith(needle)) return 3;
  if (label.includes(needle)) return 2;
  if (action.keywords.some((k) => k.toLowerCase().includes(needle))) return 1;
  return 0;
}
