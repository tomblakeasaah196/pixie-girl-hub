import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Eye,
  Image as ImageIcon,
  Layers,
  PackagePlus,
  Pencil,
  Plus,
  Send,
  Settings,
  Sparkles,
  Trash2,
  Users,
  Wand2,
} from "lucide-react";
import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useAuthStore } from "@/stores/auth";
import {
  Button,
  Card,
  EmptyState,
  KpiTile,
  MoneyText,
  Pill,
  Skeleton,
  type Tone,
} from "@/components/ui/primitives";
import {
  DeniedState,
  ErrorState,
  NumberField,
  Select,
  Toggle,
} from "@/components/ui/controls";
import { Drawer } from "@/components/ui/Drawer";
import { Modal } from "@/components/ui/Modal";
import { Field, FormSection } from "@/components/ui/Form";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import {
  type Campaign,
  type CampaignBundleLink,
  type QuantityTier,
  type CartUpsell,
  type Bundle,
  type CampaignStatus,
  useAttachCampaignBundle,
  useBrand,
  useBundleList,
  useCampaign,
  useCampaignAmbassadors,
  useCampaignBundles,
  useCampaignTransition,
  useCampaignTiers,
  useCampaignUpsells,
  useDeleteTier,
  useDeleteUpsell,
  useDetachCampaignBundle,
  usePraxisDraftCopy,
  usePraxisSuggestLayout,
  usePraxisAccept,
  useUpdateCampaign,
  useUpsertTier,
  useUpsertUpsell,
} from "@/lib/campaigns";
import { LandingStudio } from "./landing/LandingStudio";

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
  pending_approval: "Pending approval",
  scheduled: "Scheduled",
  live: "Live now",
  paused: "Paused",
  ended: "Ended",
  archived: "Archived",
};

const STEPS = [
  { key: "brief", label: "Brief", icon: Settings },
  { key: "bundles", label: "Bundles", icon: PackagePlus },
  { key: "pricing", label: "Pricing", icon: Wand2 },
  { key: "landing", label: "Landing page", icon: Layers },
  { key: "ambassadors", label: "Share & ambassadors", icon: Users },
  { key: "approval", label: "Approval & launch", icon: Send },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

const BLOCK_LIBRARY: Array<{
  key: string;
  label: string;
  description: string;
}> = [
  { key: "hero", label: "Hero", description: "Cinematic top of page" },
  { key: "countdown", label: "Countdown", description: "Live tabular timer" },
  {
    key: "bundle_showcase",
    label: "Bundle Showcase",
    description: "Curated category bundles",
  },
  {
    key: "quantity_tier_visualiser",
    label: "Tier Ladder",
    description: "Buy more save more",
  },
  {
    key: "featured_products",
    label: "Featured Products",
    description: "Individual styled products",
  },
  {
    key: "lookbook_carousel",
    label: "Lookbook Carousel",
    description: "Reels-style scroll",
  },
  {
    key: "stock_counter",
    label: "Live Stock",
    description: "Real-time remaining count",
  },
  { key: "brand_story", label: "Brand Story", description: "Why this drop" },
  {
    key: "founder_quote",
    label: "Founder Quote",
    description: "Trust + intent",
  },
  { key: "why_buy", label: "Why Buy", description: "3-bullet value props" },
  {
    key: "testimonials",
    label: "Testimonials",
    description: "Real customer quotes",
  },
  {
    key: "ugc_carousel",
    label: "UGC Carousel",
    description: "IG posts + customer clips",
  },
  { key: "faq", label: "FAQ", description: "Pre-empt friction" },
  { key: "wig_care", label: "Wig Care", description: "Care guide snippet" },
  {
    key: "stylist_spotlight",
    label: "Stylist Spotlight",
    description: "Showcase a stylist",
  },
  {
    key: "shipping_returns",
    label: "Shipping & Returns",
    description: "DHL info + policy",
  },
  {
    key: "newsletter_capture",
    label: "Newsletter",
    description: "Email signup",
  },
  {
    key: "vip_signup",
    label: "VIP Signup",
    description: "Pre-launch heads-up",
  },
];

export function CampaignBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const campaignQ = useCampaign(id);
  const { can } = useAuthStore();
  const [step, setStep] = useState<StepKey>("brief");
  const [praxisOpen, setPraxisOpen] = useState(false);

  useBreadcrumbs([
    { label: "Sales Campaigns", href: "/sales-campaigns" },
    { label: campaignQ.data?.name || "Loading…" },
  ]);

  if (!can("sales_campaigns", "view")) {
    return <DeniedState />;
  }
  if (campaignQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton style={{ height: 50 }} />
        <Skeleton style={{ height: 200 }} />
      </div>
    );
  }
  if (campaignQ.isError || !campaignQ.data) {
    return <ErrorState onRetry={() => campaignQ.refetch()} />;
  }
  const campaign = campaignQ.data;
  const canEdit =
    can("sales_campaigns", "edit") &&
    ["draft", "pending_approval", "scheduled", "live", "paused"].includes(
      campaign.status,
    );
  const isLiveEdit = canEdit && campaign.status === "live";

  return (
    <div className="space-y-4">
      <CampaignHeader
        campaign={campaign}
        onPraxis={() => setPraxisOpen(true)}
      />
      {isLiveEdit && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-[11px] bg-warn/10 border border-warn/30">
          <div className="w-2 h-2 rounded-full bg-warn animate-pulse shrink-0" />
          <span className="text-[12.5px] font-semibold text-warn">
            This campaign is live. Changes are published immediately.
          </span>
        </div>
      )}
      <Stepper active={step} onChange={setStep} />
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
        <div>
          {step === "brief" && (
            <BriefStep
              campaign={campaign}
              canEdit={canEdit}
              onNext={() => setStep("bundles")}
            />
          )}
          {step === "bundles" && (
            <BundlesStep campaign={campaign} canEdit={canEdit} />
          )}
          {step === "pricing" && (
            <PricingStep campaign={campaign} canEdit={canEdit} />
          )}
          {step === "landing" && (
            <LandingStep
              campaign={campaign}
              canEdit={canEdit}
              onNext={() => setStep("ambassadors")}
            />
          )}
          {step === "ambassadors" && (
            <AmbassadorsStep campaign={campaign} canEdit={canEdit} />
          )}
          {step === "approval" && <ApprovalStep campaign={campaign} />}
        </div>
        <PraxisSidebar campaign={campaign} step={step} />
      </div>
      <PraxisAssistDrawer
        open={praxisOpen}
        onClose={() => setPraxisOpen(false)}
        campaign={campaign}
      />
    </div>
  );
}

