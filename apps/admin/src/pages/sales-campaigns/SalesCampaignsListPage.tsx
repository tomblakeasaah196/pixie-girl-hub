import { useDeferredValue, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Megaphone,
  Plus,
  Search,
  TrendingUp,
  Sparkles,
  CalendarRange,
  LayoutTemplate,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import {
  Button,
  Card,
  EmptyState,
  KpiTile,
  Pill,
  Skeleton,
  type Tone,
} from "@/components/ui/primitives";
import { DeniedState, ErrorState, Select } from "@/components/ui/controls";
import { Modal } from "@/components/ui/Modal";
import { Field } from "@/components/ui/Form";
import { moneyCompact } from "@/lib/format";
import {
  useCampaignList,
  useCreateCampaign,
  type Campaign,
  type CampaignStatus,
} from "@/lib/campaigns";

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All states" },
  { value: "draft", label: "Drafts" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "scheduled", label: "Scheduled" },
  { value: "live", label: "Live now" },
  { value: "paused", label: "Paused" },
  { value: "ended", label: "Ended" },
];

const TONE_FOR: Record<CampaignStatus, Tone> = {
  draft: "neutral",
  pending_approval: "warn",
  scheduled: "info",
  live: "success",
  paused: "warn",
  ended: "neutral",
  archived: "neutral",
};

const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending",
  scheduled: "Scheduled",
  live: "Live now",
  paused: "Paused",
  ended: "Ended",
  archived: "Archived",
};

// Escape a URL for safe interpolation inside a CSS `url(...)` value. The
// validator already restricts URLs to http/https, but defence-in-depth: a
// stray `)`, quote, or backslash anywhere in the path/query would break out
// of the url() function and let us inject arbitrary CSS. encodeURI keeps the
// URL navigable; the targeted replaces neutralise the few characters that
// matter for CSS escape.
function cssUrl(raw: string): string {
  return encodeURI(raw).replace(/["'()\\]/g, (c) => `\\${c}`);
}

function safeNumber(value: number | string | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function SalesCampaignsListPage() {
  useBreadcrumbs([{ label: "Sales Campaigns" }]);
  const { can } = useAuthStore();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const navigate = useNavigate();
  // useDeferredValue lets React keep the input snappy while still throttling
  // network fetches as the user types.
  const deferredQ = useDeferredValue(q);
  const list = useCampaignList({
    status: status || undefined,
    q: deferredQ || undefined,
    page_size: 50,
  });

  const campaigns = (list.data?.data || []) as Campaign[];
  const rollups = useMemo(() => {
    let live = 0;
    let scheduled = 0;
    let revenue = 0;
    let orders = 0;
    let signups = 0;
    for (const c of campaigns) {
      if (c.status === "live") live++;
      if (c.status === "scheduled") scheduled++;
      revenue += safeNumber(c.total_revenue_ngn);
      orders += safeNumber(c.total_orders);
      signups += safeNumber(c.total_signups);
    }
    return { live, scheduled, revenue, orders, signups };
  }, [campaigns]);

  // Permission gate AFTER all hooks — hooks must run in the same order every
  // render (Rules of Hooks), so an early return can't sit above useMemo.
  if (!can("sales_campaigns", "view")) {
    return (
      <DeniedState message="You don't have access to Sales Campaigns. Ask an admin in Org & Workflow." />
    );
  }
  const canCreate = can("sales_campaigns", "create");

  return (
    <div className="space-y-5">
      {/* Hero strip */}
      <Card className="p-6 md:p-7 relative overflow-hidden">
        <div
          className="absolute -top-16 -right-12 w-[320px] h-[320px] rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(circle at 30% 30%, rgb(var(--accent-deep)/0.45), transparent 65%)",
            filter: "blur(38px)",
          }}
        />
        <div className="relative flex flex-col md:flex-row md:items-end gap-5">
          <div className="min-w-0">
            <div className="micro mb-2">
              Module · Sales Campaigns & Landing Pages
            </div>
            <h1 className="font-display text-[34px] md:text-[40px] leading-[1.05]">
              <span>The next ₦100M sale begins </span>
              <span className="italic text-accent-glow">here.</span>
            </h1>
            <p className="text-text-muted mt-2.5 max-w-[640px]">
              Build a campaign with Praxis, launch the landing page to your
              sales subdomain, and watch the dashboard convert in real time.
            </p>
          </div>
          <div className="md:ml-auto flex flex-wrap items-center gap-2">
            {can("sales_campaigns", "view") && (
              <Button
                size="md"
                variant="ghost"
                icon={<LayoutTemplate className="w-4 h-4" />}
                onClick={() => navigate("/landing-studio")}
              >
                Landing Studio
              </Button>
            )}
            {canCreate && (
              <Button
                size="md"
                variant="primary"
                className="cta-breathe"
                icon={<Plus className="w-4 h-4" />}
                onClick={() => setCreateOpen(true)}
              >
                New campaign
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KpiTile label="Live now" value={String(rollups.live)} tone="accent" />
        <KpiTile
          label="Scheduled"
          value={String(rollups.scheduled)}
          tone="accent"
        />
        <KpiTile
          label="Revenue"
          value={moneyCompact(rollups.revenue)}
          tone="accent"
        />
        <KpiTile label="Orders" value={String(rollups.orders)} tone="accent" />
        <KpiTile
          label="Signups"
          value={String(rollups.signups)}
          tone="accent"
        />
      </div>

      {/* Filters */}
      <Card className="p-3 md:p-4">
        <div className="flex flex-col md:flex-row gap-3 md:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or slug…"
              className="w-full h-[42px] pl-9 pr-3 rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px]"
            />
          </div>
          <div className="md:w-[220px]">
            <Select<string>
              value={status}
              onChange={setStatus}
              options={STATUS_OPTIONS}
            />
          </div>
          <div className="ml-auto">
            <Link
              to="/sales-campaigns/bundles"
              className="text-[12px] font-semibold text-accent-glow hover:underline"
            >
              Manage bundles →
            </Link>
          </div>
        </div>
      </Card>

      {/* Cards grid */}
      {list.isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="p-5 space-y-3">
              <Skeleton style={{ height: 18, width: "60%" }} />
              <Skeleton style={{ height: 12, width: "40%" }} />
              <Skeleton style={{ height: 60 }} />
            </Card>
          ))}
        </div>
      )}
      {list.isError && <ErrorState onRetry={() => list.refetch()} />}
      {!list.isLoading && !list.isError && campaigns.length === 0 && (
        <Card className="p-2">
          <EmptyState
            icon={<Megaphone className="w-7 h-7" />}
            title="No campaigns yet"
            message={
              canCreate
                ? "Create your first sales campaign — Praxis can draft the layout and copy from a single sentence."
                : "Ask an admin to grant 'sales_campaigns.create' permission to start."
            }
            action={
              canCreate ? (
                <Button
                  variant="primary"
                  icon={<Sparkles className="w-4 h-4" />}
                  onClick={() => setCreateOpen(true)}
                >
                  Build with Praxis
                </Button>
              ) : null
            }
          />
        </Card>
      )}
      {campaigns.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {campaigns.map((c) => (
            <CampaignCard key={c.campaign_id} campaign={c} />
          ))}
        </div>
      )}

      {/* Create modal */}
      <CreateCampaignModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => navigate(`/sales-campaigns/${id}`)}
      />
    </div>
  );
}

