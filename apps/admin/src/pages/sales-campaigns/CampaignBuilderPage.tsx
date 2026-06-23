import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Clock,
  Download,
  Eye,
  Image as ImageIcon,
  Layers,
  PackagePlus,
  Pencil,
  Plus,
  Send,
  Settings,
  ShoppingBag,
  Sparkles,
  Tag,
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
  type CampaignProduct,
  type CatalogueBundleSource,
  type PositionLadderItem,
  type StackingBonus,
  type BulkTier,
  type QuantityTier,
  type CartUpsell,
  type BundleItem,
  type CampaignStatus,
  useAddProductsBatch,
  useBrand,
  useBundle,
  useCampaign,
  useCampaignAmbassadors,
  useCampaignBundles,
  useCampaignProducts,
  useCampaignTransition,
  useCampaignTiers,
  useCampaignUpsells,
  useCatalogueBundleSources,
  useDeleteTier,
  useDeleteUpsell,
  useDetachCampaignBundle,
  useImportCatalogueBundle,
  usePraxisDraftCopy,
  usePraxisSuggestLayout,
  usePraxisAccept,
  useRemoveCampaignProduct,
  useUpdateCampaign,
  useUpsertTier,
  useUpsertUpsell,
  publicSaleUrl,
} from "@/lib/campaigns";
import { useBusinessConfig } from "@/lib/settings";
import { type StyledProduct } from "@/lib/catalogue";
import { StyledProductPicker } from "@/components/campaign/StyledProductPicker";
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
  { key: "products", label: "Products", icon: ShoppingBag },
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
  {
    key: "reseller_bulk",
    label: "Reseller / Bulk",
    description: "Bulk-buy tier rates",
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
              onNext={() => setStep("products")}
            />
          )}
          {step === "products" && (
            <ProductsStep campaign={campaign} canEdit={canEdit} />
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
  const cfg = useBusinessConfig();
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
                publicSaleUrl(campaign.slug, {
                  salesSubdomain: cfg.data?.sales_subdomain,
                  storefrontDomain: cfg.data?.storefront_domain,
                  brand,
                }),
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
            "Set the campaign name, slug, dates and delivery timeline. Praxis uses your voice profile to write copy in the next steps."}
          {step === "products" &&
            "Pick styled products to feature individually on the landing page. Each product shows with its campaign price + delivery timeline."}
          {step === "bundles" &&
            "Create bundles inside this campaign, clone from your catalogue, or duplicate & swap. Each bundle is a curated set of styled products."}
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
  // Top-level discount is fully optional and editable any time after create.
  // "" means "no discount on this campaign" — the API stores NULL and bundle
  // pricing / per-position ladders carry the offer instead.
  const [discountType, setDiscountType] = useState<string>(
    campaign.discount_type || "",
  );
  const [discountValue, setDiscountValue] = useState<string>(
    campaign.discount_value != null ? String(campaign.discount_value) : "",
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
  const [deliveryWeeks, setDeliveryWeeks] = useState<string>(
    campaign.delivery_weeks != null ? String(campaign.delivery_weeks) : "",
  );
  const [preorderExtraWeeks, setPreorderExtraWeeks] = useState<string>(
    String(campaign.preorder_extra_weeks ?? 4),
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
    discountType !== (campaign.discount_type || "") ||
    discountValue !==
      (campaign.discount_value != null
        ? String(campaign.discount_value)
        : "") ||
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
    abandonment !== campaign.abandonment_recovery_enabled ||
    deliveryWeeks !==
      (campaign.delivery_weeks != null
        ? String(campaign.delivery_weeks)
        : "") ||
    preorderExtraWeeks !== String(campaign.preorder_extra_weeks ?? 4);

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
        discount_type: discountType
          ? (discountType as Campaign["discount_type"])
          : null,
        discount_value: discountValue ? Number(discountValue) : null,
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
        delivery_weeks: deliveryWeeks ? Number(deliveryWeeks) : null,
        preorder_extra_weeks: Number(preorderExtraWeeks) || 4,
      } as Partial<Campaign>);
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

      <FormSection title="Top-level discount">
        <p className="text-[12px] text-text-faint -mt-2 mb-2">
          Fully optional. Leave blank when bundles or per-position ladders
          carry the offer.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Discount type" hint="Optional — leave blank for none">
            <Select<string>
              value={discountType}
              onChange={(v) => {
                setDiscountType(v);
                if (!v) setDiscountValue("");
              }}
              disabled={!canEdit}
              options={[
                { value: "", label: "None" },
                { value: "percentage", label: "Percentage off" },
                { value: "fixed_amount", label: "Fixed ₦ off" },
                { value: "bundle", label: "Bundle" },
                { value: "buy_x_get_y", label: "Buy X get Y" },
                { value: "free_shipping", label: "Free shipping" },
              ]}
            />
          </Field>
          <Field
            label={
              discountType === "percentage"
                ? "Discount (0–1)"
                : discountType === "fixed_amount"
                  ? "Discount ₦"
                  : "Discount value"
            }
            hint={
              !discountType
                ? "Set a discount type first"
                : discountType === "percentage"
                  ? "e.g. 0.20 = 20%"
                  : discountType === "fixed_amount"
                    ? "in NGN"
                    : "Optional"
            }
          >
            <input
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              disabled={!canEdit || !discountType}
              placeholder={discountType ? "" : "—"}
              className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px] font-mono tabular-nums disabled:opacity-40"
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

      <FormSection title="Delivery timeline">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field
            label="Default delivery (weeks)"
            hint="Applies to all styled products in this campaign. e.g. 2-3 weeks"
          >
            <NumberField
              value={deliveryWeeks}
              onChange={setDeliveryWeeks}
              allowDecimal={false}
              suffix="weeks"
              disabled={!canEdit}
            />
          </Field>
          <Field
            label="Preorder extra weeks"
            hint="Added on top of delivery time for preorder items"
          >
            <NumberField
              value={preorderExtraWeeks}
              onChange={setPreorderExtraWeeks}
              allowDecimal={false}
              suffix="weeks"
              disabled={!canEdit}
            />
          </Field>
        </div>
        {deliveryWeeks && (
          <div className="flex items-center gap-2 text-[12px] text-text-muted mt-1">
            <Clock className="w-3.5 h-3.5" />
            <span>
              In-stock: {deliveryWeeks} weeks · Preorder:{" "}
              {Number(deliveryWeeks) + Number(preorderExtraWeeks || 4)} weeks
            </span>
          </div>
        )}
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

