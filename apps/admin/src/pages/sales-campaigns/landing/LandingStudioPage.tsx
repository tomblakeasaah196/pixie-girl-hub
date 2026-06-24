/**
 * LandingStudioPage — full-screen editor for both the brand "no-sale" landing
 * page AND per-campaign landing content.
 *
 * Usage:
 *   /landing-studio               → brand-level editor only
 *   /landing-studio?campaign=:id  → brand editor + campaign content panels
 *
 * Left: editor panels (identity, theme, background, logo + tint, hero,
 * invitation, form fields, gallery, pillars, socials, reveal — all brand-level;
 * then campaign hero, countdown, products, blocks, SEO when ?campaign is set).
 * Right: live preview (brand page or campaign landing based on mode).
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  ImageUp,
  Loader2,
  Minus,
  Play,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { useBusinessStore } from "@/stores/business";
import {
  useLandingStudio,
  useSaveLandingDraft,
  usePublishLanding,
  useCampaignLanding,
  useSaveCampaignLanding,
  uploadLandingImage,
  uploadLandingOgBanner,
  withDefaults,
  defaultConfig,
  type LandingConfig,
  type ChannelOption,
  type CampaignLanding,
} from "@/lib/landing-studio";
import {
  CURATED_FONTS,
  googleFamilyFromUrl,
  type FontSelection,
  type TypographyRole,
} from "@landing-kit";
import type { LandingBlock } from "@/lib/campaigns";
import { DeniedState } from "@/components/ui/controls";
import { LandingPreview } from "./LandingPreview";
import { AtelierRevealPreview } from "./AtelierRevealPreview";
import { LandingRender, type LandingModel } from "./LandingRender";

const THEME_KEYS: { key: keyof LandingConfig["theme"]; label: string }[] = [
  { key: "primary", label: "Primary" },
  { key: "primaryDeep", label: "Primary deep" },
  { key: "accent", label: "Accent" },
  { key: "glow", label: "Glow" },
  { key: "paper", label: "Paper (bg)" },
  { key: "ink", label: "Ink (hero bg)" },
  { key: "muted", label: "Muted text" },
];

type PreviewState = "before" | "live" | "ended";

// ── Block helpers ─────────────────────────────────────────────

function getBlockProps(blocks: LandingBlock[], key: string): Record<string, unknown> {
  return (blocks.find((b) => b.key === key)?.props as Record<string, unknown>) || {};
}

function setBlockProps(
  blocks: LandingBlock[],
  key: string,
  props: Record<string, unknown>,
): LandingBlock[] {
  const idx = blocks.findIndex((b) => b.key === key);
  if (idx >= 0) {
    const next = [...blocks];
    next[idx] = { ...next[idx], props, enabled: true };
    return next;
  }
  return [...blocks, { key, enabled: true, props }];
}

// ─────────────────────────────────────────────────────────────

export function LandingStudioPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const campaignId = searchParams.get("campaign");

  const can = useAuthStore((s) => s.can);
  const brandKey = useBusinessStore((s) => s.activeKey);
  const brandLabel = brandKey === "faitlynhair" ? "Faitlyn Hair" : "Pixie Girl";

  // Brand config state
  const studio = useLandingStudio();
  const saveDraft = useSaveLandingDraft();
  const publish = usePublishLanding();

  const [config, setConfig] = useState<LandingConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [replay, setReplay] = useState(0);
  const [showReveal, setShowReveal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Campaign landing state
  const campaignQuery = useCampaignLanding(campaignId);
  const saveCampaign = useSaveCampaignLanding();
  const [campaign, setCampaign] = useState<CampaignLanding | null>(null);
  const [campaignDirty, setCampaignDirty] = useState(false);
  const [previewState, setPreviewState] = useState<PreviewState>("live");
  const [previewMode, setPreviewMode] = useState<"brand" | "campaign">(
    campaignId ? "campaign" : "brand",
  );

  // Load brand config
  useEffect(() => {
    if (studio.data) {
      setConfig(withDefaults(brandKey, studio.data.config));
      setDirty(false);
    }
  }, [studio.data, brandKey]);

  // Load campaign landing
  useEffect(() => {
    if (campaignQuery.data) {
      setCampaign(campaignQuery.data);
      setCampaignDirty(false);
    }
  }, [campaignQuery.data]);

  // Switch preview to campaign when campaign loads
  useEffect(() => {
    if (campaignId) setPreviewMode("campaign");
  }, [campaignId]);

  const canEdit = can("sales_campaigns", "edit");

  function update(mutator: (draft: LandingConfig) => void) {
    setConfig((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      mutator(next);
      return next;
    });
    setDirty(true);
  }

  function updateCampaign(mutator: (draft: CampaignLanding) => void) {
    setCampaign((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      mutator(next);
      return next;
    });
    setCampaignDirty(true);
  }

  function updateBlock(key: string, patchFn: (p: Record<string, unknown>) => Record<string, unknown>) {
    updateCampaign((d) => {
      d.landing_blocks = setBlockProps(
        d.landing_blocks || [],
        key,
        patchFn(getBlockProps(d.landing_blocks || [], key)),
      );
    });
  }

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function onSave() {
    if (!config && !campaign) return;
    try {
      const saves: Promise<unknown>[] = [];
      if (dirty && config) saves.push(saveDraft.mutateAsync(config));
      if (campaignDirty && campaign && campaignId) {
        saves.push(
          saveCampaign.mutateAsync({
            id: campaignId,
            patch: {
              landing_hero_title: campaign.landing_hero_title,
              landing_hero_subtitle: campaign.landing_hero_subtitle,
              landing_hero_image_url: campaign.landing_hero_image_url,
              landing_cta_text: campaign.landing_cta_text,
              landing_blocks: campaign.landing_blocks,
              countdown_message: campaign.countdown_message,
              ended_message: campaign.ended_message,
              ended_redirect_to: campaign.ended_redirect_to || undefined,
              meta_title: campaign.meta_title,
              meta_description: campaign.meta_description,
              og_image_url: campaign.og_image_url,
              landing_extras: campaign.landing_extras,
            },
          }),
        );
      }
      await Promise.all(saves);
      setDirty(false);
      setCampaignDirty(false);
      flash("Draft saved");
    } catch (e) {
      flash(e instanceof Error ? e.message : "Couldn't save — please try again");
    }
  }

  async function onPublish() {
    if (!config) return;
    try {
      if (dirty) await saveDraft.mutateAsync(config);
      await publish.mutateAsync();
      setDirty(false);
      flash("Published live");
    } catch (e) {
      flash(e instanceof Error ? e.message : "Couldn't publish — please try again");
    }
  }

  function openPreviewTab() {
    const go = () =>
      window.open(`/landing-studio/preview?brand=${brandKey}`, "_blank", "noopener");
    if (dirty && config) {
      void saveDraft.mutateAsync(config).then(() => {
        setDirty(false);
        go();
      });
    } else {
      go();
    }
  }

  // Build LandingModel for campaign preview
  const previewModel: LandingModel | null =
    campaign && config
      ? {
          slug: campaign.slug,
          name: campaign.name,
          state: previewState,
          hero: {
            title: campaign.landing_hero_title || campaign.name,
            subtitle: campaign.landing_hero_subtitle,
            image_url: campaign.landing_hero_image_url,
            cta_text: campaign.landing_cta_text,
          },
          countdown_to:
            previewState === "before"
              ? campaign.starts_at
              : previewState === "live"
                ? campaign.ends_at
                : null,
          countdown_message: campaign.countdown_message,
          blocks: campaign.landing_blocks || [],
          products: [],
          ended:
            previewState === "ended"
              ? {
                  message: campaign.ended_message,
                  redirect_to: campaign.ended_redirect_to,
                }
              : null,
        }
      : null;

  const isSaving = saveDraft.isPending || saveCampaign.isPending;
  const anyDirty = dirty || campaignDirty;

  if (!can("sales_campaigns", "view")) {
    return <DeniedState message="You don't have access to the Landing Studio." />;
  }

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-bg">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 h-14 border-b hairline shrink-0">
        <button
          onClick={() => navigate(campaignId ? `/sales-campaigns/${campaignId}` : "/sales-campaigns")}
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-text-muted hover:text-text-primary"
        >
          <ArrowLeft className="w-4 h-4" /> {campaignId ? "Campaign" : "Campaigns"}
        </button>
        <div className="h-5 w-px bg-line" />
        <div className="min-w-0">
          <div className="font-display text-[16px] leading-tight truncate">Landing Studio</div>
          <div className="micro -mt-0.5">
            {brandLabel}
            {campaignId && campaign
              ? ` · ${campaign.name}`
              : " · no active sale"}
            {!campaignId && (studio.data?.is_published ? " · published" : " · draft only")}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {anyDirty && <span className="text-[11px] text-warn">Unsaved changes</span>}
          {!campaignId && (
            <button
              onClick={openPreviewTab}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[10px] border hairline text-[13px] font-semibold text-text-muted hover:text-text-primary hover:border-accent/40"
            >
              <ExternalLink className="w-4 h-4" /> Preview tab
            </button>
          )}
          {canEdit && (
            <>
              <button
                onClick={onSave}
                disabled={isSaving}
                title={anyDirty ? "Save your work as a draft." : "No unsaved changes."}
                className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-[10px] text-[13px] font-semibold transition-colors ${
                  anyDirty
                    ? "border hairline text-text-muted hover:text-text-primary hover:border-accent/40"
                    : "border hairline text-text-faint border-line/50 cursor-default"
                } disabled:opacity-60`}
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
              </button>
              {!campaignId && (
                <button
                  onClick={onPublish}
                  disabled={publish.isPending}
                  title="Save and publish live in one step."
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-[10px] bg-accent-deep text-text-primary text-[13px] font-semibold disabled:opacity-60"
                >
                  {publish.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Publish
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {/* Body: editor | preview */}
      <div className="flex-1 min-h-0 flex">
        {/* Editor sidebar */}
        <aside className="w-[380px] shrink-0 border-r hairline overflow-y-auto p-4 space-y-3">
          {studio.isLoading || !config ? (
            <div className="grid place-items-center h-40 text-text-faint">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : !canEdit ? (
            <p className="text-[12px] text-text-faint">
              You have view-only access. Ask an admin for{" "}
              <code>sales_campaigns.edit</code> to make changes.
            </p>
          ) : (
            <BrandEditor
              config={config}
              update={update}
              brandKey={brandKey}
              onReset={() => {
                setConfig(defaultConfig(brandKey));
                setDirty(true);
              }}
              onReplay={() => {
                setShowReveal(true);
                setReplay((r) => r + 1);
              }}
            />
          )}

          {/* ── Campaign panels ───────────────────────────────── */}
          {campaignId && (
            <div className="pt-2 space-y-2.5">
              <div className="flex items-center gap-2 py-1">
                <div className="h-px flex-1 bg-line/60" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-accent-glow">
                  Campaign content
                </span>
                <div className="h-px flex-1 bg-line/60" />
              </div>

              {campaignQuery.isError ? (
                <div className="grid place-items-center gap-2 h-24 text-center px-3">
                  <p className="text-[12px] text-text-faint">
                    Couldn't load campaign content.
                  </p>
                  <button
                    onClick={() => campaignQuery.refetch()}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-bg/80 border hairline text-[12px] font-semibold text-text-muted hover:text-text-primary"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Retry
                  </button>
                </div>
              ) : !campaign ? (
                <div className="grid place-items-center h-20 text-text-faint">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
              ) : (
                <CampaignEditor
                  campaign={campaign}
                  updateCampaign={updateCampaign}
                  updateBlock={updateBlock}
                />
              )}
            </div>
          )}
        </aside>

        {/* Preview panel */}
        <main className="flex-1 min-w-0 relative bg-black/40 overflow-hidden">
          {/* Preview mode tabs (campaign mode only) */}
          {campaignId && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 rounded-full bg-bg/85 border hairline px-1.5 py-1 backdrop-blur">
              {(["brand", "campaign"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setPreviewMode(m)}
                  className={`px-3 h-7 rounded-full text-[12px] font-semibold capitalize transition-colors ${
                    previewMode === m
                      ? "bg-accent-deep text-text-primary"
                      : "text-text-faint hover:text-text-muted"
                  }`}
                >
                  {m === "brand" ? "Brand page" : "Campaign"}
                </button>
              ))}
              {previewMode === "campaign" && (
                <>
                  <div className="w-px h-4 bg-line/60 mx-1" />
                  {(["before", "live", "ended"] as PreviewState[]).map((s) => (
                    <button
                      key={s}
                      onClick={() => setPreviewState(s)}
                      className={`px-3 h-7 rounded-full text-[12px] font-semibold capitalize transition-colors ${
                        previewState === s
                          ? "bg-accent/20 text-accent-glow border border-accent/30"
                          : "text-text-faint hover:text-text-muted"
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}

          <div className="absolute inset-0 overflow-y-auto">
            {previewMode === "campaign" && previewModel ? (
              <LandingRender model={previewModel} brandConfig={config} />
            ) : (
              config && <LandingPreview config={config} />
            )}
          </div>

          {/* Reveal overlay (brand mode) */}
          {config && showReveal && previewMode === "brand" && (
            <AtelierRevealPreview
              config={config}
              replayKey={replay}
              onComplete={() => setShowReveal(false)}
            />
          )}
          {config && previewMode === "brand" && (
            <button
              onClick={() => {
                setShowReveal(true);
                setReplay((r) => r + 1);
              }}
              className="absolute bottom-4 left-4 z-[70] inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-bg/80 border hairline text-[12px] font-semibold text-text-muted hover:text-text-primary backdrop-blur"
            >
              <Play className="w-3.5 h-3.5" /> Play reveal
            </button>
          )}
        </main>
      </div>

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[90] px-4 py-2 rounded-full bg-accent-deep text-text-primary text-[13px] font-semibold shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Brand config editor (identical to original LandingStudioPage)
// ════════════════════════════════════════════════════════════

function BrandEditor({
  config,
  update,
  brandKey,
  onReset,
  onReplay,
}: {
  config: LandingConfig;
  update: (m: (d: LandingConfig) => void) => void;
  brandKey: string;
  onReset: () => void;
  onReplay: () => void;
}) {
  return (
    <div className="space-y-2.5">
      <Section title="Identity" defaultOpen>
        <Text label="Brand name" value={config.brandName} onChange={(v) => update((d) => { d.brandName = v; })} />
        <Text label="Legal name" value={config.legalName} onChange={(v) => update((d) => { d.legalName = v; })} />
        <Text label="Tagline" value={config.tagline} onChange={(v) => update((d) => { d.tagline = v; })} />
        <Text label="Welcome line (reveal)" value={config.welcomeLine} onChange={(v) => update((d) => { d.welcomeLine = v; })} />
        <Text label="Sales domain" value={config.domain} onChange={(v) => update((d) => { d.domain = v; })} />
        <Text label="Storefront URL" value={config.storefront} onChange={(v) => update((d) => { d.storefront = v; })} />
        <Text label="Address" value={config.address} onChange={(v) => update((d) => { d.address = v; })} />
      </Section>

      <Section title="Colours">
        <div className="grid grid-cols-2 gap-2">
          {THEME_KEYS.map(({ key, label }) => (
            <Color key={key} label={label} value={config.theme[key]} onChange={(v) => update((d) => { d.theme[key] = v; })} />
          ))}
        </div>
        <p className="text-[11px] text-text-faint mt-1">Reveal drape colours follow Primary / Accent / Ink automatically.</p>
      </Section>

      <Section title="Typography">
        <FontPicker
          label="Display font (headings & numerals)"
          value={config.typography.display}
          kind="serif"
          onChange={(v) => update((d) => { d.typography.display = v; })}
        />
        <FontPicker
          label="Body font (paragraphs & eyebrows)"
          value={config.typography.body}
          kind="sans"
          onChange={(v) => update((d) => { d.typography.body = v; })}
        />
        <Range
          label={`Master size ×${config.typography.scale.toFixed(2)}`}
          value={config.typography.scale}
          min={0.85}
          max={1.3}
          step={0.01}
          onChange={(v) => update((d) => { d.typography.scale = v; })}
        />
        <div className="pt-1 space-y-2.5">
          <span className="micro block">Per-role weight · spacing · leading</span>
          {(["heading", "body", "eyebrow", "numerals"] as TypographyRole[]).map((role) => (
            <RoleEditor
              key={role}
              role={role}
              value={config.typography.roles[role]}
              onChange={(patch) => update((d) => { Object.assign(d.typography.roles[role], patch); })}
            />
          ))}
        </div>
      </Section>

      <Section title="Textures">
        <Range label={`Paper grain ${Math.round(config.texture.grain * 100)}%`} value={config.texture.grain} min={0} max={1} step={0.01} onChange={(v) => update((d) => { d.texture.grain = v; })} />
        <Range label={`Glass blur ${config.texture.glassBlur.toFixed(0)}px`} value={config.texture.glassBlur} min={0} max={40} step={1} onChange={(v) => update((d) => { d.texture.glassBlur = v; })} />
        <Range label={`Glass opacity ${Math.round(config.texture.glassOpacity * 100)}%`} value={config.texture.glassOpacity} min={0.4} max={1} step={0.01} onChange={(v) => update((d) => { d.texture.glassOpacity = v; })} />
        <Range label={`Vignette ${Math.round(config.texture.vignette * 100)}%`} value={config.texture.vignette} min={0} max={1} step={0.01} onChange={(v) => update((d) => { d.texture.vignette = v; })} />
        <Range label={`Hero image overlay ${Math.round(config.texture.heroOverlay * 100)}%`} value={config.texture.heroOverlay} min={0} max={1} step={0.01} onChange={(v) => update((d) => { d.texture.heroOverlay = v; })} />
        <p className="text-[11px] text-text-faint">Grain & vignette wrap the whole page; glass affects the form card and pills; hero overlay darkens the hero image for legibility.</p>
      </Section>

      <Section title="Background">
        <Img label="Background image (optional)" value={config.background.imageUrl} onChange={(v) => update((d) => { d.background.imageUrl = v; d.background.type = v ? "image" : "color"; })} />
        <p className="text-[11px] text-text-faint">Leave empty to use the Paper colour as a flat background.</p>
      </Section>

      <Section title="Logo">
        <Img label="Logo image" value={config.logo.url} onChange={(v) => update((d) => { d.logo.url = v; })} />
        <Tint label="Header tint" value={config.logo.headerTint} suggest={config.theme.paper} onChange={(v) => update((d) => { d.logo.headerTint = v; })} />
        <Range label={`Header size ×${config.logo.headerScale.toFixed(2)}`} value={config.logo.headerScale} min={0.6} max={2.2} onChange={(v) => update((d) => { d.logo.headerScale = v; })} />
        <Tint label="Footer tint" value={config.logo.footerTint} suggest={config.theme.primary} onChange={(v) => update((d) => { d.logo.footerTint = v; })} />
        <Range label={`Footer size ×${config.logo.footerScale.toFixed(2)}`} value={config.logo.footerScale} min={0.6} max={2.2} onChange={(v) => update((d) => { d.logo.footerScale = v; })} />
        <p className="text-[11px] text-text-faint">Tint recolours the logo to a flat colour — fixes a dark logo on a dark header.</p>
      </Section>

      <Section title="Hero">
        <Img label="Hero image" value={config.hero.imageUrl} onChange={(v) => update((d) => { d.hero.imageUrl = v; })} />
        <Text label="Eyebrow" value={config.hero.eyebrow} onChange={(v) => update((d) => { d.hero.eyebrow = v; })} />
        <Text label="Headline" value={config.hero.headline} onChange={(v) => update((d) => { d.hero.headline = v; })} />
        <Text label="Headline accent (italic)" value={config.hero.headlineAccent} onChange={(v) => update((d) => { d.hero.headlineAccent = v; })} />
        <Area label="Body" value={config.hero.body} onChange={(v) => update((d) => { d.hero.body = v; })} />
        <Text label="CTA label" value={config.hero.ctaLabel} onChange={(v) => update((d) => { d.hero.ctaLabel = v; })} />
        <Text label="Footnote (launch season)" value={config.hero.launchSeasonLabel} onChange={(v) => update((d) => { d.hero.launchSeasonLabel = v; })} />
      </Section>

      <Section title="Invitation">
        <Text label="Eyebrow" value={config.invitation.eyebrow} onChange={(v) => update((d) => { d.invitation.eyebrow = v; })} />
        <Text label="Heading" value={config.invitation.heading} onChange={(v) => update((d) => { d.invitation.heading = v; })} />
        <Text label="Heading accent (italic)" value={config.invitation.headingAccent} onChange={(v) => update((d) => { d.invitation.headingAccent = v; })} />
        <Area label="Body" value={config.invitation.body} onChange={(v) => update((d) => { d.invitation.body = v; })} />
        <div className="grid grid-cols-2 gap-2">
          <Num label="Seats total" value={config.invitation.seatsTotal} onChange={(v) => update((d) => { d.invitation.seatsTotal = v; })} />
          <Num label="Seats claimed (base)" value={config.invitation.seatsClaimedBase} onChange={(v) => update((d) => { d.invitation.seatsClaimedBase = v; })} />
        </div>
        <Area label="Referral note" value={config.invitation.referralNote} onChange={(v) => update((d) => { d.invitation.referralNote = v; })} />
      </Section>

      <Section title="Form fields">
        <Toggle label="Collect name" checked={config.form.collectName} onChange={(v) => update((d) => { d.form.collectName = v; })} />
        <Toggle label="Collect email" checked={config.form.collectEmail} onChange={(v) => update((d) => { d.form.collectEmail = v; })} />
        <Toggle label="Collect WhatsApp" checked={config.form.collectWhatsapp} onChange={(v) => update((d) => { d.form.collectWhatsapp = v; })} />
        <Toggle label="Collect referral code" checked={config.form.collectReferral} onChange={(v) => update((d) => { d.form.collectReferral = v; })} />
        <div className="pt-1">
          <span className="micro block mb-1.5">Notify-via toggles</span>
          <div className="flex gap-1.5">
            {(["email", "whatsapp", "both"] as ChannelOption[]).map((c) => {
              const on = config.form.channels.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => update((d) => {
                    d.form.channels = on ? d.form.channels.filter((x) => x !== c) : [...d.form.channels, c];
                  })}
                  className={`px-2.5 h-8 rounded-[9px] text-[12px] font-semibold capitalize border ${on ? "border-accent/50 bg-accent/10 text-accent-glow" : "border-line text-text-faint"}`}
                >
                  {c}
                </button>
              );
            })}
          </div>
        </div>
        <Text label="Submit label" value={config.form.submitLabel} onChange={(v) => update((d) => { d.form.submitLabel = v; })} />
        <Text label="Footnote" value={config.form.footnote} onChange={(v) => update((d) => { d.form.footnote = v; })} />
      </Section>

      <Section title="Gallery">
        <GalleryEditor config={config} update={update} />
      </Section>

      <Section title="Pillars">
        {config.pillars.map((p, i) => (
          <div key={i} className="rounded-[10px] border hairline p-2.5 space-y-1.5">
            <div className="flex gap-2">
              <input value={p.numeral} onChange={(e) => update((d) => { d.pillars[i].numeral = e.target.value; })} className="w-12 input-sm" />
              <input value={p.title} onChange={(e) => update((d) => { d.pillars[i].title = e.target.value; })} className="flex-1 input-sm" placeholder="Title" />
            </div>
            <textarea value={p.body} onChange={(e) => update((d) => { d.pillars[i].body = e.target.value; })} rows={2} className="w-full input-sm" placeholder="Body" />
          </div>
        ))}
      </Section>

      <Section title="Socials">
        {config.socials.map((s, i) => (
          <div key={i} className="flex gap-1.5 items-center">
            <input value={s.platform} onChange={(e) => update((d) => { d.socials[i].platform = e.target.value; })} className="w-24 input-sm" placeholder="platform" />
            <input value={s.href} onChange={(e) => update((d) => { d.socials[i].href = e.target.value; })} className="flex-1 input-sm" placeholder="https://…" />
            <button onClick={() => update((d) => { d.socials.splice(i, 1); })} className="text-text-faint hover:text-danger p-1"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
        <button onClick={() => update((d) => { d.socials.push({ platform: "instagram", href: "", label: "" }); })} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-accent-glow"><Plus className="w-3.5 h-3.5" /> Add social</button>
      </Section>

      <Section title="Discovery & sharing">
        <Text label="Search title" value={config.seo.metaTitle} onChange={(v) => update((d) => { d.seo.metaTitle = v; })} />
        <Area label="Search & share description" value={config.seo.metaDescription} onChange={(v) => update((d) => { d.seo.metaDescription = v; })} />
        <OgImageField value={config.seo.ogImageUrl} onChange={(v) => update((d) => { d.seo.ogImageUrl = v; })} />
        <Img label="Favicon (a square logo works best)" value={config.seo.faviconUrl} onChange={(v) => update((d) => { d.seo.faviconUrl = v; })} />
        <Text label="Twitter / X handle" value={config.seo.twitterHandle} onChange={(v) => update((d) => { d.seo.twitterHandle = v; })} />
        <p className="text-[11px] text-text-faint">Controls the title, description, preview image and favicon shown by Google and when the link is shared.</p>
      </Section>

      <Section title="Reveal">
        <Toggle label="Cinematic reveal enabled" checked={config.reveal.enabled} onChange={(v) => update((d) => { d.reveal.enabled = v; })} />
        <Toggle label="Show scarcity counter" checked={config.reveal.showScarcity} onChange={(v) => update((d) => { d.reveal.showScarcity = v; })} />
        <Text label="Reveal tagline" value={config.reveal.tagline} onChange={(v) => update((d) => { d.reveal.tagline = v; })} />
        {config.reveal.threeD && (
          <div className="pt-2 mt-2 border-t border-border-c/10">
            <Toggle label="3D brand animation enabled" checked={config.reveal.threeD.enabled} onChange={(v) => update((d) => { if (d.reveal.threeD) d.reveal.threeD.enabled = v; })} />
            {config.reveal.threeD.enabled && (
              <>
                <div className="mt-3">
                  <label className="text-[12px] font-semibold block mb-1.5">Rotation Speed</label>
                  <input type="range" min="0.5" max="3" step="0.1" value={config.reveal.threeD.rotationSpeed} onChange={(e) => update((d) => { if (d.reveal.threeD) d.reveal.threeD.rotationSpeed = parseFloat(e.target.value); })} className="w-full" />
                  <span className="text-[11px] text-text-muted">{config.reveal.threeD.rotationSpeed.toFixed(1)}x</span>
                </div>
                <div className="mt-3">
                  <label className="text-[12px] font-semibold block mb-1.5">Glow Intensity</label>
                  <input type="range" min="0" max="2" step="0.1" value={config.reveal.threeD.glowIntensity} onChange={(e) => update((d) => { if (d.reveal.threeD) d.reveal.threeD.glowIntensity = parseFloat(e.target.value); })} className="w-full" />
                  <span className="text-[11px] text-text-muted">{config.reveal.threeD.glowIntensity.toFixed(1)}x</span>
                </div>
              </>
            )}
          </div>
        )}
        <button onClick={onReplay} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[10px] border hairline text-[13px] font-semibold text-text-muted hover:text-text-primary mt-3"><Play className="w-4 h-4" /> Play reveal</button>
      </Section>

      <div className="pt-2 border-t hairline">
        <button onClick={onReset} className="text-[12px] font-semibold text-text-faint hover:text-danger">
          Reset to {brandKey === "faitlynhair" ? "Faitlyn" : "Pixie"} defaults
        </button>
      </div>
    </div>
  );
}

function GalleryEditor({ config, update }: { config: LandingConfig; update: (m: (d: LandingConfig) => void) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function add(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const url = await uploadLandingImage(file);
      update((d) => { d.gallery.push({ url }); });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {config.gallery.map((g, i) => (
          <div key={i} className="relative aspect-[4/5] rounded-[8px] overflow-hidden border hairline group">
            <img src={g.url} alt="" className="w-full h-full object-cover" />
            <button onClick={() => update((d) => { d.gallery.splice(i, 1); })} className="absolute top-1 right-1 w-6 h-6 grid place-items-center rounded-full bg-bg/80 text-text-muted hover:text-danger opacity-0 group-hover:opacity-100">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button onClick={() => fileRef.current?.click()} disabled={busy} className="aspect-[4/5] rounded-[8px] border border-dashed hairline grid place-items-center text-text-faint hover:text-accent-glow hover:border-accent/40">
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImageUp className="w-5 h-5" />}
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => add(e.target.files?.[0])} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Campaign content editor panels
// ════════════════════════════════════════════════════════════

function CampaignEditor({
  campaign,
  updateCampaign,
  updateBlock,
}: {
  campaign: CampaignLanding;
  updateCampaign: (m: (d: CampaignLanding) => void) => void;
  updateBlock: (key: string, fn: (p: Record<string, unknown>) => Record<string, unknown>) => void;
}) {
  const extras = campaign.landing_extras || {};
  const blocks = campaign.landing_blocks || [];

  // ── Hero ────────────────────────────────────────────────
  return (
    <div className="space-y-2.5">
      <Section title="Campaign: Hero" defaultOpen>
        <Text
          label='"Live now" pill text'
          value={extras.live_now_pill || ""}
          onChange={(v) => updateCampaign((d) => { d.landing_extras = { ...d.landing_extras, live_now_pill: v }; })}
        />
        <Img
          label="Hero image"
          value={campaign.landing_hero_image_url}
          onChange={(v) => updateCampaign((d) => { d.landing_hero_image_url = v; })}
        />
        <Text
          label="Hero title"
          value={campaign.landing_hero_title || ""}
          onChange={(v) => updateCampaign((d) => { d.landing_hero_title = v; })}
        />
        <Area
          label="Hero subtitle"
          value={campaign.landing_hero_subtitle || ""}
          onChange={(v) => updateCampaign((d) => { d.landing_hero_subtitle = v; })}
        />
        <Text
          label="Primary CTA text"
          value={campaign.landing_cta_text || ""}
          onChange={(v) => updateCampaign((d) => { d.landing_cta_text = v; })}
        />
        <Text
          label="Secondary CTA text"
          value={extras.browse_cta_text || ""}
          onChange={(v) => updateCampaign((d) => { d.landing_extras = { ...d.landing_extras, browse_cta_text: v }; })}
        />
        <Range
          label={`Hero overlay ${Math.round((extras.hero_overlay_opacity ?? 0.35) * 100)}%`}
          value={extras.hero_overlay_opacity ?? 0.35}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => updateCampaign((d) => { d.landing_extras = { ...d.landing_extras, hero_overlay_opacity: v }; })}
        />
        <Range
          label={`Brand watermark ${Math.round((extras.watermark_opacity ?? 0) * 100)}%`}
          value={extras.watermark_opacity ?? 0}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => updateCampaign((d) => { d.landing_extras = { ...d.landing_extras, watermark_opacity: v }; })}
        />
      </Section>

      {/* ── Countdown ──────────────────────────────────────── */}
      <Section title="Campaign: Countdown">
        <Text
          label="Countdown closes label"
          value={extras.countdown_closes_label || ""}
          onChange={(v) => updateCampaign((d) => { d.landing_extras = { ...d.landing_extras, countdown_closes_label: v }; })}
        />
        <Text
          label="Countdown message"
          value={campaign.countdown_message || ""}
          onChange={(v) => updateCampaign((d) => { d.countdown_message = v; })}
        />
        <p className="text-[11px] text-text-faint">Shown beneath the countdown timer. Leave blank for default "Doors open in" / "Time remaining".</p>
      </Section>

      {/* ── Featured Products ───────────────────────────────── */}
      <Section title="Campaign: Featured Products">
        {(() => {
          const p = getBlockProps(blocks, "featured_products");
          return (
            <>
              <Text
                label="Eyebrow"
                value={(p.eyebrow as string) || ""}
                onChange={(v) => updateBlock("featured_products", (pp) => ({ ...pp, eyebrow: v }))}
              />
              <Text
                label="Section title"
                value={(p.title as string) || ""}
                onChange={(v) => updateBlock("featured_products", (pp) => ({ ...pp, title: v }))}
              />
              <Area
                label="Intro text"
                value={(p.intro as string) || ""}
                onChange={(v) => updateBlock("featured_products", (pp) => ({ ...pp, intro: v }))}
              />
            </>
          );
        })()}
      </Section>

      {/* ── Bundle Showcase ──────────────────────────────────── */}
      <Section title="Campaign: Bundle Showcase">
        {(() => {
          const p = getBlockProps(blocks, "bundle_showcase");
          return (
            <>
              <Text
                label="Section title"
                value={(p.title as string) || ""}
                onChange={(v) => updateBlock("bundle_showcase", (pp) => ({ ...pp, title: v }))}
              />
              <Area
                label="Intro text"
                value={(p.intro as string) || ""}
                onChange={(v) => updateBlock("bundle_showcase", (pp) => ({ ...pp, intro: v }))}
              />
            </>
          );
        })()}
        <p className="text-[11px] text-text-faint">Bundle products are managed in the Bundles tab of the campaign builder.</p>
      </Section>

      {/* ── Lookbook ─────────────────────────────────────────── */}
      <Section title="Campaign: Lookbook">
        {(() => {
          const p = getBlockProps(blocks, "lookbook_carousel");
          const images = (p.images as string[]) || [];
          return (
            <>
              <Text
                label="Eyebrow"
                value={(p.eyebrow as string) || ""}
                onChange={(v) => updateBlock("lookbook_carousel", (pp) => ({ ...pp, eyebrow: v }))}
              />
              <Text
                label="Section title"
                value={(p.title as string) || ""}
                onChange={(v) => updateBlock("lookbook_carousel", (pp) => ({ ...pp, title: v }))}
              />
              <LookbookImagesEditor
                images={images}
                onChange={(imgs) => updateBlock("lookbook_carousel", (pp) => ({ ...pp, images: imgs }))}
              />
            </>
          );
        })()}
      </Section>

      {/* ── Brand Story ──────────────────────────────────────── */}
      <Section title="Campaign: Brand Story">
        {(() => {
          const p = getBlockProps(blocks, "brand_story");
          return (
            <>
              <Text
                label="Eyebrow"
                value={(p.eyebrow as string) || ""}
                onChange={(v) => updateBlock("brand_story", (pp) => ({ ...pp, eyebrow: v }))}
              />
              <Text
                label="Title"
                value={(p.title as string) || ""}
                onChange={(v) => updateBlock("brand_story", (pp) => ({ ...pp, title: v }))}
              />
              <Area
                label="Body"
                value={(p.body as string) || ""}
                onChange={(v) => updateBlock("brand_story", (pp) => ({ ...pp, body: v }))}
              />
              <Img
                label="Story image (optional)"
                value={(p.image_url as string | null) || null}
                onChange={(v) => updateBlock("brand_story", (pp) => ({ ...pp, image_url: v }))}
              />
            </>
          );
        })()}
      </Section>

      {/* ── Founder Quotes ───────────────────────────────────── */}
      <Section title="Campaign: Founder Quotes">
        <FounderQuotesEditor
          blocks={blocks}
          updateBlock={updateBlock}
        />
        <p className="text-[11px] text-text-faint">Quotes drop between product showcases on the live page.</p>
      </Section>

      {/* ── Why This Drop ────────────────────────────────────── */}
      <Section title="Campaign: Why This Drop">
        {(() => {
          const p = getBlockProps(blocks, "why_buy");
          const items = (p.items as Array<{ title: string; body: string }>) || [
            { title: "Real human hair, every strand", body: "Sourced and inspected by us — never substituted." },
            { title: "Stylist-tested fit", body: "Cap construction tested on hundreds of head shapes." },
            { title: "Wear-it-forever care", body: "Detailed care guide in every box; replace nothing." },
          ];
          return (
            <>
              <Text
                label="Section title"
                value={(p.section_title as string) || ""}
                onChange={(v) => updateBlock("why_buy", (pp) => ({ ...pp, section_title: v }))}
              />
              {items.map((item, i) => (
                <div key={i} className="rounded-[10px] border hairline p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-text-faint">Pillar {i + 1}</span>
                    {items.length > 1 && (
                      <button
                        onClick={() => {
                          const next = items.filter((_, j) => j !== i);
                          updateBlock("why_buy", (pp) => ({ ...pp, items: next }));
                        }}
                        className="text-text-faint hover:text-danger"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <input
                    value={item.title}
                    onChange={(e) => {
                      const next = items.map((it, j) => j === i ? { ...it, title: e.target.value } : it);
                      updateBlock("why_buy", (pp) => ({ ...pp, items: next }));
                    }}
                    className="input-sm w-full"
                    placeholder="Pillar title"
                  />
                  <textarea
                    value={item.body}
                    onChange={(e) => {
                      const next = items.map((it, j) => j === i ? { ...it, body: e.target.value } : it);
                      updateBlock("why_buy", (pp) => ({ ...pp, items: next }));
                    }}
                    rows={2}
                    className="input-sm w-full"
                    placeholder="Description"
                  />
                </div>
              ))}
              <button
                onClick={() => {
                  const next = [...items, { title: "", body: "" }];
                  updateBlock("why_buy", (pp) => ({ ...pp, items: next }));
                }}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-accent-glow"
              >
                <Plus className="w-3.5 h-3.5" /> Add pillar
              </button>
            </>
          );
        })()}
      </Section>

      {/* ── Trust Badges ─────────────────────────────────────── */}
      <Section title="Campaign: Trust Badges">
        {(() => {
          const p = getBlockProps(blocks, "shipping_returns");
          const cards = (p.cards as Array<{ title: string; subtitle: string }>) || [
            { title: "DHL worldwide", subtitle: "Tracked, insured." },
            { title: "Hand-inspected", subtitle: "Every unit, every time." },
            { title: "48-hour grace", subtitle: "Reach us in two days; we'll work it out." },
          ];
          return (
            <>
              {cards.map((card, i) => (
                <div key={i} className="rounded-[10px] border hairline p-2.5 space-y-1.5">
                  <span className="text-[11px] font-semibold text-text-faint">Badge {i + 1}</span>
                  <input
                    value={card.title}
                    onChange={(e) => {
                      const next = cards.map((c, j) => j === i ? { ...c, title: e.target.value } : c);
                      updateBlock("shipping_returns", (pp) => ({ ...pp, cards: next }));
                    }}
                    className="input-sm w-full"
                    placeholder="Title"
                  />
                  <input
                    value={card.subtitle}
                    onChange={(e) => {
                      const next = cards.map((c, j) => j === i ? { ...c, subtitle: e.target.value } : c);
                      updateBlock("shipping_returns", (pp) => ({ ...pp, cards: next }));
                    }}
                    className="input-sm w-full"
                    placeholder="Subtitle"
                  />
                </div>
              ))}
            </>
          );
        })()}
      </Section>

      {/* ── FAQ ──────────────────────────────────────────────── */}
      <Section title="Campaign: FAQ">
        {(() => {
          const p = getBlockProps(blocks, "faq");
          const items = (p.items as Array<{ q: string; a: string }>) || [
            { q: "When does the sale end?", a: "When the timer hits zero — that is the only rule." },
            { q: "Do you ship internationally?", a: "Yes. We use DHL for international delivery." },
            { q: "Are these real human hair?", a: "Yes. Every strand. We inspect each unit before shipping." },
          ];
          return (
            <>
              {items.map((item, i) => (
                <div key={i} className="rounded-[10px] border hairline p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-text-faint">Q{i + 1}</span>
                    {items.length > 1 && (
                      <button
                        onClick={() => {
                          const next = items.filter((_, j) => j !== i);
                          updateBlock("faq", (pp) => ({ ...pp, items: next }));
                        }}
                        className="text-text-faint hover:text-danger"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <input
                    value={item.q}
                    onChange={(e) => {
                      const next = items.map((it, j) => j === i ? { ...it, q: e.target.value } : it);
                      updateBlock("faq", (pp) => ({ ...pp, items: next }));
                    }}
                    className="input-sm w-full"
                    placeholder="Question"
                  />
                  <textarea
                    value={item.a}
                    onChange={(e) => {
                      const next = items.map((it, j) => j === i ? { ...it, a: e.target.value } : it);
                      updateBlock("faq", (pp) => ({ ...pp, items: next }));
                    }}
                    rows={2}
                    className="input-sm w-full"
                    placeholder="Answer"
                  />
                </div>
              ))}
              <button
                onClick={() => {
                  const next = [...items, { q: "", a: "" }];
                  updateBlock("faq", (pp) => ({ ...pp, items: next }));
                }}
                className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-accent-glow"
              >
                <Plus className="w-3.5 h-3.5" /> Add FAQ item
              </button>
            </>
          );
        })()}
      </Section>

      {/* ── Ended state ──────────────────────────────────────── */}
      <Section title="Campaign: Ended state">
        <Area
          label="Farewell message"
          value={campaign.ended_message || ""}
          onChange={(v) => updateCampaign((d) => { d.ended_message = v; })}
        />
        <Text
          label="Redirect URL"
          value={campaign.ended_redirect_to || ""}
          onChange={(v) => updateCampaign((d) => { d.ended_redirect_to = v; })}
        />
        <p className="text-[11px] text-text-faint">Shown after the sale ends. The redirect URL sends visitors to your main storefront.</p>
      </Section>

      {/* ── Campaign SEO ─────────────────────────────────────── */}
      <Section title="Campaign: SEO & discovery">
        <Text
          label="Browser tab / meta title"
          value={campaign.meta_title || ""}
          onChange={(v) => updateCampaign((d) => { d.meta_title = v; })}
        />
        <Text
          label="Browser tab name"
          value={extras.browser_tab_name || ""}
          onChange={(v) => updateCampaign((d) => { d.landing_extras = { ...d.landing_extras, browser_tab_name: v }; })}
        />
        <Area
          label="Meta description"
          value={campaign.meta_description || ""}
          onChange={(v) => updateCampaign((d) => { d.meta_description = v; })}
        />
        <OgImageField
          value={campaign.og_image_url}
          onChange={(v) => updateCampaign((d) => { d.og_image_url = v; })}
        />
        <Img
          label="Favicon (square logo)"
          value={extras.favicon_url || null}
          onChange={(v) => updateCampaign((d) => { d.landing_extras = { ...d.landing_extras, favicon_url: v }; })}
        />
        <p className="text-[11px] text-text-faint">These override the brand defaults for this specific campaign page.</p>
      </Section>
    </div>
  );
}

function LookbookImagesEditor({
  images,
  onChange,
}: {
  images: string[];
  onChange: (imgs: string[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function add(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const url = await uploadLandingImage(file);
      onChange([...images, url]);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  return (
    <div className="space-y-2">
      <span className="micro block">Lookbook images</span>
      <div className="grid grid-cols-3 gap-2">
        {images.map((url, i) => (
          <div key={i} className="relative aspect-[3/4] rounded-[8px] overflow-hidden border hairline group">
            <img src={url} alt="" className="w-full h-full object-cover" />
            <button
              onClick={() => onChange(images.filter((_, j) => j !== i))}
              className="absolute top-1 right-1 w-6 h-6 grid place-items-center rounded-full bg-bg/80 text-text-muted hover:text-danger opacity-0 group-hover:opacity-100"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="aspect-[3/4] rounded-[8px] border border-dashed hairline grid place-items-center text-text-faint hover:text-accent-glow hover:border-accent/40"
        >
          {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImageUp className="w-5 h-5" />}
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => add(e.target.files?.[0])} />
    </div>
  );
}

function FounderQuotesEditor({
  blocks,
  updateBlock,
}: {
  blocks: LandingBlock[];
  updateBlock: (key: string, fn: (p: Record<string, unknown>) => Record<string, unknown>) => void;
}) {
  const p = getBlockProps(blocks, "founder_quote");
  const quotes = (p.quotes as Array<{ quote: string; author: string }>) ||
    (p.quote ? [{ quote: p.quote as string, author: (p.author as string) || "Faith — founder" }] : [
      { quote: "I built this because nothing on shelves felt like me. Every bundle in this drop is one I'd wear myself.", author: "Faith — founder" },
    ]);

  return (
    <div className="space-y-2.5">
      {quotes.map((q, i) => (
        <div key={i} className="rounded-[10px] border hairline p-2.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-text-faint">Quote {i + 1}</span>
            {quotes.length > 1 && (
              <button
                onClick={() => {
                  const next = quotes.filter((_, j) => j !== i);
                  updateBlock("founder_quote", (pp) => ({ ...pp, quotes: next }));
                }}
                className="text-text-faint hover:text-danger"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <textarea
            value={q.quote}
            onChange={(e) => {
              const next = quotes.map((qt, j) => j === i ? { ...qt, quote: e.target.value } : qt);
              updateBlock("founder_quote", (pp) => ({ ...pp, quotes: next }));
            }}
            rows={3}
            className="input-sm w-full"
            placeholder="The quote…"
          />
          <input
            value={q.author}
            onChange={(e) => {
              const next = quotes.map((qt, j) => j === i ? { ...qt, author: e.target.value } : qt);
              updateBlock("founder_quote", (pp) => ({ ...pp, quotes: next }));
            }}
            className="input-sm w-full"
            placeholder="Attribution — e.g. Faith, founder"
          />
        </div>
      ))}
      <button
        onClick={() => {
          const next = [...quotes, { quote: "", author: "" }];
          updateBlock("founder_quote", (pp) => ({ ...pp, quotes: next }));
        }}
        className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-accent-glow"
      >
        <Plus className="w-3.5 h-3.5" /> Add quote
      </button>
    </div>
  );
}

// ── Field primitives ─────────────────────────────────────────

function Section({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-[12px] border hairline overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-3 h-10 text-[13px] font-semibold hover:bg-text-primary/[0.03]">
        <span>{title}</span>
        <span className="text-text-faint">{open ? "–" : "+"}</span>
      </button>
      {open && <div className="px-3 pb-3 space-y-2.5">{children}</div>}
    </div>
  );
}

function Text({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="micro block mb-1">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="input-sm w-full" />
    </label>
  );
}

function Area({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="micro block mb-1">{label}</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className="input-sm w-full" />
    </label>
  );
}

function Num({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="micro block mb-1">{label}</span>
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} className="input-sm w-full tabular-nums" />
    </label>
  );
}

function Range({ label, value, min, max, step = 0.05, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="micro block mb-1">{label}</span>
      <input type="range" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[rgb(var(--accent))]" />
    </label>
  );
}

// ── Typography primitives ────────────────────────────────────

const ROLE_LABEL: Record<TypographyRole, string> = {
  heading: "Headings",
  body: "Body",
  eyebrow: "Eyebrows",
  numerals: "Numerals",
};

function FontPicker({
  label,
  value,
  kind,
  onChange,
}: {
  label: string;
  value: FontSelection;
  kind: "serif" | "sans";
  onChange: (v: FontSelection) => void;
}) {
  const isCustom = value.source === "custom";
  return (
    <div>
      <span className="micro block mb-1">{label}</span>
      <select
        value={isCustom ? "__custom__" : value.family}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "__custom__") {
            onChange({ family: isCustom ? value.family : "", source: "custom", cssUrl: value.cssUrl ?? "" });
          } else {
            onChange({ family: v, source: "curated", cssUrl: null });
          }
        }}
        className="input-sm w-full"
        style={!isCustom && value.family ? { fontFamily: `"${value.family}"` } : undefined}
      >
        {(kind === "serif" ? ["serif", "sans"] : ["sans", "serif"]).map((k) => {
          const base = k === "serif" ? "Serif / display" : "Sans / mono";
          return (
            <optgroup key={k} label={k === kind ? `${base} (recommended)` : base}>
              {CURATED_FONTS.filter((f) => (k === "serif" ? f.kind === "serif" : f.kind !== "serif")).map((f) => (
                <option key={f.family} value={f.family}>{f.family}</option>
              ))}
            </optgroup>
          );
        })}
        <option value="__custom__">Custom (Google Fonts)…</option>
      </select>
      {isCustom && (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="micro">Google Fonts link</span>
            <Info
              text={[
                "Add any Google Font:",
                "1. Open fonts.google.com",
                "2. Pick a font → 'Get font' → 'Get embed code'",
                "3. Copy the link href that starts with",
                "   https://fonts.googleapis.com/css2?family=…",
                "4. Paste it below — we detect the name automatically.",
              ].join("\n")}
            />
          </div>
          <input
            value={value.cssUrl ?? ""}
            placeholder="https://fonts.googleapis.com/css2?family=…"
            onChange={(e) => {
              const url = e.target.value;
              onChange({ family: googleFamilyFromUrl(url) || value.family, source: "custom", cssUrl: url });
            }}
            className="input-sm w-full font-mono text-[11px]"
          />
          {value.family ? (
            <p className="text-[11px] text-text-faint">
              Detected: <span className="font-semibold">{value.family}</span>
            </p>
          ) : (
            <p className="text-[11px] text-text-faint">Paste a Google Fonts link to load a custom face.</p>
          )}
        </div>
      )}
    </div>
  );
}

function Info({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        className="w-4 h-4 grid place-items-center rounded-full border border-line text-[10px] font-semibold text-text-faint hover:text-accent-glow"
        aria-label="How to get a Google Fonts link"
      >
        i
      </button>
      {open && (
        <span className="absolute right-0 top-5 z-20 w-64 rounded-[10px] border hairline bg-panel p-3 text-[11px] leading-relaxed text-text-muted whitespace-pre-line shadow-lg">
          {text}
        </span>
      )}
    </span>
  );
}

function RoleEditor({
  role,
  value,
  onChange,
}: {
  role: TypographyRole;
  value: { weight: number; letterSpacing: number; lineHeight: number };
  onChange: (patch: Partial<{ weight: number; letterSpacing: number; lineHeight: number }>) => void;
}) {
  return (
    <div className="rounded-[10px] border hairline p-2.5 space-y-2">
      <div className="text-[12px] font-semibold">{ROLE_LABEL[role]}</div>
      <label className="block">
        <span className="micro block mb-1">Weight {value.weight}</span>
        <input type="range" min={300} max={800} step={100} value={value.weight} onChange={(e) => onChange({ weight: Number(e.target.value) })} className="w-full accent-[rgb(var(--accent))]" />
      </label>
      <label className="block">
        <span className="micro block mb-1">Letter spacing {value.letterSpacing.toFixed(2)}em</span>
        <input type="range" min={-0.05} max={0.5} step={0.01} value={value.letterSpacing} onChange={(e) => onChange({ letterSpacing: Number(e.target.value) })} className="w-full accent-[rgb(var(--accent))]" />
      </label>
      <label className="block">
        <span className="micro block mb-1">Line height {value.lineHeight.toFixed(2)}</span>
        <input type="range" min={0.9} max={2} step={0.05} value={value.lineHeight} onChange={(e) => onChange({ lineHeight: Number(e.target.value) })} className="w-full accent-[rgb(var(--accent))]" />
      </label>
    </div>
  );
}

function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="micro block mb-1">{label}</span>
      <div className="flex items-center gap-1.5">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="w-8 h-8 rounded-[8px] border hairline bg-transparent cursor-pointer" />
        <input value={value} onChange={(e) => onChange(e.target.value)} className="input-sm flex-1 font-mono uppercase" />
      </div>
    </label>
  );
}

function Tint({ label, value, suggest, onChange }: { label: string; value: string | null; suggest: string; onChange: (v: string | null) => void }) {
  const on = value !== null;
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="micro">{label}</span>
        <button
          type="button"
          onClick={() => onChange(on ? null : suggest)}
          className={`text-[11px] font-semibold ${on ? "text-accent-glow" : "text-text-faint"}`}
        >
          {on ? "Recolouring" : "Original colours"}
        </button>
      </div>
      {on && (
        <div className="flex items-center gap-1.5 mt-1">
          <input type="color" value={value || suggest} onChange={(e) => onChange(e.target.value)} className="w-8 h-8 rounded-[8px] border hairline bg-transparent cursor-pointer" />
          <input value={value || ""} onChange={(e) => onChange(e.target.value || null)} className="input-sm flex-1 font-mono uppercase" />
        </div>
      )}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="w-full flex items-center justify-between py-1">
      <span className="text-[13px] text-text-muted">{label}</span>
      <span className={`relative w-9 h-5 rounded-full transition-colors ${checked ? "bg-accent" : "bg-text-primary/15"}`}>
        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

function Img({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function pick(file?: File) {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      onChange(await uploadLandingImage(file));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  return (
    <div>
      <span className="micro block mb-1">{label}</span>
      <div className="flex items-start gap-2">
        <div className="relative shrink-0 w-[60px] h-[60px] rounded-[8px] border hairline overflow-hidden bg-text-primary/[0.04] grid place-items-center">
          {value ? <img src={value} alt="" className="w-full h-full object-contain" /> : <ImageUp className="w-4 h-4 text-text-faint" />}
          {busy && <div className="absolute inset-0 grid place-items-center bg-bg/60"><Loader2 className="w-4 h-4 animate-spin text-accent-glow" /></div>}
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex gap-1.5">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-[9px] border hairline text-[12px] font-semibold text-text-muted hover:text-text-primary disabled:opacity-50">
              <Upload className="w-3.5 h-3.5" /> Upload
            </button>
            {value && <button type="button" onClick={() => onChange(null)} className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-[9px] border hairline text-[12px] font-semibold text-text-faint hover:text-danger"><Trash2 className="w-3.5 h-3.5" /></button>}
          </div>
          <input type="url" value={value ?? ""} placeholder="…or paste a URL" onChange={(e) => onChange(e.target.value || null)} className="input-sm w-full" />
          {err && <p className="text-[11px] text-danger">{err}</p>}
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
    </div>
  );
}

function OgImageField({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function pick(file?: File) {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      onChange(await uploadLandingOgBanner(file));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't build the share image");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  return (
    <div>
      <span className="micro block mb-1">Share image (Open Graph)</span>
      <div className="relative rounded-[10px] border hairline overflow-hidden bg-text-primary/[0.04] grid place-items-center" style={{ aspectRatio: "1200 / 630" }}>
        {value ? (
          <img src={value} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-[11px] text-text-faint px-3 text-center">1200×630 — auto-built from any image you upload</span>
        )}
        {busy && <div className="absolute inset-0 grid place-items-center bg-bg/60"><Loader2 className="w-5 h-5 animate-spin text-accent-glow" /></div>}
      </div>
      <div className="flex gap-1.5 mt-2">
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-[9px] border hairline text-[12px] font-semibold text-text-muted hover:text-text-primary disabled:opacity-50">
          <Upload className="w-3.5 h-3.5" /> {value ? "Replace" : "Upload & build"}
        </button>
        {value && (
          <button type="button" onClick={() => onChange(null)} className="inline-flex items-center gap-1.5 px-2.5 h-8 rounded-[9px] border hairline text-[12px] font-semibold text-text-faint hover:text-danger">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <p className="text-[11px] text-text-faint mt-1">Upload a portrait, square or landscape — we crop it to a 1200×630 share banner.</p>
      {err && <p className="text-[11px] text-danger mt-1">{err}</p>}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
    </div>
  );
}
