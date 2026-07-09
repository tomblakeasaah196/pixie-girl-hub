import { Link } from "react-router-dom";
import {
  ShieldCheck,
  Sparkles,
  KeyRound,
  Gauge,
  Lightbulb,
  GraduationCap,
  ChevronRight,
  Activity,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { Card } from "@/components/ui/primitives";

/**
 * AI Control landing. Each tile deep-links into a sub-page. Brand
 * Voice is the only fully-built tile in PR 3; the others (flags,
 * grants, vendors, budgets) are planned and link to placeholders
 * until they ship.
 */
const TILES = [
  {
    icon: Lightbulb,
    title: "Insights",
    body: "Pick which of the 27 modules Praxis watches — tier-1 rules (free) and AI narration (per module), with frequency.",
    href: "/ai-control/insights",
    ready: true,
  },
  {
    icon: Sparkles,
    title: "Brand Voice",
    body: "Per-brand tone, signature, do/don'ts, FAQ & sample transcripts for Praxis drafts.",
    href: "/ai-control/brand-voice",
    ready: true,
  },
  {
    icon: GraduationCap,
    title: "Knowledge & Training",
    body: "Upload files (docs, PDFs, images, media) or teach facts. Praxis embeds them and recalls them in future answers.",
    href: "/ai-control/training",
    ready: true,
  },
  {
    icon: KeyRound,
    title: "Vendors & Models",
    body: "DeepSeek primary, Gemini fallback. Pick the model per vendor; pricing recomputes from the catalogue immediately.",
    href: "/ai-control/vendors",
    ready: true,
  },
  {
    icon: Gauge,
    title: "Spend & budget",
    body: "Tiered caps: internal AI blocks first, storefront stays online under its own cap. Per-feature & per-vendor spend.",
    href: "/ai-control/budget",
    ready: true,
  },
  {
    icon: ShieldCheck,
    title: "Feature flags & access",
    body: "Per-brand toggles, per-user daily caps, custom “Praxis is resting” copy. Every change audit-logged.",
    href: "/ai-control/governance",
    ready: true,
  },
  {
    icon: Activity,
    title: "AI Health & Logs",
    body: "Live vendor status, failure rate per vendor, recent errors, failover incidents. This is where you'd have seen the July 2026 outage on day one.",
    href: "/ai-control/health",
    ready: true,
  },
];

export function AiControlPage() {
  useBreadcrumbs([{ label: "AI Control" }]);
  return (
    <div className="max-w-[920px] mx-auto">
      <header className="flex items-center gap-3 mb-5">
        <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20">
          <ShieldCheck className="w-5 h-5" />
        </span>
        <div>
          <h2 className="font-display text-[22px] font-medium">AI Control</h2>
          <p className="text-text-muted text-[13px]">
            Governance, brand voice, vendor keys and live spend in one place.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {TILES.map((t) => {
          const Icon = t.icon;
          const inner = (
            <Card
              className={`p-4 hover:border-accent/40 transition-colors h-full ${
                !t.ready ? "opacity-60" : ""
              }`}
            >
              <div className="flex items-start gap-3">
                <Icon className="w-5 h-5 text-accent-glow shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-display text-[15px] flex items-center gap-2">
                    {t.title}
                    {!t.ready && (
                      <span className="text-[10px] uppercase tracking-widest text-text-faint border hairline rounded-full px-1.5 py-[1px]">
                        soon
                      </span>
                    )}
                  </div>
                  <p className="text-text-muted text-[12.5px] leading-relaxed mt-1">
                    {t.body}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-text-faint shrink-0 mt-1" />
              </div>
            </Card>
          );
          return t.ready ? (
            <Link key={t.title} to={t.href}>
              {inner}
            </Link>
          ) : (
            <div key={t.title}>{inner}</div>
          );
        })}
      </div>
    </div>
  );
}