// ── Campaign header ──────────────────────────────────────
function CampaignHeader({
  campaign,
  onPraxis,
}: {
  campaign: Campaign;
  onPraxis: () => void;
}) {
  const brand = useBrand();
  return (
    <Card className="p-5 relative overflow-hidden">
      <div
        className="absolute -top-12 -right-8 w-[240px] h-[240px] rounded-full pointer-events-none"
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
          <ArrowLeft className="w-3.5 h-3.5" /> All campaigns
        </Link>
        <Pill tone={TONE_FOR[campaign.status]}>
          {STATUS_LABEL[campaign.status]}
        </Pill>
        {campaign.ai_assist_pct > 0 && (
          <Pill tone="accent" dot={false}>
            <Sparkles className="w-3 h-3" /> Drafted with Praxis ·{" "}
            {Math.round(campaign.ai_assist_pct * 100)}%
          </Pill>
        )}
        <div className="ml-auto flex gap-2">
          <Button
            variant="ghost"
            icon={<Eye className="w-4 h-4" />}
            onClick={() =>
              window.open(
                `/sale/${campaign.slug}?brand=${brand}`,
                "_blank",
                "noopener",
              )
            }
          >
            View live page
          </Button>
          <Button
            variant="primary"
            icon={<Sparkles className="w-4 h-4" />}
            onClick={onPraxis}
          >
            Build with Praxis
          </Button>
        </div>
      </div>
      <div className="mt-3">
        <h1 className="font-display text-[26px] md:text-[32px] leading-tight">
          {campaign.name}
        </h1>
        <div className="micro mt-1 truncate">/sale/{campaign.slug}</div>
      </div>
    </Card>
  );
}

