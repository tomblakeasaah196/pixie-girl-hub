import { Link } from "react-router-dom";
import {
  Building2,
  Palette,
  LogIn,
  Coins,
  Receipt,
  Hash,
  LayoutGrid,
  GitBranch,
  CreditCard,
  Wallet,
  Scale,
  Mail,
  FileText,
  Bell,
  CalendarClock,
  KeyRound,
  ShieldCheck,
  HelpCircle,
  ShoppingBag,
  ChevronRight,
  Lock,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Settings landing (canon §2.31). A card grid of every Settings concern,
 * grouped by section. Tiles route to focused sub-pages; a few are
 * deep-links into other modules (Roles → Org & Workflow, Policies →
 * Storefront Studio, Audit → IAM & Security) rather than in-place editors.
 */
interface Tile {
  key: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  to: string;
  /** Deep-link into another module rather than a Settings sub-page. */
  external?: boolean;
  /** Not yet available (module not built) — rendered disabled. */
  soon?: boolean;
}
interface Section {
  title: string;
  tiles: Tile[];
}

const SECTIONS: Section[] = [
  {
    title: "Identity",
    tiles: [
      { key: "business-setup", label: "Business Setup", desc: "Profile, financial, identity & operational policies", icon: Building2, to: "/settings/business-setup" },
      { key: "businesses", label: "Businesses", desc: "List & provision business lines", icon: ShoppingBag, to: "/settings/businesses" },
      { key: "appearance", label: "Appearance", desc: "White-label theme, fonts & per-brand colours", icon: Palette, to: "/settings/appearance" },
      { key: "login", label: "Login Screen", desc: "Hero copy, quotes, regional welcomes & toggles", icon: LogIn, to: "/settings/login" },
      { key: "policies", label: "Business Policies", desc: "Privacy, Refund, QMS, Terms & more — Studio decides web placement", icon: Scale, to: "/settings/policies" },
    ],
  },
  {
    title: "Money",
    tiles: [
      { key: "currencies", label: "Currencies & FX", desc: "Currency catalogue + exchange rates", icon: Coins, to: "/settings/currencies" },
      { key: "tax-rates", label: "Tax Rates", desc: "VAT, WHT & more — enabled system-wide", icon: Receipt, to: "/settings/tax-rates" },
      { key: "payment-gateways", label: "Payment Gateways", desc: "Paystack · Opay · Nomba · Stripe + fees", icon: CreditCard, to: "/settings/payment-gateways" },
      { key: "bank-accounts", label: "Bank Accounts", desc: "Company accounts (masked) & payout links", icon: Wallet, to: "/settings/bank-accounts" },
    ],
  },
  {
    title: "Operations",
    tiles: [
      { key: "document-numbering", label: "Document Numbering", desc: "Prefixes, padding & sequences", icon: Hash, to: "/settings/document-numbering" },
      { key: "custom-fields", label: "Custom Fields", desc: "Per-entity field definitions", icon: LayoutGrid, to: "/settings/custom-fields" },
      { key: "pipeline-stages", label: "Pipeline Stages", desc: "CRM, delivery, PO & production stages", icon: GitBranch, to: "/settings/pipeline-stages" },
      { key: "scheduled-reports", label: "Scheduled Reports", desc: "Automated report delivery", icon: CalendarClock, to: "/settings/scheduled-reports" },
    ],
  },
  {
    title: "Communication",
    tiles: [
      { key: "document-templates", label: "Document Templates", desc: "Invoices, POs, receipts, contracts", icon: FileText, to: "/settings/document-templates" },
      { key: "email-signatures", label: "Email Signatures", desc: "Brand template & per-staff render", icon: Mail, to: "/settings/email-signatures" },
      { key: "notifications", label: "Notifications", desc: "Your channel & category preferences", icon: Bell, to: "/settings/notifications" },
    ],
  },
  {
    title: "Integrations & Security",
    tiles: [
      { key: "integration-secrets", label: "API Keys & Secrets", desc: "Encrypted, write-only third-party keys", icon: KeyRound, to: "/settings/integration-secrets" },
      { key: "iam", label: "IAM & Security", desc: "Audit log, sessions & access (module)", icon: ShieldCheck, to: "/iam-security", external: true },
      { key: "roles", label: "Roles & Access", desc: "Permission matrix (Org & Workflow)", icon: Lock, to: "/org-builder", external: true },
      { key: "help", label: "Help Center", desc: "Guides & FAQs", icon: HelpCircle, to: "/help", external: true },
    ],
  },
];

export function SettingsHome() {
  return (
    <div className="max-w-[1000px]">
      <div className="mb-6">
        <h2 className="font-display text-[22px] font-medium">Settings</h2>
        <p className="text-text-muted text-[13px] mt-1">
          Configure the hub. Business identity, money, operations,
          communication & integrations — all DB-driven.
        </p>
      </div>

      {SECTIONS.map((section) => (
        <section key={section.title} className="mb-7">
          <div className="micro mb-3">{section.title}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {section.tiles.map((t) => (
              <SettingsTile key={t.key} tile={t} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SettingsTile({ tile }: { tile: Tile }) {
  const Icon = tile.icon;
  const body = (
    <>
      <span
        className={cn(
          "grid place-items-center w-10 h-10 rounded-xl border shrink-0",
          tile.external
            ? "bg-info/10 text-info border-info/20"
            : "bg-accent/10 text-accent-glow border-accent/20",
        )}
      >
        <Icon className="w-[18px] h-[18px]" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="font-display text-[15px] truncate">{tile.label}</span>
          {tile.external && (
            <span className="text-[9px] uppercase tracking-wide text-info/80 border border-info/30 rounded px-1 py-px">
              module
            </span>
          )}
        </span>
        <span className="block text-text-faint text-[12px] mt-0.5 leading-snug">
          {tile.desc}
        </span>
      </span>
      <ChevronRight className="w-[18px] h-[18px] text-text-faint group-hover:text-accent-glow group-hover:translate-x-0.5 transition-all shrink-0" />
    </>
  );

  const cls =
    "glass rounded-[var(--radius)] shadow-glass p-4 flex items-center gap-3.5 transition-all group hover:border-accent/40";

  if (tile.soon) {
    return (
      <div className={cn(cls, "opacity-50 cursor-not-allowed")} aria-disabled>
        {body}
      </div>
    );
  }
  return (
    <Link to={tile.to} className={cls}>
      {body}
    </Link>
  );
}
