import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, Package, Search } from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import {
  Card,
  EmptyState,
  Pill,
  Skeleton,
} from "@/components/ui/primitives";
import { DeniedState, ErrorState } from "@/components/ui/controls";
import { useBundleList } from "@/lib/campaigns";

const prettyModel = (m?: string) =>
  (m || "").replace(/_/g, " ").replace(/\bngn\b/i, "₦") || "—";

const primaryLinkCls =
  "inline-flex items-center justify-center gap-2 h-10 px-4 text-[13px] font-semibold rounded-xl border bg-accent-deep border-accent-deep text-[#F4E9D9] hover:bg-accent transition-all duration-300";

/**
 * Read-only window onto the Catalogue bundles (the single source of truth,
 * retention.bundle_offers). Bundles are AUTHORED in Catalogue → Bundles; this
 * page exists so the campaigns area can see what's available to attach. Pricing,
 * composition, hero and edits all live in Catalogue and reflect on campaigns
 * the instant they're saved — there is no campaign-side bundle to edit.
 */
export function CampaignBundlesPage() {
  useBreadcrumbs([
    { label: "Sales Campaigns", href: "/sales-campaigns" },
    { label: "Bundles" },
  ]);
  const { can } = useAuthStore();
  const [q, setQ] = useState("");
  const list = useBundleList(q || undefined);

  if (!can("sales_campaigns", "view")) return <DeniedState />;
  const bundles = list.data?.data || [];

  return (
    <div className="space-y-4">
      <Card className="p-5 relative overflow-hidden">
        <div
          className="absolute -top-12 -right-8 w-[220px] h-[220px] rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgb(var(--accent-deep)/0.4), transparent 70%)",
            filter: "blur(34px)",
          }}
        />
        <div className="relative flex items-center gap-3 flex-wrap">
          <Link
            to="/sales-campaigns"
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-text-muted hover:text-text-primary"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Sales Campaigns
          </Link>
        </div>
        <div className="relative mt-3 flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-display text-[28px] leading-tight">
              Catalogue bundles
            </h1>
            <p className="text-text-muted text-[13px] mt-1 max-w-[620px]">
              Bundles live in one place — Catalogue → Bundles. They&rsquo;re
              curated there, then imported into a campaign by reference, so any
              edit to a bundle reflects on every live campaign instantly. This
              list is read-only.
            </p>
          </div>
          <Link to="/catalogue?tab=bundles" className={primaryLinkCls}>
            <ArrowUpRight className="w-4 h-4" /> Manage in Catalogue
          </Link>
        </div>
      </Card>

      <Card className="p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search bundles…"
            className="w-full h-[42px] pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px]"
          />
        </div>
      </Card>

      {list.isLoading && <Skeleton style={{ height: 180 }} />}
      {list.isError && <ErrorState onRetry={() => list.refetch()} />}
      {!list.isLoading && bundles.length === 0 && (
        <Card className="p-2">
          <EmptyState
            icon={<Package className="w-7 h-7" />}
            title="No bundles in your catalogue yet"
            message="Build bundles under Catalogue → Bundles, then import them into a campaign from the campaign builder."
            action={
              <Link to="/catalogue?tab=bundles" className={primaryLinkCls}>
                Go to Catalogue → Bundles
              </Link>
            }
          />
        </Card>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {bundles.map((b) => (
          <Card key={b.bundle_id} className="p-4 flex gap-3">
            <div
              className="w-20 h-20 rounded-[14px] bg-text-primary/[0.06] grid place-items-center text-text-faint flex-shrink-0"
              style={
                b.hero_image_url
                  ? {
                      backgroundImage: `url(${b.hero_image_url})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }
                  : undefined
              }
            >
              {!b.hero_image_url && <Package className="w-7 h-7" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="font-display font-medium text-[16px] truncate flex-1">
                  {b.name}
                </div>
                <Pill
                  tone={b.status === "active" ? "success" : "neutral"}
                  dot={false}
                >
                  {b.status}
                </Pill>
              </div>
              <div className="micro mt-0.5">/{b.slug}</div>
              <div className="flex flex-wrap gap-2 mt-2 text-[11.5px] text-text-muted">
                <Pill tone="info" dot={false}>
                  {prettyModel(
                    (b as { pricing_model?: string }).pricing_model,
                  )}
                </Pill>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