// ── Stepper ──────────────────────────────────────────────
function Stepper({
  active,
  onChange,
}: {
  active: StepKey;
  onChange: (s: StepKey) => void;
}) {
  return (
    <Card className="p-2">
      <div className="flex gap-1 overflow-x-auto">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const isActive = active === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onChange(s.key)}
              className={cn(
                "flex-1 min-w-[120px] flex items-center gap-2 px-3 py-2 rounded-[11px] text-[12.5px] font-semibold transition-colors whitespace-nowrap",
                isActive
                  ? "bg-accent-deep text-[#F4E9D9]"
                  : "text-text-muted hover:bg-text-primary/[0.06] hover:text-text-primary",
              )}
            >
              <span className="grid place-items-center w-6 h-6 rounded-full bg-text-primary/[0.05] font-display text-[11px]">
                {i + 1}
              </span>
              <Icon className="w-3.5 h-3.5" />
              {s.label}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ── Praxis attribution sidebar ───────────────────────────
function PraxisSidebar({
  campaign,
  step,
}: {
  campaign: Campaign;
  step: StepKey;
}) {
  return (
    <div className="space-y-3">
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="w-4 h-4 text-accent-glow" />
          <span className="micro">Praxis on this step</span>
        </div>
        <div className="text-[12.5px] text-text-muted leading-relaxed">
          {step === "brief" &&
            "Set the campaign name, slug and dates. Praxis uses your voice profile to write copy in the next steps."}
          {step === "bundles" &&
            "Bundles are catalogue entities. Attach existing bundles or create new ones — fixed composition, per-item ₦ discount."}
          {step === "pricing" &&
            "Goal-seek margin, charm round, configure the tier ladder + cart upsell escalator. Floors are enforced — Praxis refuses any breach."}
          {step === "landing" &&
            "Drag blocks from the library, reorder, edit copy inline. Preview Before / Live / Ended states."}
          {step === "ambassadors" &&
            "Promote contacts to ambassadors, mint per-ambassador trackable links. Share kit auto-generates copy for every channel."}
          {step === "approval" &&
            "Submit for approval. Anyone with sales_campaigns.approve can launch."}
        </div>
        <div className="mt-3 text-[11px] text-text-faint">
          Voice:{" "}
          <span className="text-accent-glow">
            {campaign.voice_profile_override?.tone || "editorial-luxury"}
          </span>
        </div>
      </Card>
      <Card className="p-4">
        <div className="micro mb-3">At a glance</div>
        <div className="space-y-2 text-[12.5px]">
          <Row
            label="Starts"
            value={new Date(campaign.starts_at).toLocaleString()}
          />
          <Row
            label="Ends"
            value={new Date(campaign.ends_at).toLocaleString()}
          />
          <Row
            label="Visitors"
            value={String(campaign.total_unique_visitors)}
          />
          <Row label="Orders" value={String(campaign.total_orders)} />
          <Row
            label="Revenue"
            value={money(Number(campaign.total_revenue_ngn || 0))}
          />
        </div>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-text-faint">{label}</span>
      <span className="font-mono tabular-nums text-text-primary truncate text-right">
        {value}
      </span>
    </div>
  );
}

// ── Step 1: Brief ────────────────────────────────────────
function BriefStep({
  campaign,
  canEdit,
  onNext,
}: {
  campaign: Campaign;
  canEdit: boolean;
  onNext?: () => void;
}) {
  const update = useUpdateCampaign(campaign.campaign_id);
  const [name, setName] = useState(campaign.name);
  const [slug, setSlug] = useState(campaign.slug);
  const [description, setDescription] = useState(campaign.description || "");
  const [startsAt, setStartsAt] = useState(toLocalInput(campaign.starts_at));
  const [endsAt, setEndsAt] = useState(toLocalInput(campaign.ends_at));
  const [viewerPolicy, setViewerPolicy] = useState<string>(
    campaign.show_viewer_count_policy || "",
  );
  const [viewerFloor, setViewerFloor] = useState<string>(
    campaign.viewer_count_floor != null
      ? String(campaign.viewer_count_floor)
      : "",
  );
  const [vipMins, setVipMins] = useState<string>(
    String(campaign.vip_early_access_minutes || 0),
  );
  const [lastCallMins, setLastCallMins] = useState<string>(
    String(campaign.last_call_surge_minutes || 0),
  );
  const [vipTopN, setVipTopN] = useState<string>(
    String(campaign.vip_top_n || 10),
  );
  const [vipThreshold, setVipThreshold] = useState<string>(
    campaign.vip_lifetime_threshold_ngn
      ? String(campaign.vip_lifetime_threshold_ngn)
      : "",
  );
  const [exitEnabled, setExitEnabled] = useState(campaign.exit_intent_enabled);
  const [exitCode, setExitCode] = useState<string>(
    campaign.exit_intent_code || "",
  );
  const [exitDiscount, setExitDiscount] = useState<string>(
    campaign.exit_intent_discount_ngn
      ? String(campaign.exit_intent_discount_ngn)
      : "",
  );
  const [multiCurrency, setMultiCurrency] = useState(
    campaign.allow_multi_currency_display,
  );
  const [abandonment, setAbandonment] = useState(
    campaign.abandonment_recovery_enabled,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const dirty =
    name !== campaign.name ||
    slug !== campaign.slug ||
    description !== (campaign.description || "") ||
    startsAt !== toLocalInput(campaign.starts_at) ||
    endsAt !== toLocalInput(campaign.ends_at) ||
    viewerPolicy !== (campaign.show_viewer_count_policy || "") ||
    viewerFloor !==
      (campaign.viewer_count_floor != null
        ? String(campaign.viewer_count_floor)
        : "") ||
    vipMins !== String(campaign.vip_early_access_minutes || 0) ||
    lastCallMins !== String(campaign.last_call_surge_minutes || 0) ||
    vipTopN !== String(campaign.vip_top_n || 10) ||
    vipThreshold !==
      (campaign.vip_lifetime_threshold_ngn
        ? String(campaign.vip_lifetime_threshold_ngn)
        : "") ||
    exitEnabled !== campaign.exit_intent_enabled ||
    exitCode !== (campaign.exit_intent_code || "") ||
    exitDiscount !==
      (campaign.exit_intent_discount_ngn
        ? String(campaign.exit_intent_discount_ngn)
        : "") ||
    multiCurrency !== campaign.allow_multi_currency_display ||
    abandonment !== campaign.abandonment_recovery_enabled;

  async function save(advance = false) {
    setSaving(true);
    setError(null);
    const cleanSlug = finalizeSlug(slug);
    try {
      await update.mutateAsync({
        name,
        ...(cleanSlug && cleanSlug !== campaign.slug
          ? { slug: cleanSlug }
          : {}),
        description: description || null,
        starts_at: new Date(startsAt).toISOString(),
        ends_at: new Date(endsAt).toISOString(),
        show_viewer_count_policy: (viewerPolicy ||
          null) as Campaign["show_viewer_count_policy"],
        viewer_count_floor: viewerFloor ? Number(viewerFloor) : null,
        vip_early_access_minutes: Number(vipMins) || 0,
        last_call_surge_minutes: Number(lastCallMins) || 0,
        vip_top_n: Number(vipTopN) || 10,
        vip_lifetime_threshold_ngn: vipThreshold ? Number(vipThreshold) : null,
        exit_intent_enabled: exitEnabled,
        exit_intent_code: exitEnabled ? exitCode || null : null,
        exit_intent_discount_ngn:
          exitEnabled && exitDiscount ? Number(exitDiscount) : null,
        allow_multi_currency_display: multiCurrency,
        abandonment_recovery_enabled: abandonment,
      });
      if (cleanSlug) setSlug(cleanSlug);
      setSavedAt(Date.now());
      if (advance) onNext?.();
    } catch (e: unknown) {
      setError(
        (e as Error)?.message ||
          "Couldn't save the brief. Check the highlighted fields and try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-5 space-y-5">
      <FormSection title="Campaign brief">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Campaign name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!canEdit}
              className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px] disabled:opacity-50"
            />
          </Field>
          <Field
            label="URL slug"
            hint={
              canEdit
                ? `Editable until launch · /sale/${finalizeSlug(slug) || "your-slug"}`
                : "Locked once the campaign is live — share links stay stable"
            }
          >
            <input
              value={slug}
              onChange={(e) => setSlug(cleanSlugInput(e.target.value))}
              disabled={!canEdit}
              spellCheck={false}
              className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px] disabled:opacity-50 font-mono"
            />
          </Field>
        </div>
        <Field label="Description" hint="Short internal description for staff">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!canEdit}
            rows={3}
            className="w-full px-[13px] py-2 rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px] disabled:opacity-50"
          />
        </Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Starts at">
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              disabled={!canEdit}
              className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px] disabled:opacity-50"
            />
          </Field>
          <Field label="Ends at">
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              disabled={!canEdit}
              className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px] disabled:opacity-50"
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title="States & extras">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field
            label="VIP early-access (minutes)"
            hint="0 = no head-start; e.g. 60 = 1h"
          >
            <NumberField
              value={vipMins}
              onChange={setVipMins}
              allowDecimal={false}
              suffix="min"
              disabled={!canEdit}
            />
          </Field>
          <Field
            label="Last-call surge (minutes)"
            hint="0 = off; e.g. 30 = final-30-min UX"
          >
            <NumberField
              value={lastCallMins}
              onChange={setLastCallMins}
              allowDecimal={false}
              suffix="min"
              disabled={!canEdit}
            />
          </Field>
          <Field
            label="Multi-currency display"
            hint="Geo-detect → display NGN/USD/GBP"
          >
            <Toggle
              checked={multiCurrency}
              onChange={setMultiCurrency}
              disabled={!canEdit}
              label={multiCurrency ? "On" : "Off"}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Smart-viewer ticker">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field
            label="Display policy"
            hint="Smart auto-hides when viewers < floor. CEO can override per campaign."
          >
            <Select<string>
              value={viewerPolicy}
              onChange={setViewerPolicy}
              options={[
                { value: "", label: "Inherit brand default" },
                { value: "smart", label: "Smart (auto-hide below floor)" },
                { value: "on", label: "Always show" },
                { value: "off", label: "Always hide" },
              ]}
              disabled={!canEdit}
            />
          </Field>
          <Field
            label="Viewer floor"
            hint="Below this concurrent viewer count, the number is hidden; only a Live pill remains."
          >
            <NumberField
              value={viewerFloor}
              onChange={setViewerFloor}
              allowDecimal={false}
              suffix="viewers"
              disabled={!canEdit}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title="VIP rewards">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field
            label="Top-N spenders to reward"
            hint="Auto-tag campaign_vip at campaign end"
          >
            <NumberField
              value={vipTopN}
              onChange={setVipTopN}
              allowDecimal={false}
              suffix="spenders"
              disabled={!canEdit}
            />
          </Field>
          <Field
            label="Lifetime spend → Platinum VIP"
            hint="Promote anyone whose lifetime spend crosses this ₦"
          >
            <NumberField
              value={vipThreshold}
              onChange={setVipThreshold}
              allowDecimal={false}
              suffix="NGN"
              disabled={!canEdit}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Don't-leave-without-buying">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field
            label="Exit-intent modal"
            hint="One-time code when cursor leaves or back gesture fires"
          >
            <Toggle
              checked={exitEnabled}
              onChange={setExitEnabled}
              disabled={!canEdit}
              label={exitEnabled ? "On" : "Off"}
            />
          </Field>
          <Field
            label="Cart abandonment email"
            hint="60-min nudge if cart sits with no checkout"
          >
            <Toggle
              checked={abandonment}
              onChange={setAbandonment}
              disabled={!canEdit}
              label={abandonment ? "On" : "Off"}
            />
          </Field>
          {exitEnabled && (
            <>
              <Field label="Exit-intent code">
                <input
                  value={exitCode}
                  onChange={(e) => setExitCode(e.target.value)}
                  disabled={!canEdit}
                  placeholder="STAY10"
                  className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 font-mono text-[13px] disabled:opacity-50"
                />
              </Field>
              <Field label="Exit-intent ₦ off">
                <NumberField
                  value={exitDiscount}
                  onChange={setExitDiscount}
                  allowDecimal={false}
                  suffix="NGN"
                  disabled={!canEdit}
                />
              </Field>
            </>
          )}
        </div>
      </FormSection>

      {error && (
        <div className="rounded-[12px] border border-danger/40 bg-danger/[0.08] px-4 py-3 text-[13px] text-danger">
          {error}
        </div>
      )}
      {canEdit && (
        <div className="flex items-center justify-end gap-3 sticky bottom-2">
          {dirty ? (
            <span className="text-[12px] text-text-faint">Unsaved changes</span>
          ) : savedAt ? (
            <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-success">
              <Check className="w-3.5 h-3.5" /> All changes saved
            </span>
          ) : null}
          {dirty && (
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => save(false)}
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          )}
          <Button
            variant="primary"
            disabled={saving}
            onClick={() => (dirty ? save(true) : onNext?.())}
            icon={<ChevronRight className="w-4 h-4" />}
          >
            {saving ? "Saving…" : dirty ? "Save & continue" : "Continue"}
          </Button>
        </div>
      )}
    </Card>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