function CampaignCard({ campaign }: { campaign: Campaign }) {
  const state = campaign.public_state || "before";
  const tone = TONE_FOR[campaign.status];
  const ends = new Date(campaign.ends_at);
  const starts = new Date(campaign.starts_at);
  const now = Date.now();
  const total = ends.getTime() - starts.getTime();
  const elapsed = Math.max(0, Math.min(total, now - starts.getTime()));
  const pct = total > 0 ? Math.round((elapsed / total) * 100) : 0;

  return (
    <Link
      to={`/sales-campaigns/${campaign.campaign_id}`}
      className="group block"
    >
      <Card className="overflow-hidden transition-all duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_18px_44px_rgb(0_0_0/0.5),0_0_0_1px_rgb(var(--accent)/0.35)]">
        <div
          className="h-28 relative"
          style={{
            backgroundImage: campaign.landing_hero_image_url
              ? `linear-gradient(180deg, rgb(0 0 0 / 0.05) 0%, rgb(var(--panel)/0.7) 100%), url("${cssUrl(campaign.landing_hero_image_url)}")`
              : "linear-gradient(135deg, rgb(var(--accent-deep)/0.6), rgb(var(--panel)/0.9))",
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        >
          <div className="absolute top-3 left-3 flex gap-1.5">
            <Pill tone={tone}>{STATUS_LABEL[campaign.status]}</Pill>
            {campaign.ai_assist_pct > 0 && (
              <Pill tone="accent" dot={false}>
                <Sparkles className="w-3 h-3" />{" "}
                {Math.round(campaign.ai_assist_pct * 100)}% AI
              </Pill>
            )}
          </div>
          <div className="absolute bottom-2 left-3 right-3">
            <div className="font-display font-medium text-[18px] leading-tight text-text-primary truncate drop-shadow">
              {campaign.name}
            </div>
            <div className="micro text-text-muted truncate">
              /sale/{campaign.slug}
            </div>
          </div>
        </div>
        <div className="p-4 space-y-3">
          {/* Progress bar (live) */}
          {(state === "live" || campaign.status === "scheduled") && (
            <div>
              <div className="flex justify-between text-[11px] text-text-faint mb-1">
                <span className="font-mono">
                  {new Date(starts).toLocaleDateString()}
                </span>
                <span className="font-mono">
                  {new Date(ends).toLocaleDateString()}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-text-primary/10 overflow-hidden">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}
          <div className="grid grid-cols-3 gap-1 text-center">
            <Stat
              label="Visitors"
              value={safeNumber(campaign.total_unique_visitors)}
            />
            <Stat label="Orders" value={safeNumber(campaign.total_orders)} />
            <Stat
              label="Revenue"
              value={moneyCompact(safeNumber(campaign.total_revenue_ngn))}
              isMoney
            />
          </div>
        </div>
      </Card>
    </Link>
  );
}

function Stat({
  label,
  value,
  isMoney,
}: {
  label: string;
  value: number | string;
  isMoney?: boolean;
}) {
  const display = isMoney ? String(value) : safeNumber(value).toLocaleString();
  return (
    <div className="rounded-[10px] bg-text-primary/[0.04] py-1.5">
      <div className="font-display font-medium text-[15px] tabular-nums">
        {display}
      </div>
      <div className="micro" style={{ fontSize: 8.5 }}>
        {label}
      </div>
    </div>
  );
}

function CreateCampaignModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const create = useCreateCampaign();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  // Discount is fully optional — the user can ship a campaign without a
  // top-level discount and let bundles / per-position ladders carry pricing.
  // "" = no discount set; the API stores NULL and the builder lets the user
  // fill it in later under Brief → Top-level discount.
  const [discountType, setDiscountType] = useState("");
  const [discountValue, setDiscountValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Auto-generate from the name (full normalisation — the user isn't typing
  // in the slug box, so trimming stray hyphens is safe here).
  function slugifyName(input: string) {
    return input
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-|-$/g, "");
  }
  // Gentle cleaning WHILE typing in the slug box — keeps a trailing hyphen so
  // "pixie-summer-sale" can be typed one character at a time.
  function cleanSlugInput(raw: string) {
    return raw
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-{2,}/g, "-");
  }
  // Final pass on submit — trims any leading/trailing hyphen.
  function finalizeSlug(raw: string) {
    return raw.replace(/^-+|-+$/g, "");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const created = await create.mutateAsync({
        name,
        slug: finalizeSlug(slug) || slugifyName(name),
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
        // Both discount fields are optional. Send null when blank so the
        // backend stores NULL rather than failing the schema; bundles or
        // ladders can carry the pricing instead.
        discount_type: discountType
          ? (discountType as Campaign["discount_type"])
          : null,
        discount_value: discountValue ? Number(discountValue) : null,
      });
      onCreated(created.campaign_id);
    } catch (e: unknown) {
      setError((e as Error)?.message || "Failed to create campaign");
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New sales campaign">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Campaign name">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugifyName(e.target.value));
            }}
            placeholder="Black Friday Drop 2026"
            required
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px]"
          />
        </Field>
        <Field label="URL slug" hint={`/sale/${slug || "your-slug"}`}>
          <input
            value={slug}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(cleanSlugInput(e.target.value));
            }}
            placeholder="black-friday-2026"
            required
            className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 font-mono text-[13px]"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts">
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              required
              className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px]"
            />
          </Field>
          <Field label="Ends">
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              required
              className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px]"
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Discount type" hint="Optional — leave blank for none">
            <Select<string>
              value={discountType}
              onChange={setDiscountType}
              options={[
                { value: "", label: "None (set later)" },
                { value: "percentage", label: "Percentage off" },
                { value: "fixed_amount", label: "Fixed ₦ off" },
                { value: "bundle", label: "Bundle" },
                { value: "buy_x_get_y", label: "Buy X get Y" },
              ]}
            />
          </Field>
          <Field
            label={
              discountType === "percentage" ? "Discount (0–1)" : "Discount ₦"
            }
            hint={
              !discountType
                ? "Optional — fill in later"
                : discountType === "percentage"
                  ? "e.g. 0.20 = 20%"
                  : "in NGN"
            }
          >
            <input
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              disabled={!discountType}
              placeholder={discountType ? "" : "—"}
              className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 font-mono text-[13px] tabular-nums disabled:opacity-40"
            />
          </Field>
        </div>
        {error && <p className="text-[12px] text-danger">{error}</p>}
        <p className="text-[12px] text-text-faint flex items-center gap-2">
          <CalendarRange className="w-3.5 h-3.5" />
          You can fine-tune everything in the builder after creating.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-3 rounded-[10px] text-[13px] font-semibold text-text-muted hover:bg-text-primary/[0.06]"
          >
            Cancel
          </button>
          <Button
            type="submit"
            variant="primary"
            disabled={create.isPending}
            icon={<TrendingUp className="w-4 h-4" />}
          >
            {create.isPending ? "Creating…" : "Create & open builder"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