// ── Step 2: Products ────────────────────────────────────
function ProductsStep({
  campaign,
  canEdit,
}: {
  campaign: Campaign;
  canEdit: boolean;
}) {
  const productsQ = useCampaignProducts(campaign.campaign_id);
  const addBatch = useAddProductsBatch(campaign.campaign_id);
  const removeProduct = useRemoveCampaignProduct(campaign.campaign_id);
  const [pickerOpen, setPickerOpen] = useState(false);

  const products = (productsQ.data?.data || []) as CampaignProduct[];
  const excludeIds = new Set(
    products.filter((p) => p.styled_id).map((p) => p.styled_id!),
  );

  async function handleAdd(items: StyledProduct[]) {
    // Snapshot the styled product onto the campaign link: image, both-currency
    // reference prices, and the long + short copy (so the landing page can show
    // them and they stay stable if the styled product is later re-priced).
    await addBatch.mutateAsync(
      items.map((sp) => ({
        styled_id: sp.styled_id,
        product_id: sp.base_product_id || null,
        image_url: sp.primary_image_url || null,
        regular_price_ngn: sp.effective_price_ngn ?? sp.retail_price_ngn ?? null,
        regular_price_usd: sp.retail_price_usd ?? null,
        short_description: sp.short_description ?? null,
        long_description: sp.long_description ?? null,
        include_exclude: "include",
        is_featured: false,
      })),
    );
  }

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[22px] leading-tight">
            Featured products
          </h2>
          <p className="text-text-muted text-[13px] mt-1">
            Pick styled products to feature individually on the landing page.
            These are sold outside of bundles — buyers can pick one wig at a
            time.
          </p>
        </div>
        {canEdit && (
          <Button
            variant="primary"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setPickerOpen(true)}
          >
            Add products
          </Button>
        )}
      </div>

      {productsQ.isLoading && <Skeleton style={{ height: 80 }} />}
      {productsQ.isError && (
        <ErrorState onRetry={() => productsQ.refetch()} />
      )}
      {!productsQ.isLoading && products.length === 0 && (
        <EmptyState
          icon={<ShoppingBag className="w-7 h-7" />}
          title="No products added yet"
          message="Add styled products from your catalogue. They'll appear on the campaign landing page."
          action={
            canEdit ? (
              <Button
                variant="primary"
                onClick={() => setPickerOpen(true)}
                icon={<Plus className="w-4 h-4" />}
              >
                Add products
              </Button>
            ) : undefined
          }
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {products.map((p) => (
          <div
            key={p.link_id}
            className="glass rounded-[var(--radius)] p-3 flex gap-3 items-start"
          >
            <div
              className="w-12 h-12 rounded-[10px] flex-shrink-0 bg-text-primary/[0.06] grid place-items-center overflow-hidden"
              style={
                p.resolved_image_url || p.image_url
                  ? {
                      backgroundImage: `url(${p.resolved_image_url || p.image_url})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }
                  : undefined
              }
            >
              {!p.resolved_image_url && !p.image_url && (
                <ImageIcon className="w-5 h-5 text-text-faint" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium text-[13px] truncate">
                {p.styled_name || p.product_name || "Unknown product"}
              </div>
              {(() => {
                const ngn = p.regular_price_ngn ?? p.styled_retail_price_ngn;
                const usd = p.regular_price_usd ?? p.styled_retail_price_usd;
                const shortDesc =
                  p.short_description || p.styled_short_description;
                return (
                  <>
                    <div className="flex items-center gap-2 mt-1">
                      {ngn != null && (
                        <MoneyText
                          ngn={Number(ngn)}
                          usd={usd != null ? Number(usd) : undefined}
                          className="text-[12px] text-text-muted"
                        />
                      )}
                      {p.is_featured && (
                        <Pill tone="accent" dot={false}>
                          Featured
                        </Pill>
                      )}
                    </div>
                    {shortDesc && (
                      <p className="text-[11px] text-text-faint mt-1 line-clamp-2">
                        {shortDesc}
                      </p>
                    )}
                  </>
                );
              })()}
            </div>
            {canEdit && (
              <button
                onClick={() => removeProduct.mutate(p.link_id)}
                aria-label="Remove product"
                className="text-text-faint hover:text-danger p-1"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>

      {products.length > 0 && (
        <div className="text-[12px] text-text-faint">
          {products.length} product{products.length !== 1 ? "s" : ""} added
        </div>
      )}

      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Add styled products"
        size="lg"
      >
        <StyledProductPicker
          excludeIds={excludeIds}
          onAdd={handleAdd}
          onClose={() => setPickerOpen(false)}
        />
      </Modal>
    </Card>
  );
}

// ── Step 3: Bundles ──────────────────────────────────────
function BundlesStep({
  campaign,
  canEdit,
}: {
  campaign: Campaign;
  canEdit: boolean;
}) {
  // Bundles in the builder are IMPORT-ONLY. Creation lives in
  // Catalogue → Bundles; this step picks from those rows and mirrors them
  // into the campaign with all inherited pricing + components + images.
  const linksQ = useCampaignBundles(campaign.campaign_id);
  const sourcesQ = useCatalogueBundleSources();
  const detach = useDetachCampaignBundle(campaign.campaign_id);
  const importBundle = useImportCatalogueBundle(
    campaign.campaign_id,
    campaign.slug,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bundleDetailId, setBundleDetailId] = useState<string | null>(null);
  // Surface failures from import / detach instead of letting a rejected
  // mutation vanish — these used to look like dead buttons on error.
  const [error, setError] = useState<string | null>(null);

  const links = (linksQ.data?.data || []) as CampaignBundleLink[];
  const sources = (sourcesQ.data?.data || []) as CatalogueBundleSource[];

  function describeError(e: unknown, fallback: string) {
    setError((e as Error)?.message || fallback);
  }

  async function handleImport(offerId: string) {
    setError(null);
    try {
      await importBundle.mutateAsync(offerId);
    } catch (e) {
      describeError(
        e,
        "Couldn't import that bundle. Please try again.",
      );
    }
  }

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-[22px] leading-tight">
            Campaign bundles
          </h2>
          <p className="text-text-muted text-[13px] mt-1">
            Import bundles from your catalogue. Pricing, components and
            images come straight from Catalogue → Bundles — edit the source
            there and re-import to refresh.
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button
              variant="primary"
              icon={<Download className="w-4 h-4" />}
              onClick={() => setPickerOpen(true)}
            >
              Import from catalogue
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-[11px] border border-danger/40 bg-danger/[0.08] px-3 py-2 text-[12.5px] text-danger"
        >
          {error}
        </div>
      )}

      {linksQ.isLoading && <Skeleton style={{ height: 80 }} />}
      {linksQ.isError && <ErrorState onRetry={() => linksQ.refetch()} />}
      {!linksQ.isLoading && links.length === 0 && (
        <EmptyState
          icon={<PackagePlus className="w-7 h-7" />}
          title="No bundles in this campaign"
          message="Import bundles from your catalogue. Build new ones under Catalogue → Bundles, then bring them in here."
          action={
            canEdit ? (
              <Button
                variant="primary"
                onClick={() => setPickerOpen(true)}
                icon={<Download className="w-4 h-4" />}
              >
                Import from catalogue
              </Button>
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
              className="w-16 h-16 rounded-[14px] flex-shrink-0 bg-text-primary/[0.06] grid place-items-center text-text-faint cursor-pointer"
              onClick={() => setBundleDetailId(l.bundle_id)}
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
              <button
                type="button"
                onClick={() => setBundleDetailId(l.bundle_id)}
                className="font-display font-medium text-[15px] truncate text-left hover:text-accent-glow block"
              >
                {l.bundle_name}
              </button>
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
                {l.per_item_discount_ngn != null &&
                  Number(l.per_item_discount_ngn) > 0 && (
                    <Pill tone="success" dot={false}>
                      −{money(Number(l.per_item_discount_ngn))} / item
                    </Pill>
                  )}
                {l.campaign_bundle_price_ngn != null && (
                  <MoneyText
                    ngn={Number(l.campaign_bundle_price_ngn)}
                    className="text-[11px]"
                  />
                )}
              </div>
            </div>
            {canEdit && (
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => detach.mutate(l.link_id)}
                  aria-label="Remove bundle"
                  className="text-text-faint hover:text-danger p-1"
                  title="Remove from this campaign (catalogue copy is untouched)"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Import from catalogue: pick a bundle_offer to mirror into the campaign */}
      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Import bundle from catalogue"
        size="lg"
      >
        <CatalogueBundlePicker
          sources={sources}
          isLoading={sourcesQ.isLoading}
          isError={sourcesQ.isError}
          onRetry={() => sourcesQ.refetch()}
          links={links}
          onImport={async (id) => {
            await handleImport(id);
          }}
          importingId={
            importBundle.isPending && importBundle.variables
              ? importBundle.variables
              : null
          }
        />
      </Modal>

      {/* Stylish animated modal — bundle hero + full product list + prices */}
      <BundleDetailModal
        bundleLink={
          links.find((l) => l.bundle_id === bundleDetailId) || null
        }
        bundleId={bundleDetailId}
        onClose={() => setBundleDetailId(null)}
      />
    </Card>
  );
}

/**
 * Picker that lists the catalogue bundles available to import. Same source as
 * Catalogue → Bundles (retention.bundle_offers). Already-imported bundles are
 * shown with a tick and disabled so the user can't double-attach.
 */
function CatalogueBundlePicker({
  sources,
  isLoading,
  isError,
  onRetry,
  links,
  onImport,
  importingId,
}: {
  sources: CatalogueBundleSource[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  links: CampaignBundleLink[];
  onImport: (id: string) => Promise<void>;
  importingId: string | null;
}) {
  if (isLoading) {
    return <Skeleton style={{ height: 240 }} />;
  }
  if (isError) {
    return <ErrorState onRetry={onRetry} />;
  }
  if (sources.length === 0) {
    return (
      <EmptyState
        icon={<PackagePlus className="w-7 h-7" />}
        title="No bundles in your catalogue yet"
        message="Build bundles under Catalogue → Bundles, then import them here. Bundle pricing, images and components all come from there."
      />
    );
  }
  // Already-imported lookup uses the source bundle_code as a fingerprint —
  // the import service derives the mirror slug from `${campaign-slug}-${code}`
  // so a previously imported source ends with that suffix in the link list.
  const importedCodes = new Set(
    links
      .map((l) => l.bundle_slug.split("-").slice(-1)[0] || "")
      .filter(Boolean),
  );
  return (
    <div className="space-y-2 max-h-[60vh] overflow-y-auto">
      {sources.map((s) => {
        const isImported =
          importedCodes.has(
            (s.bundle_code || "").toLowerCase().replace(/[^a-z0-9]/g, ""),
          ) ||
          links.some(
            (l) =>
              l.bundle_name === s.display_name ||
              l.bundle_slug.endsWith(
                (s.bundle_code || "").toLowerCase().replace(/[^a-z0-9]/g, "-"),
              ),
          );
        const isBusy = importingId === s.bundle_offer_id;
        return (
          <button
            key={s.bundle_offer_id}
            onClick={() => !isImported && !isBusy && onImport(s.bundle_offer_id)}
            disabled={isImported || isBusy}
            className={cn(
              "w-full text-left flex items-center gap-3 p-3 rounded-[12px] border transition-colors",
              isImported
                ? "border-success/40 bg-success/[0.08] cursor-default"
                : "border-line hover:border-accent/45 hover:bg-accent/[0.05]",
            )}
          >
            <div
              className="w-14 h-14 rounded-[10px] bg-text-primary/[0.05] grid place-items-center flex-shrink-0 overflow-hidden"
              style={
                s.hero_image_url
                  ? {
                      backgroundImage: `url(${s.hero_image_url})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }
                  : undefined
              }
            >
              {!s.hero_image_url && (
                <ImageIcon className="w-5 h-5 text-text-faint" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-display font-medium text-[14px] truncate">
                {s.display_name}
              </div>
              <div className="text-[11.5px] text-text-faint truncate">
                {s.bundle_code} · {s.component_count} product
                {s.component_count !== 1 ? "s" : ""}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1.5 text-[11px]">
                <Pill tone="neutral" dot={false}>
                  {prettyPricingModel(s.pricing_model)}
                </Pill>
                {s.pricing_model === "fixed_bundle_price" &&
                  s.bundle_price_ngn != null && (
                    <MoneyText
                      ngn={Number(s.bundle_price_ngn)}
                      className="text-[11px]"
                    />
                  )}
                {(s.pricing_model === "amount_off" ||
                  s.pricing_model === "pct_off") &&
                  s.discount_value != null && (
                    <Pill tone="success" dot={false}>
                      {s.pricing_model === "pct_off"
                        ? `${Number(s.discount_value)}% off`
                        : `−${money(Number(s.discount_value))} off`}
                    </Pill>
                  )}
              </div>
            </div>
            {isBusy ? (
              <span className="text-[11px] text-text-faint">Importing…</span>
            ) : isImported ? (
              <Check className="w-4 h-4 text-success" />
            ) : (
              <Download className="w-4 h-4 text-text-faint" />
            )}
          </button>
        );
      })}
    </div>
  );
}

function prettyPricingModel(m: string): string {
  if (m === "fixed_bundle_price") return "Fixed ₦ price";
  if (m === "pct_off") return "% off the bundle";
  if (m === "amount_off") return "Fixed ₦ off the bundle";
  if (m === "buy_x_get_y") return "Buy X get Y";
  if (m === "tiered") return "Tiered";
  return m || "Bundle";
}

function pricingModelHelp(m: string): string {
  if (m === "fixed_bundle_price")
    return "One flat price for the whole bundle, whatever it contains.";
  if (m === "pct_off")
    return "Take this percentage off the total of everything in the bundle.";
  if (m === "amount_off")
    return "Take this fixed ₦ amount off the whole bundle. It stays the same no matter how many products you add.";
  if (m === "buy_x_get_y")
    return "Buy a quantity, get another at a discount.";
  if (m === "tiered") return "Different discount at different quantities.";
  return "";
}

/**
 * Stylish animated modal showing the full bundle — hero, display name,
 * pricing model + discount, every product with its image / name / price,
 * and the real-vs-discounted price summary the buyer would see.
 * The bundle is read-only here: edits happen in Catalogue → Bundles.
 */
function BundleDetailModal({
  bundleLink,
  bundleId,
  onClose,
}: {
  bundleLink: CampaignBundleLink | null;
  bundleId: string | null;
  onClose: () => void;
}) {
  const bundleQ = useBundle(bundleId || undefined);
  const bundle = bundleQ.data;
  const items = (bundle?.items || []) as BundleItem[];

  // Real price = sum of component unit_price × qty (what the buyer would pay
  // for these products bought separately). Discounted price prefers the
  // explicit campaign_bundle_price; otherwise applies the per-item discount.
  const realTotal = items.reduce(
    (s, i) => s + Number(i.unit_price_ngn || 0) * (Number(i.quantity) || 1),
    0,
  );
  let discountedTotal: number | null = null;
  if (
    bundleLink?.campaign_bundle_price_ngn != null &&
    Number(bundleLink.campaign_bundle_price_ngn) > 0
  ) {
    discountedTotal = Number(bundleLink.campaign_bundle_price_ngn);
  } else if (
    bundleLink?.per_item_discount_ngn != null &&
    Number(bundleLink.per_item_discount_ngn) > 0
  ) {
    const itemCount = items.reduce(
      (s, i) => s + (Number(i.quantity) || 1),
      0,
    );
    discountedTotal = Math.max(
      0,
      realTotal - Number(bundleLink.per_item_discount_ngn) * itemCount,
    );
  } else if (
    bundle?.default_per_item_discount_ngn != null &&
    Number(bundle.default_per_item_discount_ngn) > 0
  ) {
    const itemCount = items.reduce(
      (s, i) => s + (Number(i.quantity) || 1),
      0,
    );
    discountedTotal = Math.max(
      0,
      realTotal -
        Number(bundle.default_per_item_discount_ngn) * itemCount,
    );
  }

  const hasDiscount =
    discountedTotal != null && discountedTotal < realTotal && realTotal > 0;

  return (
    <Modal
      open={Boolean(bundleId)}
      onClose={onClose}
      size="xl"
      title={bundle?.name || bundleLink?.bundle_name || "Loading…"}
    >
      {bundleQ.isLoading && <Skeleton style={{ height: 320 }} />}
      {!bundleQ.isLoading && bundle && (
        <div className="space-y-5">
          {/* Hero */}
          <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-5">
            <div
              className="relative w-full aspect-[4/5] md:aspect-square rounded-[16px] overflow-hidden bg-text-primary/[0.05] grid place-items-center text-text-faint border border-line"
              style={
                bundle.hero_image_url
                  ? {
                      backgroundImage: `url(${bundle.hero_image_url})`,
                      backgroundSize: "cover",
                      backgroundPosition: "center",
                    }
                  : undefined
              }
            >
              {!bundle.hero_image_url && <ImageIcon className="w-10 h-10" />}
              {hasDiscount && (
                <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-accent/90 text-white text-[11px] font-semibold tracking-wide shadow-lg">
                  Bundle deal
                </div>
              )}
            </div>
            <div className="space-y-3">
              <div>
                <div className="micro mb-1">Display name</div>
                <div className="font-display text-[22px] leading-tight">
                  {bundle.name}
                </div>
                {bundle.description && (
                  <p className="text-[13px] text-text-muted mt-1.5">
                    {bundle.description}
                  </p>
                )}
              </div>

              {/* Pricing model — match Catalogue → Bundles wording */}
              <div>
                <div className="micro mb-1">Pricing model</div>
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-display text-[15px]">
                    {prettyPricingModel(
                      bundleLink?.campaign_bundle_price_ngn != null
                        ? "fixed_bundle_price"
                        : bundleLink?.per_item_discount_ngn != null
                          ? "amount_off"
                          : (bundle as { pricing_model?: string })
                              .pricing_model || "amount_off",
                    )}
                  </span>
                </div>
                <p className="text-[12px] text-text-faint mt-1 leading-relaxed">
                  {pricingModelHelp(
                    bundleLink?.campaign_bundle_price_ngn != null
                      ? "fixed_bundle_price"
                      : bundleLink?.per_item_discount_ngn != null
                        ? "amount_off"
                        : (bundle as { pricing_model?: string })
                            .pricing_model || "amount_off",
                  )}
                </p>
              </div>

              {/* Real vs discounted price summary */}
              <div className="rounded-[14px] border border-line bg-text-primary/[0.03] p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[12px] text-text-muted">
                    Components total
                  </span>
                  <span
                    className={cn(
                      "font-mono tabular-nums text-[15px]",
                      hasDiscount && "text-danger line-through",
                    )}
                    style={hasDiscount ? { color: "#ef4444" } : undefined}
                  >
                    {money(realTotal)}
                  </span>
                </div>
                {hasDiscount && discountedTotal != null && (
                  <div className="flex items-baseline justify-between gap-3 mt-2 pt-2 border-t hairline">
                    <span className="text-[12px] text-text-muted">
                      Campaign bundle price
                    </span>
                    <span className="font-mono tabular-nums text-[22px] font-extrabold text-accent-glow">
                      {money(discountedTotal)}
                    </span>
                  </div>
                )}
                {hasDiscount && discountedTotal != null && (
                  <div className="flex items-baseline justify-end mt-1">
                    <Pill tone="success" dot={false}>
                      You save {money(realTotal - discountedTotal)}
                    </Pill>
                  </div>
                )}
                {bundleLink?.per_item_discount_ngn != null &&
                  Number(bundleLink.per_item_discount_ngn) > 0 && (
                    <div className="flex items-center gap-1.5 text-[11px] text-text-faint mt-2">
                      <Tag className="w-3 h-3" />
                      Per-item discount:{" "}
                      {money(Number(bundleLink.per_item_discount_ngn))} / each
                    </div>
                  )}
              </div>
            </div>
          </div>

          {/* Products in this bundle */}
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="font-display text-[18px]">
                Products in this bundle
              </h3>
              <span className="text-[12px] text-text-faint">
                {items.length} item{items.length !== 1 ? "s" : ""} ·{" "}
                {money(realTotal)} total
              </span>
            </div>

            {items.length === 0 && (
              <div className="text-center py-8 text-text-muted text-[13px]">
                This bundle has no products yet. Add them under
                Catalogue → Bundles and re-import.
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {items.map((item) => (
                <div
                  key={item.bundle_item_id}
                  className="flex gap-3 p-3 rounded-[14px] border border-line bg-text-primary/[0.03] hover:border-accent/30 transition-colors"
                >
                  <div
                    className="w-20 h-24 rounded-[10px] bg-text-primary/[0.06] grid place-items-center flex-shrink-0 overflow-hidden"
                    style={
                      item.hero_image_url
                        ? {
                            backgroundImage: `url(${item.hero_image_url})`,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                          }
                        : undefined
                    }
                  >
                    {!item.hero_image_url && (
                      <ImageIcon className="w-5 h-5 text-text-faint" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="text-[13.5px] font-medium leading-snug truncate">
                        {item.display_name ||
                          item.styled_name ||
                          item.product_name ||
                          "Product"}
                      </div>
                      <div className="text-[11px] text-text-faint mt-0.5">
                        {item.styled_id ? "styled" : "base"}
                        {item.quantity > 1 && ` · qty ${item.quantity}`}
                      </div>
                    </div>
                    <div className="flex items-baseline justify-between mt-1.5">
                      {item.unit_price_ngn != null ? (
                        <MoneyText
                          ngn={Number(item.unit_price_ngn)}
                          className="text-[14px] font-mono tabular-nums font-semibold"
                        />
                      ) : (
                        <span className="text-[11px] text-text-faint">
                          Not priced
                        </span>
                      )}
                      {item.per_item_discount_ngn != null &&
                        Number(item.per_item_discount_ngn) > 0 && (
                          <span className="text-[11px] text-success">
                            −{money(Number(item.per_item_discount_ngn))} ea
                          </span>
                        )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-[11.5px] text-text-faint border-t hairline pt-3">
            Bundles are managed under Catalogue → Bundles. Edit the source
            there to change the name, components, pricing or images, then
            re-import to refresh this campaign.
          </p>
        </div>
      )}
    </Modal>
  );
}

// ── Step 4: Pricing ──────────────────────────────────────
function PricingStep({
  campaign,
  canEdit,
}: {
  campaign: Campaign;
  canEdit: boolean;
}) {
  const update = useUpdateCampaign(campaign.campaign_id);
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
      {/* Per-position discount ladder */}
      <Card className="p-5 space-y-4">
        <div>
          <h2 className="font-display text-[22px] leading-tight">
            Per-position discount ladder
          </h2>
          <p className="text-text-muted text-[13px] mt-1">
            Discounts for individual wig purchases. 1st wig gets X off, 2nd gets
            more, 3rd gets even more — encourages buying multiple individual wigs
            (not bundles).
          </p>
        </div>
        <PositionLadderEditor
          ladder={campaign.position_ladder || []}
          canEdit={canEdit}
          onSave={(ladder) =>
            update.mutateAsync({ position_ladder: ladder } as Partial<Campaign>)
          }
        />
      </Card>

      {/* Stacking bonus */}
      <Card className="p-5 space-y-4">
        <div>
          <h2 className="font-display text-[22px] leading-tight">
            Bundle stacking bonus
          </h2>
          <p className="text-text-muted text-[13px] mt-1">
            Auto-apply extra discount when a customer buys 2+ separate bundles.
            Shows a "You unlocked ₦X off!" banner in the cart.
          </p>
        </div>
        <StackingBonusEditor
          bonus={campaign.stacking_bonus}
          canEdit={canEdit}
          onSave={(bonus) =>
            update.mutateAsync({ stacking_bonus: bonus } as Partial<Campaign>)
          }
        />
      </Card>

      {/* Reseller / bulk tiers */}
      <Card className="p-5 space-y-4">
        <div>
          <h2 className="font-display text-[22px] leading-tight">
            Reseller / bulk tiers
          </h2>
          <p className="text-text-muted text-[13px] mt-1">
            Visible on the landing page so wholesale buyers know the discounts.
            12+ items = factory rate, 20+ = deeper cut. Display-only on
            frontend; backend enforces at checkout.
          </p>
        </div>
        <BulkTierEditor
          tiers={campaign.bulk_tiers || []}
          canEdit={canEdit}
          onSave={(bt) =>
            update.mutateAsync({ bulk_tiers: bt } as Partial<Campaign>)
          }
        />
      </Card>

      {/* Quantity tier ladder (existing) */}
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

// ── Position ladder editor ──────────────────────────────
function PositionLadderEditor({
  ladder,
  canEdit,
  onSave,
}: {
  ladder: PositionLadderItem[];
  canEdit: boolean;
  onSave: (items: PositionLadderItem[]) => Promise<unknown>;
}) {
  const [items, setItems] = useState<PositionLadderItem[]>(ladder);
  const [pos, setPos] = useState("");
  const [disc, setDisc] = useState("");
  const [lbl, setLbl] = useState("");
  const [saving, setSaving] = useState(false);

  const dirty =
    JSON.stringify(items) !== JSON.stringify(ladder);

  function addRow() {
    if (!pos || !disc) return;
    const p = Number(pos);
    const next = items
      .filter((r) => r.position !== p)
      .concat({ position: p, discount_ngn: Number(disc), label: lbl || undefined });
    next.sort((a, b) => a.position - b.position);
    setItems(next);
    setPos("");
    setDisc("");
    setLbl("");
  }

  function removeRow(position: number) {
    setItems(items.filter((r) => r.position !== position));
  }

  async function save() {
    setSaving(true);
    await onSave(items.length ? items : []);
    setSaving(false);
  }

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <div className="text-[13px] text-text-faint italic py-3">
          No position discounts. Add one below — e.g. 1st wig ₦16,000 off, 2nd
          ₦25,000 off.
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((r) => (
            <div
              key={r.position}
              className="flex items-center gap-3 p-3 rounded-[12px] bg-text-primary/[0.04] border border-line"
            >
              <span className="font-display font-medium text-[16px] w-16 text-center tabular-nums">
                {ordinal(r.position)} wig
              </span>
              <span className="text-text-muted text-[13px]">→</span>
              <span className="text-accent-glow font-mono text-[13px]">
                −{money(r.discount_ngn)}
              </span>
              <span className="text-text-muted text-[12px] truncate flex-1">
                {r.label || ""}
              </span>
              {canEdit && (
                <button
                  onClick={() => removeRow(r.position)}
                  className="text-text-faint hover:text-danger p-1"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {canEdit && (
        <>
          <div className="rounded-[14px] border border-line bg-text-primary/[0.02] p-4 space-y-3">
            <div className="micro">Add a position</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Position (nth wig)">
                <NumberField
                  value={pos}
                  onChange={setPos}
                  allowDecimal={false}
                  suffix="th"
                />
              </Field>
              <Field label="Discount off">
                <NumberField
                  value={disc}
                  onChange={setDisc}
                  suffix="NGN"
                  allowDecimal={false}
                />
              </Field>
              <Field label="Label (optional)">
                <input
                  value={lbl}
                  onChange={(e) => setLbl(e.target.value)}
                  placeholder={`${ordinal(Number(pos) || 1)} wig discount`}
                  className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px]"
                />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button
                variant="secondary"
                onClick={addRow}
                icon={<Plus className="w-4 h-4" />}
                disabled={!pos || !disc}
              >
                Add
              </Button>
            </div>
          </div>
          {dirty && (
            <div className="flex justify-end">
              <Button variant="primary" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save position ladder"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ── Stacking bonus editor ───────────────────────────────
function StackingBonusEditor({
  bonus,
  canEdit,
  onSave,
}: {
  bonus: StackingBonus | null;
  canEdit: boolean;
  onSave: (b: StackingBonus | null) => Promise<unknown>;
}) {
  const [enabled, setEnabled] = useState(Boolean(bonus));
  const [minBundles, setMinBundles] = useState(
    String(bonus?.min_distinct_bundles ?? 2),
  );
  const [disc, setDisc] = useState(String(bonus?.discount_ngn ?? ""));
  const [label, setLabel] = useState(bonus?.label ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    if (!enabled) {
      await onSave(null);
    } else {
      await onSave({
        min_distinct_bundles: Number(minBundles) || 2,
        discount_ngn: Number(disc) || 0,
        label: label || undefined,
      });
    }
    setSaving(false);
  }

  return (
    <div className="space-y-3">
      <Toggle
        checked={enabled}
        onChange={setEnabled}
        disabled={!canEdit}
        label={enabled ? "Stacking bonus active" : "Off"}
      />
      {enabled && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Min distinct bundles">
            <NumberField
              value={minBundles}
              onChange={setMinBundles}
              allowDecimal={false}
              suffix="bundles"
              disabled={!canEdit}
            />
          </Field>
          <Field label="Bonus discount">
            <NumberField
              value={disc}
              onChange={setDisc}
              suffix="NGN"
              allowDecimal={false}
              disabled={!canEdit}
            />
          </Field>
          <Field label="Banner label (optional)">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={!canEdit}
              placeholder="You unlocked ₦120,000 off!"
              className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px] disabled:opacity-50"
            />
          </Field>
        </div>
      )}
      {canEdit && (
        <div className="flex justify-end">
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save stacking bonus"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Bulk tier editor ────────────────────────────────────
function BulkTierEditor({
  tiers,
  canEdit,
  onSave,
}: {
  tiers: BulkTier[];
  canEdit: boolean;
  onSave: (items: BulkTier[]) => Promise<unknown>;
}) {
  const [items, setItems] = useState<BulkTier[]>(tiers);
  const [qty, setQty] = useState("");
  const [disc, setDisc] = useState("");
  const [lbl, setLbl] = useState("");
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify(items) !== JSON.stringify(tiers);

  function addRow() {
    if (!qty || !disc) return;
    const q = Number(qty);
    const next = items
      .filter((r) => r.min_qty !== q)
      .concat({
        min_qty: q,
        discount_per_item_ngn: Number(disc),
        label: lbl || undefined,
      });
    next.sort((a, b) => a.min_qty - b.min_qty);
    setItems(next);
    setQty("");
    setDisc("");
    setLbl("");
  }

  function removeRow(minQty: number) {
    setItems(items.filter((r) => r.min_qty !== minQty));
  }

  async function save() {
    setSaving(true);
    await onSave(items);
    setSaving(false);
  }

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <div className="text-[13px] text-text-faint italic py-3">
          No bulk tiers. Add one below — e.g. 12+ items = ₦67,000 off each.
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((r) => (
            <div
              key={r.min_qty}
              className="flex items-center gap-3 p-3 rounded-[12px] bg-text-primary/[0.04] border border-line"
            >
              <span className="font-display font-medium text-[16px] w-12 text-center tabular-nums">
                {r.min_qty}+
              </span>
              <span className="text-text-muted text-[13px]">→</span>
              <span className="text-accent-glow font-mono text-[13px]">
                −{money(r.discount_per_item_ngn)}/each
              </span>
              <span className="text-text-muted text-[12px] truncate flex-1">
                {r.label || ""}
              </span>
              {canEdit && (
                <button
                  onClick={() => removeRow(r.min_qty)}
                  className="text-text-faint hover:text-danger p-1"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {canEdit && (
        <>
          <div className="rounded-[14px] border border-line bg-text-primary/[0.02] p-4 space-y-3">
            <div className="micro">Add a bulk tier</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Minimum quantity">
                <NumberField
                  value={qty}
                  onChange={setQty}
                  allowDecimal={false}
                  suffix="items"
                />
              </Field>
              <Field label="Discount per item">
                <NumberField
                  value={disc}
                  onChange={setDisc}
                  suffix="NGN"
                  allowDecimal={false}
                />
              </Field>
              <Field label="Label (optional)">
                <input
                  value={lbl}
                  onChange={(e) => setLbl(e.target.value)}
                  placeholder={`${qty || "N"}+ = factory rate`}
                  className="w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px]"
                />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button
                variant="secondary"
                onClick={addRow}
                icon={<Plus className="w-4 h-4" />}
                disabled={!qty || !disc}
              >
                Add tier
              </Button>
            </div>
          </div>
          {dirty && (
            <div className="flex justify-end">
              <Button variant="primary" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save bulk tiers"}
              </Button>
            </div>
          )}
        </>
      )}
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
  const cfg = useBusinessConfig();
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
            href={publicSaleUrl(campaign.slug, {
              salesSubdomain: cfg.data?.sales_subdomain,
              storefrontDomain: cfg.data?.storefront_domain,
              brand,
            })}
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