// Gentle slug cleaning WHILE typing — keeps a trailing hyphen so a multi-word
// slug can be typed; finalizeSlug trims the stray ends on save.
function cleanSlugInput(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-");
}
function finalizeSlug(raw: string): string {
  return raw.replace(/^-+|-+$/g, "");
}

// ── Step 2: Bundles ──────────────────────────────────────
function BundlesStep({
  campaign,
  canEdit,
}: {
  campaign: Campaign;
  canEdit: boolean;
}) {
  const linksQ = useCampaignBundles(campaign.campaign_id);
  const bundlesQ = useBundleList();
  const attach = useAttachCampaignBundle(campaign.campaign_id);
  const detach = useDetachCampaignBundle(campaign.campaign_id);
  const [pickerOpen, setPickerOpen] = useState(false);
  const links = (linksQ.data?.data || []) as CampaignBundleLink[];
  const available = (bundlesQ.data?.data || []) as Bundle[];

  async function add(bundleId: string) {
    await attach.mutateAsync({ bundle_id: bundleId });
    setPickerOpen(false);
  }

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[22px] leading-tight">
            Bundles in this campaign
          </h2>
          <p className="text-text-muted text-[13px] mt-1">
            Bundles are curated catalogue entities. Fixed composition, per-item
            ₦ discount, displayed before/after totals on the landing.
          </p>
        </div>
        {canEdit && (
          <Button
            variant="primary"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setPickerOpen(true)}
          >
            Attach bundle
          </Button>
        )}
      </div>

      {linksQ.isLoading && <Skeleton style={{ height: 80 }} />}
      {linksQ.isError && <ErrorState onRetry={() => linksQ.refetch()} />}
      {!linksQ.isLoading && links.length === 0 && (
        <EmptyState
          icon={<PackagePlus className="w-7 h-7" />}
          title="No bundles attached yet"
          message="Attach bundles from your catalogue or create new ones."
          action={
            canEdit ? (
              <div className="flex gap-2 justify-center">
                <Button variant="primary" onClick={() => setPickerOpen(true)}>
                  Attach bundle
                </Button>
                <Link to="/sales-campaigns/bundles">
                  <Button
                    variant="secondary"
                    icon={<PackagePlus className="w-4 h-4" />}
                  >
                    Manage all bundles
                  </Button>
                </Link>
              </div>
            ) : undefined
          }
        />
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {links.map((l) => (
          <div
            key={l.link_id}
            className="glass rounded-[var(--radius)] p-4 flex gap-3 items-start"
          >
            <div
              className="w-16 h-16 rounded-[14px] flex-shrink-0 bg-text-primary/[0.06] grid place-items-center text-text-faint"
              style={
                l.bundle_hero_image_url
                  ? {
                      backgroundImage: `url(${l.bundle_hero_image_url})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }
                  : undefined
              }
            >
              {!l.bundle_hero_image_url && <ImageIcon className="w-6 h-6" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-display font-medium text-[15px] truncate">
                {l.bundle_name}
              </div>
              <div className="micro mt-0.5 truncate">/{l.bundle_slug}</div>
              <div className="flex flex-wrap gap-1.5 mt-2 text-[11px]">
                {l.is_featured && (
                  <Pill tone="accent" dot={false}>
                    Featured
                  </Pill>
                )}
                {l.preorder_enabled && (
                  <Pill tone="warn" dot={false}>
                    Preorder on
                  </Pill>
                )}
                {l.current_stock_snapshot != null && (
                  <Pill tone="neutral" dot={false}>
                    Stock: {l.current_stock_snapshot}
                  </Pill>
                )}
                {l.per_item_discount_ngn != null &&
                  Number(l.per_item_discount_ngn) > 0 && (
                    <Pill tone="success" dot={false}>
                      −{money(Number(l.per_item_discount_ngn))} / item
                    </Pill>
                  )}
              </div>
            </div>
            {canEdit && (
              <button
                onClick={() => detach.mutate(l.link_id)}
                aria-label="Remove bundle"
                className="text-text-faint hover:text-danger p-2"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Attach a bundle"
      >
        <div className="space-y-2 max-h-[55vh] overflow-y-auto">
          {available.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-text-muted mb-3">
                No bundles in the catalogue yet.
              </p>
              <Link to="/sales-campaigns/bundles">
                <Button variant="primary" icon={<Plus className="w-4 h-4" />}>
                  Create a bundle
                </Button>
              </Link>
            </div>
          ) : (
            available.map((b) => {
              const isAttached = links.some((l) => l.bundle_id === b.bundle_id);
              return (
                <button
                  key={b.bundle_id}
                  onClick={() => !isAttached && add(b.bundle_id)}
                  disabled={isAttached}
                  className={cn(
                    "w-full text-left flex items-center gap-3 p-3 rounded-[12px] border",
                    isAttached
                      ? "border-success/40 bg-success/[0.08] cursor-default"
                      : "border-line hover:border-accent/45 hover:bg-accent/[0.05]",
                  )}
                >
                  <div className="w-12 h-12 rounded-[10px] bg-text-primary/[0.05] grid place-items-center">
                    <ImageIcon className="w-5 h-5 text-text-faint" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-display font-medium text-[14px] truncate">
                      {b.name}
                    </div>
                    <div className="micro truncate">/{b.slug}</div>
                  </div>
                  {isAttached ? (
                    <Check className="w-4 h-4 text-success" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-text-faint" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </Modal>
    </Card>
  );
}

// ── Step 3: Pricing ──────────────────────────────────────
function PricingStep({
  campaign,
  canEdit,
}: {
  campaign: Campaign;
  canEdit: boolean;
}) {
  const tiersQ = useCampaignTiers(campaign.campaign_id);
  const upsellsQ = useCampaignUpsells(campaign.campaign_id);
  const upsertTier = useUpsertTier(campaign.campaign_id);
  const deleteTier = useDeleteTier(campaign.campaign_id);
  const upsertUpsell = useUpsertUpsell(campaign.campaign_id);
  const deleteUpsell = useDeleteUpsell(campaign.campaign_id);

  const tiers = (tiersQ.data?.data || []) as QuantityTier[];
  const upsells = (upsellsQ.data?.data || []) as CartUpsell[];

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-4">
        <div>
          <h2 className="font-display text-[22px] leading-tight">
            Quantity-tier ladder
          </h2>
          <p className="text-text-muted text-[13px] mt-1">
            <span className="font-mono">Fixed ₦</span> amounts at the cart, not
            percentages. The engine always respects the per-product price floor.
          </p>
        </div>
        <TierEditor
          tiers={tiers}
          canEdit={canEdit}
          onSubmit={(input) => upsertTier.mutate(input)}
          onDelete={(id) => deleteTier.mutate(id)}
        />
      </Card>

      <Card className="p-5 space-y-4">
        <div>
          <h2 className="font-display text-[22px] leading-tight">
            Cart upsell ladder
          </h2>
          <p className="text-text-muted text-[13px] mt-1">
            One polite, dismissible nudge per rung — the offer escalates as the
            cart grows.
          </p>
        </div>
        <UpsellEditor
          upsells={upsells}
          canEdit={canEdit}
          onSubmit={(input) => upsertUpsell.mutate(input)}
          onDelete={(id) => deleteUpsell.mutate(id)}
        />
      </Card>
    </div>
  );
}

function TierEditor({
  tiers,
  canEdit,
  onSubmit,
  onDelete,
}: {
  tiers: QuantityTier[];
  canEdit: boolean;
  onSubmit: (
    input: Partial<QuantityTier> & {
      min_quantity: number;
      fixed_discount_ngn: number;
    },
  ) => void;
  onDelete: (id: string) => void;
}) {
  const [qty, setQty] = useState("2");
  const [discount, setDiscount] = useState("");
  const [label, setLabel] = useState("");

  function submit() {
    if (!qty || !discount) return;
    onSubmit({
      min_quantity: Number(qty),
      fixed_discount_ngn: Number(discount),
      label: label || `Buy ${qty} save ${money(Number(discount))}`,
    });
    setDiscount("");
    setLabel("");
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        {tiers.length === 0 ? (
          <div className="text-[13px] text-text-faint italic py-3">
            No tiers yet. Add one below.
          </div>
        ) : (
          tiers.map((t) => (
            <div
              key={t.tier_id}
              className="flex items-center gap-3 p-3 rounded-[12px] bg-text-primary/[0.04] border border-line"
            >
              <span className="font-display font-medium text-[16px] w-12 text-center tabular-nums">
                {t.min_quantity}+
              </span>
              <span className="text-text-muted text-[13px]">→</span>
              <MoneyText ngn={Number(t.fixed_discount_ngn)} />
              <span className="text-text-muted text-[12px] truncate flex-1">
                {t.label}
              </span>
              {canEdit && (
                <button
                  onClick={() => onDelete(t.tier_id)}
                  className="text-text-faint hover:text-danger p-1"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))
        )}
      </div>
      {canEdit && (
        <div className="rounded-[14px] border border-line bg-text-primary/[0.02] p-4 space-y-3">
          <div className="micro">Add a tier</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Minimum quantity">
              <NumberField
                value={qty}
                onChange={setQty}
                allowDecimal={false}
                suffix="items"
              />
            </Field>
            <Field label="Discount" hint="Fixed ₦ off the cart subtotal">
              <NumberField
                value={discount}
                onChange={setDiscount}
                suffix="NGN"
                allowDecimal={false}
              />
            </Field>
            <Field label="Label (optional)">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={`Buy ${qty || "N"} save ${money(Number(discount) || 0)}`}
                className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px]"
              />
            </Field>
          </div>
          <div className="flex justify-end">
            <Button
              variant="primary"
              onClick={submit}
              icon={<Plus className="w-4 h-4" />}
              disabled={!qty || !discount}
            >
              Add tier
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function UpsellEditor({
  upsells,
  canEdit,
  onSubmit,
  onDelete,
}: {
  upsells: CartUpsell[];
  canEdit: boolean;
  onSubmit: (input: Partial<CartUpsell>) => void;
  onDelete: (id: string) => void;
}) {
  const [rung, setRung] = useState("1");
  const [triggerType, setTriggerType] =
    useState<CartUpsell["trigger_type"]>("cart_qty");
  const [minQty, setMinQty] = useState("1");
  const [minValue, setMinValue] = useState("");
  const [label, setLabel] = useState("");
  const [subline, setSubline] = useState("");
  const [rewardValue, setRewardValue] = useState("");

  function submit() {
    onSubmit({
      rung: Number(rung) || 1,
      trigger_type: triggerType,
      min_cart_qty: triggerType === "cart_qty" ? Number(minQty) || 1 : null,
      min_cart_value_ngn:
        triggerType === "cart_value" ? Number(minValue) || 0 : null,
      offer_label: label || `Add 1 more`,
      offer_subline: subline || undefined,
      reward_type: "fixed_amount",
      reward_value: Number(rewardValue) || 0,
    });
    setLabel("");
    setSubline("");
    setRewardValue("");
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        {upsells.length === 0 ? (
          <div className="text-[13px] text-text-faint italic py-3">
            No upsell rungs yet — add the first below.
          </div>
        ) : (
          upsells.map((u) => (
            <div
              key={u.upsell_id}
              className="flex items-center gap-3 p-3 rounded-[12px] bg-text-primary/[0.04] border border-line"
            >
              <span className="font-display font-medium text-[14px] w-8 text-center tabular-nums shrink-0">
                #{u.rung}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-medium text-[13px] truncate">
                  {u.offer_label}
                </div>
                {u.offer_subline && (
                  <div className="text-text-muted text-[11px] truncate">
                    {u.offer_subline}
                  </div>
                )}
              </div>
              <span className="text-[12px] text-text-faint tabular-nums whitespace-nowrap hidden sm:block">
                {u.trigger_type === "cart_qty"
                  ? `≥ ${u.min_cart_qty} items`
                  : u.trigger_type === "cart_value"
                    ? `≥ ${money(Number(u.min_cart_value_ngn))}`
                    : "bundle"}
              </span>
              {u.reward_value != null && Number(u.reward_value) > 0 && (
                <span className="text-[12px] text-accent-glow tabular-nums whitespace-nowrap">
                  −{money(Number(u.reward_value))}
                </span>
              )}
              {canEdit && (
                <button
                  onClick={() => onDelete(u.upsell_id)}
                  className="text-text-faint hover:text-danger p-1 shrink-0"
                  aria-label="Remove rung"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))
        )}
      </div>
      {canEdit && (
        <div className="rounded-[14px] border border-line bg-text-primary/[0.02] p-4 space-y-3">
          <div className="micro">Add a rung</div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Field label="Rung">
              <NumberField
                value={rung}
                onChange={setRung}
                allowDecimal={false}
              />
            </Field>
            <Field label="Trigger">
              <Select<CartUpsell["trigger_type"]>
                value={triggerType}
                onChange={setTriggerType}
                options={[
                  { value: "cart_qty", label: "Items in cart" },
                  { value: "cart_value", label: "Cart value" },
                  { value: "specific_bundle", label: "Specific bundle" },
                ]}
              />
            </Field>
            <Field
              label={
                triggerType === "cart_value" ? "Min value (₦)" : "Min items"
              }
            >
              {triggerType === "cart_value" ? (
                <NumberField
                  value={minValue}
                  onChange={setMinValue}
                  allowDecimal={false}
                />
              ) : (
                <NumberField
                  value={minQty}
                  onChange={setMinQty}
                  allowDecimal={false}
                />
              )}
            </Field>
            <Field label="Reward ₦ off">
              <NumberField
                value={rewardValue}
                onChange={setRewardValue}
                allowDecimal={false}
              />
            </Field>
          </div>
          <Field label="Offer headline">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Add 1 more bundle"
              className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px]"
            />
          </Field>
          <Field
            label="Subline (optional)"
            hint="The smaller line under the headline"
          >
            <input
              value={subline}
              onChange={(e) => setSubline(e.target.value)}
              placeholder="and save an extra ₦100,000"
              className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px]"
            />
          </Field>
          <div className="flex justify-end">
            <Button
              variant="primary"
              onClick={submit}
              icon={<Plus className="w-4 h-4" />}
              disabled={!label && !rewardValue}
            >
              Add rung
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step 4: Landing page ─────────────────────────────────
// The heavy editing now lives in the full-screen Studio (edit + live preview
// side by side, image upload). This step is a launcher + at-a-glance summary.
function LandingStep({
  campaign,
  canEdit,
  onNext,
}: {
  campaign: Campaign;
  canEdit: boolean;
  onNext?: () => void;
}) {
  const brand = useBrand();
  const [studioOpen, setStudioOpen] = useState(false);
  const blocks = campaign.landing_blocks || [];
  const enabledCount = blocks.filter((b) => b.enabled !== false).length;

  return (
    <Card className="p-0 overflow-hidden">
      <div
        className="h-44 md:h-56 relative"
        style={{
          backgroundImage: campaign.landing_hero_image_url
            ? `linear-gradient(180deg, rgb(0 0 0/0.12), rgb(var(--panel)/0.88)), url("${campaign.landing_hero_image_url}")`
            : "linear-gradient(135deg, rgb(var(--accent-deep)/0.6), rgb(var(--panel)/0.92))",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="absolute inset-0 p-5 md:p-7 flex flex-col justify-end">
          <div className="font-display text-[24px] md:text-[30px] leading-tight max-w-[560px] drop-shadow">
            {campaign.landing_hero_title || campaign.name}
          </div>
          {campaign.landing_hero_subtitle && (
            <div className="text-text-primary/80 text-[13px] mt-1.5 max-w-[460px] truncate">
              {campaign.landing_hero_subtitle}
            </div>
          )}
        </div>
      </div>

      <div className="p-5 md:p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-display text-[22px] leading-tight">
              Design the landing page
            </h2>
            <p className="text-text-muted text-[13px] mt-1 max-w-[520px]">
              Open the full-screen Studio to edit and preview side by side —
              hero, look book, bundles, testimonials and more. Upload images
              right there; no detours.
            </p>
          </div>
          <Button
            variant="primary"
            icon={<Pencil className="w-4 h-4" />}
            onClick={() => setStudioOpen(true)}
          >
            {canEdit ? "Open the Studio" : "Open preview"}
          </Button>
        </div>

        <div className="flex flex-wrap gap-2">
          <Pill tone="neutral" dot={false}>
            {enabledCount} sections
          </Pill>
          <Pill
            tone={campaign.landing_hero_image_url ? "success" : "warn"}
            dot={false}
          >
            {campaign.landing_hero_image_url
              ? "Hero image set"
              : "No hero image yet"}
          </Pill>
          <Pill tone="neutral" dot={false}>
            /sale/{campaign.slug}
          </Pill>
        </div>

        <div className="flex items-center justify-between gap-3 pt-3 border-t border-line/60">
          <a
            href={`/sale/${campaign.slug}?brand=${brand}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-accent-glow hover:underline"
          >
            <Eye className="w-3.5 h-3.5" /> Open the public page ↗
          </a>
          {onNext && (
            <Button
              variant="ghost"
              icon={<ChevronRight className="w-4 h-4" />}
              onClick={onNext}
            >
              Continue
            </Button>
          )}
        </div>
      </div>

      <LandingStudio
        open={studioOpen}
        onClose={() => setStudioOpen(false)}
        campaign={campaign}
        canEdit={canEdit}
      />
    </Card>
  );
}

// ── Step 5: Ambassadors / Share kit ──────────────────────
function AmbassadorsStep({
  campaign,
  canEdit,
}: {
  campaign: Campaign;
  canEdit: boolean;
}) {
  const ambassadorsQ = useCampaignAmbassadors(campaign.campaign_id);
  const ambassadors = ambassadorsQ.data?.data || [];
  // We'll keep this view list-only for v1; the picker drawer can come next iteration.

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-[22px]">Ambassadors</h2>
            <p className="text-text-muted text-[13px] mt-1">
              Pick contacts you've promoted to ambassadors. Each gets a
              trackable link with their utm_source — revenue + commission roll
              up here.
            </p>
          </div>
          {canEdit && (
            <Link
              to="/sales-campaigns/ambassadors"
              className="text-[12.5px] font-semibold text-accent-glow hover:underline"
            >
              Manage ambassadors →
            </Link>
          )}
        </div>
        {ambassadorsQ.isLoading && <Skeleton style={{ height: 60 }} />}
        {!ambassadorsQ.isLoading && ambassadors.length === 0 && (
          <EmptyState
            icon={<Users className="w-7 h-7" />}
            title="No ambassadors attached"
            message="Promote contacts to ambassadors in Contacts, then attach them here."
          />
        )}
        <div className="space-y-1.5">
          {ambassadors.map((a) => (
            <div
              key={a.ambassador_link_id}
              className="grid grid-cols-12 items-center gap-3 p-3 rounded-[12px] bg-text-primary/[0.04] border border-line"
            >
              <div className="col-span-3 min-w-0">
                <div className="font-medium text-[13px] truncate">
                  {a.first_name || ""} {a.last_name || ""}
                </div>
                <div className="text-text-faint text-[11px] truncate">
                  {a.instagram_handle || a.email}
                </div>
              </div>
              <div className="col-span-2 font-mono text-[12px] text-accent-glow">
                {a.utm_source}
              </div>
              <div className="col-span-2 text-[12px] tabular-nums">
                {a.visits_count} visits
              </div>
              <div className="col-span-2 text-[12px] tabular-nums">
                {a.orders_count} orders
              </div>
              <div className="col-span-3 text-[12.5px] tabular-nums text-right">
                <MoneyText ngn={Number(a.revenue_ngn || 0)} />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── Step 6: Approval & Launch ────────────────────────────
function ApprovalStep({ campaign }: { campaign: Campaign }) {
  const transition = useCampaignTransition(campaign.campaign_id);
  const { can } = useAuthStore();
  const canApprove = can("sales_campaigns", "approve");
  const canEdit = can("sales_campaigns", "edit");

  return (
    <Card className="p-5 space-y-4">
      <h2 className="font-display text-[22px]">Approval & launch</h2>
      <div className="text-[13px] text-text-muted">
        Submit the campaign for approval. Anyone with{" "}
        <span className="font-mono">sales_campaigns.approve</span> can launch it
        once approved.
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <KpiTile
          label="Current state"
          value={STATUS_LABEL[campaign.status]}
          tone={TONE_FOR[campaign.status]}
        />
        <KpiTile
          label="Approved by"
          value={campaign.approved_by ? "✓ Approved" : "—"}
          tone={campaign.approved_at ? "success" : "neutral"}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {campaign.status === "draft" && canEdit && (
          <Button variant="primary" onClick={() => transition.mutate("submit")}>
            Submit for approval
          </Button>
        )}
        {campaign.status === "pending_approval" && canApprove && (
          <>
            <Button
              variant="primary"
              onClick={() => transition.mutate("approve")}
            >
              Approve
            </Button>
            <Button
              variant="danger"
              onClick={() => transition.mutate("reject")}
            >
              Reject
            </Button>
          </>
        )}
        {campaign.status === "scheduled" && canEdit && (
          <Button
            variant="primary"
            onClick={() => transition.mutate("launch")}
            className="cta-breathe"
          >
            Launch now
          </Button>
        )}
        {campaign.status === "live" && canEdit && (
          <>
            <Button
              variant="secondary"
              onClick={() => transition.mutate("pause")}
            >
              Pause
            </Button>
            <Button variant="danger" onClick={() => transition.mutate("end")}>
              End early
            </Button>
          </>
        )}
        {campaign.status === "paused" && canEdit && (
          <>
            <Button
              variant="primary"
              onClick={() => transition.mutate("resume")}
            >
              Resume
            </Button>
            <Button variant="danger" onClick={() => transition.mutate("end")}>
              End
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

// ── Praxis assist drawer ─────────────────────────────────
function PraxisAssistDrawer({
  open,
  onClose,
  campaign,
}: {
  open: boolean;
  onClose: () => void;
  campaign: Campaign;
}) {
  const [tab, setTab] = useState<"copy" | "layout" | "pricing">("copy");
  const [section, setSection] = useState("hero");
  const [brief, setBrief] = useState("");
  const draft = usePraxisDraftCopy(campaign.campaign_id);
  const suggest = usePraxisSuggestLayout(campaign.campaign_id);
  const accept = usePraxisAccept(campaign.campaign_id);
  const update = useUpdateCampaign(campaign.campaign_id);
  const [layoutResult, setLayoutResult] = useState<Array<{
    key: string;
    rationale: string;
  }> | null>(null);
  const [copyResult, setCopyResult] = useState<Record<string, unknown> | null>(
    null,
  );

  async function runDraft() {
    const r = await draft.mutateAsync({
      section,
      brief,
      campaign_theme: campaign.name,
    });
    setCopyResult(r.draft as Record<string, unknown> | null);
  }
  async function runLayout() {
    const r = await suggest.mutateAsync({ campaign_type: "flash_sale" });
    setLayoutResult(r.layout);
  }
  async function applyCopy() {
    if (!copyResult) return;
    if (section === "hero") {
      await update.mutateAsync({
        landing_hero_title: (copyResult.hero_title as string) || null,
        landing_hero_subtitle: (copyResult.hero_subtitle as string) || null,
        landing_cta_text: (copyResult.cta_text as string) || null,
      });
    }
    await accept.mutateAsync({
      action_key: `draft_copy.${section}`,
      prompt: brief,
      draft: copyResult,
      accepted: copyResult,
    });
    setCopyResult(null);
    onClose();
  }
  async function applyLayout() {
    if (!layoutResult) return;
    const blocks = layoutResult.map((b) => ({
      key: b.key,
      enabled: true,
      drafted_by_ai: true,
      rationale: b.rationale,
    }));
    await update.mutateAsync({ landing_blocks: blocks });
    await accept.mutateAsync({
      action_key: "suggest_layout",
      prompt: "Layout suggestion",
      draft: layoutResult,
      accepted: blocks,
    });
    setLayoutResult(null);
    onClose();
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      wide
      title={
        <span className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-accent-glow" /> Praxis
        </span>
      }
      subtitle={`Voice: ${campaign.voice_profile_override?.tone || "editorial-luxury"} · ${campaign.name}`}
    >
      <div className="space-y-4">
        <div className="dropglass rounded-[12px] p-3 text-[12px] text-text-muted border border-line">
          Praxis is drafting — review every block before publish. Every accepted
          suggestion is logged with the prompt + the diff.
        </div>

        <div className="flex gap-1">
          {(["copy", "layout", "pricing"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={cn(
                "px-3 py-1.5 rounded-[9px] text-[12px] font-semibold",
                tab === k
                  ? "bg-accent-deep text-[#F4E9D9]"
                  : "text-text-muted hover:bg-text-primary/[0.05]",
              )}
            >
              {k === "copy"
                ? "Draft copy"
                : k === "layout"
                  ? "Layout"
                  : "Pricing"}
            </button>
          ))}
        </div>

        {tab === "copy" && (
          <div className="space-y-3">
            <Field label="Section">
              <Select<string>
                value={section}
                onChange={setSection}
                options={[
                  { value: "hero", label: "Hero (title + subtitle + CTA)" },
                  { value: "faq", label: "FAQ entries" },
                  { value: "blast", label: "Go-live blast (email + WhatsApp)" },
                  { value: "product_blurbs", label: "Product blurbs" },
                ]}
              />
            </Field>
            <Field
              label="Brief"
              hint="One sentence is enough. Praxis loads your brand voice automatically."
            >
              <textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                rows={3}
                placeholder="Black Friday — Pixie collection, premium tone, no exclamation marks"
                className="w-full px-[13px] py-2 rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px]"
              />
            </Field>
            <Button
              variant="primary"
              onClick={runDraft}
              disabled={draft.isPending}
              icon={<Wand2 className="w-4 h-4" />}
            >
              {draft.isPending ? "Drafting…" : "Draft copy"}
            </Button>
            {copyResult && (
              <div className="dropglass rounded-[12px] p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-accent-glow" />
                  <span className="micro text-accent-glow">
                    Drafted by Praxis · pending acceptance
                  </span>
                </div>
                <pre className="text-[12px] whitespace-pre-wrap text-text-primary leading-relaxed">
                  {JSON.stringify(copyResult, null, 2)}
                </pre>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" onClick={() => setCopyResult(null)}>
                    Discard
                  </Button>
                  <Button
                    variant="primary"
                    onClick={applyCopy}
                    icon={<Check className="w-4 h-4" />}
                  >
                    Accept & apply
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "layout" && (
          <div className="space-y-3">
            <p className="text-[13px] text-text-muted">
              Suggest a block layout for this campaign.
            </p>
            <Button
              variant="primary"
              onClick={runLayout}
              disabled={suggest.isPending}
              icon={<Layers className="w-4 h-4" />}
            >
              {suggest.isPending ? "Thinking…" : "Suggest layout"}
            </Button>
            {layoutResult && (
              <div className="dropglass rounded-[12px] p-4 space-y-3">
                <div className="micro text-accent-glow flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5" /> Drafted by Praxis ·
                  pending acceptance
                </div>
                <ol className="space-y-1.5">
                  {layoutResult.map((b, i) => (
                    <li key={b.key} className="text-[12.5px] leading-relaxed">
                      <span className="font-mono text-text-faint mr-2">
                        #{i + 1}
                      </span>
                      <span className="font-semibold">
                        {BLOCK_LIBRARY.find((x) => x.key === b.key)?.label ||
                          b.key}
                      </span>
                      <span className="text-text-muted"> — {b.rationale}</span>
                    </li>
                  ))}
                </ol>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" onClick={() => setLayoutResult(null)}>
                    Discard
                  </Button>
                  <Button
                    variant="primary"
                    onClick={applyLayout}
                    icon={<Check className="w-4 h-4" />}
                  >
                    Accept & apply
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "pricing" && (
          <div className="space-y-3 text-[13px] text-text-muted">
            <p>
              Open the Pricing step in the builder and tap{" "}
              <span className="font-semibold text-accent-glow">
                "Suggest with Praxis"
              </span>{" "}
              next to a bundle to get a goal-seek + charm-rounded number with
              the floor enforced.
            </p>
            <p className="text-text-faint">
              For dry-run questions ("Will ₦149,000 break the floor?"), use the
              Live Praxis chat on the campaign detail page.
            </p>
          </div>
        )}
      </div>
    </Drawer>
  );
}
