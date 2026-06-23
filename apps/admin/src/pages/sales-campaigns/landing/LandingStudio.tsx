/**
 * LandingStudio — full-screen landing-page editor with a live preview.
 *
 * Covers the whole viewport (Esc or the X closes it). On desktop it's a split
 * view: controls on the left, a true-to-life preview on the right. On mobile a
 * segmented control flips between Edit and Preview. Hero + look-book images can
 * be uploaded directly (no "go to Catalogue" detour).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Eye,
  ImagePlus,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { Field } from "@/components/ui/Form";
import { cn } from "@/lib/cn";
import {
  type Campaign,
  type LandingBlock,
  type PublicState,
  uploadCampaignImage,
  useUpdateCampaign,
} from "@/lib/campaigns";
import { useLandingStudio, withDefaults } from "@/lib/landing-studio";
import { LandingRender, type LandingModel } from "./LandingRender";

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
    description: "Buy more, save more",
  },
  {
    key: "featured_products",
    label: "Featured Products",
    description: "Individually styled pieces",
  },
  {
    key: "lookbook_carousel",
    label: "Look Book",
    description: "Reels-style scroll",
  },
  { key: "brand_story", label: "Brand Story", description: "Why this drop" },
  {
    key: "founder_quote",
    label: "Founder Quote",
    description: "Trust + intent",
  },
  { key: "why_buy", label: "Why Buy", description: "3 value props" },
  {
    key: "testimonials",
    label: "Testimonials",
    description: "Real customer quotes",
  },
  { key: "faq", label: "FAQ", description: "Pre-empt friction" },
  {
    key: "shipping_returns",
    label: "Shipping & Returns",
    description: "DHL + policy",
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
const LIBRARY_LABEL = Object.fromEntries(BLOCK_LIBRARY.map((b) => [b.key, b]));
const EDITABLE_BLOCKS = new Set([
  "brand_story",
  "founder_quote",
  "why_buy",
  "testimonials",
  "faq",
  "shipping_returns",
  "newsletter_capture",
  "vip_signup",
  "bundle_showcase",
  "quantity_tier_visualiser",
]);
const LOOKBOOK_KEY = "lookbook_carousel";

function defaultBlocks(): LandingBlock[] {
  return [
    { key: "hero", enabled: true },
    { key: "countdown", enabled: true },
    { key: "bundle_showcase", enabled: true },
    { key: "featured_products", enabled: true },
    { key: "lookbook_carousel", enabled: true },
    { key: "faq", enabled: true },
  ];
}

export function LandingStudio({
  open,
  onClose,
  campaign,
  canEdit,
}: {
  open: boolean;
  onClose: () => void;
  campaign: Campaign;
  canEdit: boolean;
}) {
  const update = useUpdateCampaign(campaign.campaign_id);
  const studioQ = useLandingStudio();
  const brandConfig = studioQ.data?.published_config
    ? withDefaults(studioQ.data.business_key, studioQ.data.published_config)
    : null;

  const [heroTitle, setHeroTitle] = useState(campaign.landing_hero_title || "");
  const [heroSubtitle, setHeroSubtitle] = useState(
    campaign.landing_hero_subtitle || "",
  );
  const [heroImage, setHeroImage] = useState(
    campaign.landing_hero_image_url || "",
  );
  const [ctaText, setCtaText] = useState(
    campaign.landing_cta_text || "Shop the drop",
  );
  const [countdownMsg, setCountdownMsg] = useState(
    campaign.countdown_message || "",
  );
  const [endedMsg, setEndedMsg] = useState(campaign.ended_message || "");
  const [endedRedirect, setEndedRedirect] = useState(
    campaign.ended_redirect_to || "",
  );
  const [blocks, setBlocks] = useState<LandingBlock[]>(
    campaign.landing_blocks?.length ? campaign.landing_blocks : defaultBlocks(),
  );

  const [expandedBlock, setExpandedBlock] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PublicState>("live");
  const [mobileTab, setMobileTab] = useState<"edit" | "preview">("edit");
  const [uploading, setUploading] = useState<"hero" | "look" | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);

  const heroFileRef = useRef<HTMLInputElement>(null);
  const lookFileRef = useRef<HTMLInputElement>(null);

  // Esc to close; lock background scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const gallery = useMemo(() => {
    const lb = blocks.find((b) => b.key === LOOKBOOK_KEY);
    const imgs = (lb?.props?.images as string[] | undefined) || [];
    return Array.isArray(imgs) ? imgs : [];
  }, [blocks]);

  function markDirty(next: LandingBlock[]) {
    setBlocks(next);
    setDirty(true);
  }
  function touch<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setDirty(true);
    };
  }

  function setGallery(images: string[]) {
    const exists = blocks.some((b) => b.key === LOOKBOOK_KEY);
    const next = exists
      ? blocks.map((b) =>
          b.key === LOOKBOOK_KEY
            ? { ...b, enabled: true, props: { ...(b.props || {}), images } }
            : b,
        )
      : [...blocks, { key: LOOKBOOK_KEY, enabled: true, props: { images } }];
    markDirty(next);
  }

  async function onHeroFile(file: File) {
    setUploading("hero");
    setError(null);
    try {
      const url = await uploadCampaignImage(campaign.campaign_id, file);
      setHeroImage(url);
      setDirty(true);
    } catch (e) {
      setError(
        (e as Error)?.message ||
          "Image upload failed. Try a smaller JPG or PNG.",
      );
    } finally {
      setUploading(null);
    }
  }
  async function onLookFiles(files: FileList) {
    setUploading("look");
    setError(null);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files).slice(0, 8)) {
        urls.push(await uploadCampaignImage(campaign.campaign_id, f));
      }
      setGallery([...gallery, ...urls].slice(0, 12));
    } catch (e) {
      setError(
        (e as Error)?.message ||
          "Image upload failed. Try a smaller JPG or PNG.",
      );
    } finally {
      setUploading(null);
    }
  }

  function toggleBlock(key: string) {
    if (blocks.some((b) => b.key === key)) {
      markDirty(blocks.filter((b) => b.key !== key));
    } else {
      markDirty([...blocks, { key, enabled: true }]);
    }
  }
  function moveBlock(idx: number, dir: -1 | 1) {
    const next = [...blocks];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    markDirty(next);
  }

  function updateBlock(idx: number, updated: LandingBlock) {
    markDirty(blocks.map((b, i) => (i === idx ? updated : b)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await update.mutateAsync({
        landing_hero_title: heroTitle || null,
        landing_hero_subtitle: heroSubtitle || null,
        landing_hero_image_url: heroImage || null,
        landing_cta_text: ctaText || null,
        landing_blocks: blocks,
        countdown_message: countdownMsg || null,
        ended_message: endedMsg || null,
        ended_redirect_to: endedRedirect || null,
      });
      setSavedAt(Date.now());
      setDirty(false);
    } catch (e) {
      setError(
        (e as Error)?.message ||
          "Couldn't save the landing page. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  const model: LandingModel = {
    slug: campaign.slug,
    name: campaign.name,
    state: previewState,
    hero: {
      title: heroTitle,
      subtitle: heroSubtitle,
      image_url: heroImage,
      cta_text: ctaText,
    },
    countdown_to:
      previewState === "before"
        ? campaign.starts_at
        : previewState === "live"
          ? campaign.ends_at
          : null,
    countdown_message: countdownMsg,
    ngn_per_usd_rate: campaign.ngn_per_usd_rate ?? null,
    discount_type: campaign.discount_type ?? null,
    discount_value: campaign.discount_value ?? null,
    position_ladder: campaign.position_ladder ?? null,
    blocks,
    products: [],
    ended:
      previewState === "ended"
        ? { message: endedMsg, redirect_to: endedRedirect }
        : null,
    gallery,
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] bg-bg flex flex-col">
      {/* Header */}
      <div className="h-14 shrink-0 flex items-center gap-3 px-4 border-b border-line bg-panel/60 backdrop-blur">
        <div className="flex items-center gap-2 min-w-0">
          <Pencil className="w-4 h-4 text-accent-glow" />
          <span className="font-display text-[16px] truncate">
            Landing Studio
          </span>
          <span className="text-text-faint text-[12px] truncate hidden sm:block">
            · {campaign.name}
          </span>
        </div>

        {/* Preview-state toggle */}
        <div className="ml-auto hidden md:flex items-center gap-1 rounded-full bg-text-primary/[0.05] p-1">
          {(["before", "live", "ended"] as PublicState[]).map((s) => (
            <button
              key={s}
              onClick={() => setPreviewState(s)}
              className={cn(
                "px-3 py-1.5 rounded-full text-[12px] font-semibold capitalize transition-colors",
                previewState === s
                  ? "bg-accent-deep text-[#F4E9D9]"
                  : "text-text-muted hover:text-text-primary",
              )}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto md:ml-3">
          {dirty ? (
            <span className="text-[12px] text-text-faint hidden sm:block">
              Unsaved
            </span>
          ) : savedAt ? (
            <span className="text-[12px] text-success font-semibold hidden sm:inline-flex items-center gap-1">
              <Check className="w-3.5 h-3.5" /> Saved
            </span>
          ) : null}
          {canEdit && (
            <Button
              variant="primary"
              onClick={save}
              disabled={saving || !dirty}
              icon={
                saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )
              }
            >
              {saving ? "Saving…" : "Save"}
            </Button>
          )}
          <button
            onClick={onClose}
            aria-label="Close studio"
            className="w-9 h-9 grid place-items-center rounded-[10px] hover:bg-text-primary/[0.08] text-text-muted hover:text-text-primary"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Mobile tab switch */}
      <div className="md:hidden flex shrink-0 border-b border-line">
        {(["edit", "preview"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setMobileTab(t)}
            className={cn(
              "flex-1 py-2.5 text-[13px] font-semibold capitalize inline-flex items-center justify-center gap-1.5",
              mobileTab === t
                ? "text-accent-glow border-b-2 border-accent"
                : "text-text-muted",
            )}
          >
            {t === "edit" ? (
              <Pencil className="w-3.5 h-3.5" />
            ) : (
              <Eye className="w-3.5 h-3.5" />
            )}
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 flex">
        {/* Editor */}
        <div
          className={cn(
            "w-full md:w-[420px] md:shrink-0 md:border-r border-line overflow-y-auto",
            mobileTab === "edit" ? "block" : "hidden md:block",
          )}
        >
          <div className="p-5 space-y-6">
            {error && (
              <div className="rounded-[12px] border border-danger/40 bg-danger/[0.08] px-4 py-3 text-[13px] text-danger">
                {error}
              </div>
            )}

            {/* Hero */}
            <section className="space-y-3">
              <h3 className="micro">Hero</h3>
              <Field label="Title">
                <input
                  value={heroTitle}
                  onChange={(e) => touch(setHeroTitle)(e.target.value)}
                  disabled={!canEdit}
                  placeholder={`The next ${campaign.name} begins now`}
                  className={inputCls}
                />
              </Field>
              <Field label="Subtitle">
                <input
                  value={heroSubtitle}
                  onChange={(e) => touch(setHeroSubtitle)(e.target.value)}
                  disabled={!canEdit}
                  placeholder="A restrained line that holds the room."
                  className={inputCls}
                />
              </Field>
              <Field label="Hero / background image">
                <div className="flex items-center gap-3">
                  <div
                    className="w-16 h-16 rounded-[12px] border border-line bg-text-primary/[0.05] grid place-items-center overflow-hidden shrink-0"
                    style={
                      heroImage
                        ? {
                            backgroundImage: `url("${heroImage}")`,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                          }
                        : undefined
                    }
                  >
                    {!heroImage && (
                      <ImagePlus className="w-5 h-5 text-text-faint" />
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => heroFileRef.current?.click()}
                      disabled={!canEdit || uploading === "hero"}
                      className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-accent-glow disabled:opacity-50"
                    >
                      {uploading === "hero" ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Upload className="w-3.5 h-3.5" />
                      )}
                      {heroImage ? "Replace image" : "Upload image"}
                    </button>
                    {heroImage && canEdit && (
                      <button
                        onClick={() => touch(setHeroImage)("")}
                        className="text-[12px] text-text-faint hover:text-danger text-left"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <input
                    ref={heroFileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) =>
                      e.target.files?.[0] && onHeroFile(e.target.files[0])
                    }
                  />
                </div>
              </Field>
              <Field
                label="Image URL (optional)"
                hint="Or paste a hosted image URL"
              >
                <input
                  value={heroImage}
                  onChange={(e) => touch(setHeroImage)(e.target.value)}
                  disabled={!canEdit}
                  placeholder="https://…"
                  className={cn(inputCls, "font-mono text-[12px]")}
                />
              </Field>
              <Field label="CTA button text">
                <input
                  value={ctaText}
                  onChange={(e) => touch(setCtaText)(e.target.value)}
                  disabled={!canEdit}
                  className={inputCls}
                />
              </Field>
            </section>

            {/* Look book */}
            <section className="space-y-3">
              <h3 className="micro">Look book images</h3>
              <div className="grid grid-cols-4 gap-2">
                {gallery.map((g, i) => (
                  <div
                    key={i}
                    className="relative aspect-[3/4] rounded-[10px] overflow-hidden group"
                  >
                    <div
                      className="absolute inset-0"
                      style={{
                        backgroundImage: `url("${g}")`,
                        backgroundSize: "cover",
                        backgroundPosition: "center",
                      }}
                    />
                    {canEdit && (
                      <button
                        onClick={() =>
                          setGallery(gallery.filter((_, j) => j !== i))
                        }
                        className="absolute top-1 right-1 w-6 h-6 grid place-items-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition"
                        aria-label="Remove image"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
                {canEdit && (
                  <button
                    onClick={() => lookFileRef.current?.click()}
                    disabled={uploading === "look"}
                    className="aspect-[3/4] rounded-[10px] border border-dashed border-line grid place-items-center text-text-faint hover:border-accent/50 hover:text-accent-glow disabled:opacity-50"
                  >
                    {uploading === "look" ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Plus className="w-5 h-5" />
                    )}
                  </button>
                )}
                <input
                  ref={lookFileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) =>
                    e.target.files?.length && onLookFiles(e.target.files)
                  }
                />
              </div>
              <p className="text-[11.5px] text-text-faint">
                Up to 12 images — shown in the Look Book block.
              </p>
            </section>

            {/* Sections */}
            <section className="space-y-3">
              <h3 className="micro">Sections (order = page order)</h3>
              <div className="space-y-1.5">
                {blocks.map((b, i) => {
                  const info = LIBRARY_LABEL[b.key || b.type || ""];
                  const blockKey = (b.key || b.type || "") + i;
                  const isExpanded = expandedBlock === blockKey;
                  const hasEditor = EDITABLE_BLOCKS.has(b.key || b.type || "");
                  return (
                    <div
                      key={blockKey}
                      className="rounded-[10px] border border-line overflow-hidden"
                    >
                      <div className="flex items-center gap-2 p-2.5 bg-text-primary/[0.04]">
                        <div className="flex flex-col">
                          <button
                            disabled={!canEdit || i === 0}
                            onClick={() => moveBlock(i, -1)}
                            className="text-text-faint hover:text-text-primary disabled:opacity-30"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            disabled={!canEdit || i === blocks.length - 1}
                            onClick={() => moveBlock(i, 1)}
                            className="text-text-faint hover:text-text-primary disabled:opacity-30"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-semibold truncate">
                            {info?.label || b.key}
                          </div>
                          <div className="text-[10.5px] text-text-faint truncate">
                            {info?.description}
                          </div>
                        </div>
                        {hasEditor && (
                          <button
                            onClick={() =>
                              setExpandedBlock(isExpanded ? null : blockKey)
                            }
                            className={cn(
                              "p-1 rounded-[6px] transition-colors inline-flex items-center gap-0.5 text-[11px] font-semibold",
                              isExpanded
                                ? "bg-accent/20 text-accent-glow"
                                : "text-text-faint hover:text-accent-glow",
                            )}
                            aria-label="Edit section content"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <ChevronDown
                              className={cn(
                                "w-3 h-3 transition-transform",
                                isExpanded && "rotate-180",
                              )}
                            />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            onClick={() => toggleBlock(b.key || "")}
                            className="text-text-faint hover:text-danger p-1"
                            aria-label="Remove section"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      {isExpanded && hasEditor && (
                        <div className="px-3 pb-3 border-t border-line/60 bg-text-primary/[0.02]">
                          <BlockEditor
                            block={b}
                            onChange={(updated) => updateBlock(i, updated)}
                            canEdit={canEdit}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {canEdit && (
                <div>
                  <div className="micro mb-2 mt-3">Add a section</div>
                  <div className="flex flex-wrap gap-1.5">
                    {BLOCK_LIBRARY.filter(
                      (lib) => !blocks.some((b) => b.key === lib.key),
                    ).map((lib) => (
                      <button
                        key={lib.key}
                        onClick={() => toggleBlock(lib.key)}
                        className="px-2.5 py-1.5 rounded-full border border-line text-[12px] text-text-muted hover:border-accent/45 hover:text-accent-glow inline-flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" /> {lib.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* States */}
            <section className="space-y-3">
              <h3 className="micro">Countdown & ended state</h3>
              <Field
                label="Countdown message"
                hint="Shown beside the timer (Before / Live)"
              >
                <input
                  value={countdownMsg}
                  onChange={(e) => touch(setCountdownMsg)(e.target.value)}
                  disabled={!canEdit}
                  placeholder="Doors open in"
                  className={inputCls}
                />
              </Field>
              <Field label="Ended message">
                <input
                  value={endedMsg}
                  onChange={(e) => touch(setEndedMsg)(e.target.value)}
                  disabled={!canEdit}
                  placeholder="The drop has ended — but our shelves are full of beautiful things."
                  className={inputCls}
                />
              </Field>
              <Field
                label="Ended redirect URL"
                hint="Where 'Shop our collection' points"
              >
                <input
                  value={endedRedirect}
                  onChange={(e) => touch(setEndedRedirect)(e.target.value)}
                  disabled={!canEdit}
                  placeholder="https://pixiegirlglobal.com"
                  className={cn(inputCls, "font-mono text-[12px]")}
                />
              </Field>
            </section>
          </div>
        </div>

        {/* Preview */}
        <div
          className={cn(
            "flex-1 min-w-0 bg-bg",
            mobileTab === "preview" ? "block" : "hidden md:block",
          )}
        >
          <div className="h-full flex flex-col">
            <div className="shrink-0 px-4 py-2 border-b border-line/60 flex items-center justify-between md:hidden">
              <span className="text-[12px] text-text-muted">Preview</span>
              <div className="flex items-center gap-1 rounded-full bg-text-primary/[0.05] p-0.5">
                {(["before", "live", "ended"] as PublicState[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setPreviewState(s)}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-[11px] font-semibold capitalize",
                      previewState === s
                        ? "bg-accent-deep text-[#F4E9D9]"
                        : "text-text-muted",
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <LandingRender model={model} brandConfig={brandConfig} />
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const inputCls =
  "w-full h-[42px] px-[13px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px] disabled:opacity-50";

const textareaCls =
  "w-full px-[13px] py-[10px] rounded-[11px] bg-text-primary/[0.04] border border-line outline-none focus:border-accent/50 text-[13px] disabled:opacity-50 resize-none leading-relaxed";

function BlockEditor({
  block,
  onChange,
  canEdit,
}: {
  block: LandingBlock;
  onChange: (b: LandingBlock) => void;
  canEdit: boolean;
}) {
  const key = block.key || block.type || "";
  const props = (block.props || {}) as Record<string, unknown>;

  function setProps(next: Record<string, unknown>) {
    onChange({ ...block, props: next });
  }
  function setProp(k: string, v: unknown) {
    setProps({ ...props, [k]: v });
  }

  const body = typeof props.body === "string" ? props.body : "";

  switch (key) {
    case "brand_story":
      return (
        <div className="space-y-2.5 pt-3">
          <Field label="Body text">
            <textarea
              value={body}
              onChange={(e) => setProp("body", e.target.value)}
              disabled={!canEdit}
              rows={4}
              className={textareaCls}
              placeholder="Every drop begins with a single idea…"
            />
          </Field>
          <Field label="Section image URL" hint="Shown beside the text">
            <input
              value={
                typeof props.image_url === "string" ? props.image_url : ""
              }
              onChange={(e) => setProp("image_url", e.target.value)}
              disabled={!canEdit}
              placeholder="https://…"
              className={cn(inputCls, "font-mono text-[12px]")}
            />
          </Field>
        </div>
      );

    case "founder_quote":
      return (
        <div className="space-y-2.5 pt-3">
          <Field label="Quote text">
            <textarea
              value={body}
              onChange={(e) => setProp("body", e.target.value)}
              disabled={!canEdit}
              rows={3}
              className={textareaCls}
              placeholder="We don't do ordinary. We do the piece she remembers."
            />
          </Field>
          <Field label="Attribution">
            <input
              value={
                typeof props.attribution === "string" ? props.attribution : ""
              }
              onChange={(e) => setProp("attribution", e.target.value)}
              disabled={!canEdit}
              placeholder="The Founder"
              className={inputCls}
            />
          </Field>
        </div>
      );

    case "why_buy": {
      const defaults = [
        {
          title: "Ethically sourced",
          description: "Full-density, raw hair — traceable to the bundle.",
        },
        {
          title: "Made to last",
          description: "Wears, washes and styles like your own.",
        },
        {
          title: "Loved by thousands",
          description: "A community of women who don't settle.",
        },
      ];
      const items = (
        Array.isArray(props.items) ? props.items : defaults
      ) as Array<{ title: string; description: string }>;
      return (
        <div className="space-y-2.5 pt-3">
          {items.map((item, i) => (
            <div
              key={i}
              className="space-y-1.5 p-3 rounded-[10px] bg-text-primary/[0.04] border border-line"
            >
              <div className="text-[10.5px] font-semibold text-text-faint mb-1">
                Value prop {i + 1}
              </div>
              <Field label="Title">
                <input
                  value={item.title}
                  onChange={(e) => {
                    const next = [...items];
                    next[i] = { ...next[i], title: e.target.value };
                    setProp("items", next);
                  }}
                  disabled={!canEdit}
                  className={inputCls}
                />
              </Field>
              <Field label="Description">
                <textarea
                  value={item.description}
                  onChange={(e) => {
                    const next = [...items];
                    next[i] = { ...next[i], description: e.target.value };
                    setProp("items", next);
                  }}
                  disabled={!canEdit}
                  rows={2}
                  className={textareaCls}
                />
              </Field>
            </div>
          ))}
        </div>
      );
    }

    case "testimonials": {
      const defaults = [
        {
          quote:
            "Easily the best I've ordered. The quality speaks before I do.",
          customer: "Verified customer",
        },
        {
          quote:
            "Easily the best I've ordered. The quality speaks before I do.",
          customer: "Verified customer",
        },
        {
          quote:
            "Easily the best I've ordered. The quality speaks before I do.",
          customer: "Verified customer",
        },
      ];
      const items = (
        Array.isArray(props.items) ? props.items : defaults
      ) as Array<{ quote: string; customer: string }>;
      return (
        <div className="space-y-2.5 pt-3">
          {items.map((item, i) => (
            <div
              key={i}
              className="space-y-1.5 p-3 rounded-[10px] bg-text-primary/[0.04] border border-line"
            >
              <div className="text-[10.5px] font-semibold text-text-faint mb-1">
                Testimonial {i + 1}
              </div>
              <Field label="Quote">
                <textarea
                  value={item.quote}
                  onChange={(e) => {
                    const next = [...items];
                    next[i] = { ...next[i], quote: e.target.value };
                    setProp("items", next);
                  }}
                  disabled={!canEdit}
                  rows={2}
                  className={textareaCls}
                />
              </Field>
              <Field label="Customer">
                <input
                  value={item.customer}
                  onChange={(e) => {
                    const next = [...items];
                    next[i] = { ...next[i], customer: e.target.value };
                    setProp("items", next);
                  }}
                  disabled={!canEdit}
                  placeholder="Verified customer"
                  className={inputCls}
                />
              </Field>
            </div>
          ))}
          {canEdit && (
            <div className="flex gap-3">
              <button
                onClick={() =>
                  setProp("items", [...items, { quote: "", customer: "" }])
                }
                className="text-[12px] text-accent-glow inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
              {items.length > 1 && (
                <button
                  onClick={() => setProp("items", items.slice(0, -1))}
                  className="text-[12px] text-text-faint hover:text-danger inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" /> Remove last
                </button>
              )}
            </div>
          )}
        </div>
      );
    }

    case "faq": {
      const defaults = [
        {
          q: "How long does delivery take?",
          a: "Lagos: 1–2 days. Nationwide: 2–4 days via DHL.",
        },
        {
          q: "Can I return an item?",
          a: "Unworn pieces can be returned within 7 days of delivery.",
        },
        {
          q: "Are prices in this drop final?",
          a: "Yes — these are limited-time prices, only while the drop is live.",
        },
      ];
      const items = (
        Array.isArray(props.items) ? props.items : defaults
      ) as Array<{ q: string; a: string }>;
      return (
        <div className="space-y-2.5 pt-3">
          {items.map((item, i) => (
            <div
              key={i}
              className="space-y-1.5 p-3 rounded-[10px] bg-text-primary/[0.04] border border-line"
            >
              <div className="text-[10.5px] font-semibold text-text-faint mb-1">
                Q&A {i + 1}
              </div>
              <Field label="Question">
                <input
                  value={item.q}
                  onChange={(e) => {
                    const next = [...items];
                    next[i] = { ...next[i], q: e.target.value };
                    setProp("items", next);
                  }}
                  disabled={!canEdit}
                  className={inputCls}
                />
              </Field>
              <Field label="Answer">
                <textarea
                  value={item.a}
                  onChange={(e) => {
                    const next = [...items];
                    next[i] = { ...next[i], a: e.target.value };
                    setProp("items", next);
                  }}
                  disabled={!canEdit}
                  rows={2}
                  className={textareaCls}
                />
              </Field>
            </div>
          ))}
          {canEdit && (
            <div className="flex gap-3">
              <button
                onClick={() => setProp("items", [...items, { q: "", a: "" }])}
                className="text-[12px] text-accent-glow inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Add question
              </button>
              {items.length > 1 && (
                <button
                  onClick={() => setProp("items", items.slice(0, -1))}
                  className="text-[12px] text-text-faint hover:text-danger inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3 h-3" /> Remove last
                </button>
              )}
            </div>
          )}
        </div>
      );
    }

    case "shipping_returns":
      return (
        <div className="pt-3">
          <Field label="Policy text">
            <textarea
              value={body}
              onChange={(e) => setProp("body", e.target.value)}
              disabled={!canEdit}
              rows={4}
              className={textareaCls}
              placeholder="Nationwide delivery via DHL Express. Lagos 1–2 days, nationwide 2–4 days. Returns accepted within 7 days on unworn items."
            />
          </Field>
        </div>
      );

    case "newsletter_capture":
    case "vip_signup":
      return (
        <div className="space-y-2.5 pt-3">
          <Field label="Heading">
            <input
              value={typeof props.heading === "string" ? props.heading : ""}
              onChange={(e) => setProp("heading", e.target.value)}
              disabled={!canEdit}
              placeholder={
                key === "vip_signup" ? "Join the inner circle" : "Be first, always"
              }
              className={inputCls}
            />
          </Field>
          <Field label="Description">
            <textarea
              value={
                typeof props.description === "string" ? props.description : ""
              }
              onChange={(e) => setProp("description", e.target.value)}
              disabled={!canEdit}
              rows={2}
              className={textareaCls}
              placeholder="First access to every drop, private prices and the occasional gift. No noise."
            />
          </Field>
          <Field label="Button label">
            <input
              value={
                typeof props.button_label === "string"
                  ? props.button_label
                  : ""
              }
              onChange={(e) => setProp("button_label", e.target.value)}
              disabled={!canEdit}
              placeholder="Join the list"
              className={inputCls}
            />
          </Field>
        </div>
      );

    case "bundle_showcase": {
      const defaults = [
        {
          name: "The Signature Set 1",
          description:
            "A fixed, curated composition — styled to wear together.",
          price_ngn: "180000",
          regular_price_ngn: "240000",
          image_url: "",
        },
        {
          name: "The Signature Set 2",
          description:
            "A fixed, curated composition — styled to wear together.",
          price_ngn: "160000",
          regular_price_ngn: "220000",
          image_url: "",
        },
        {
          name: "The Signature Set 3",
          description:
            "A fixed, curated composition — styled to wear together.",
          price_ngn: "140000",
          regular_price_ngn: "200000",
          image_url: "",
        },
      ];
      const bundles = (
        Array.isArray(props.bundles) ? props.bundles : defaults
      ) as Array<{
        name: string;
        description: string;
        price_ngn: string;
        regular_price_ngn: string;
        image_url: string;
      }>;
      return (
        <div className="space-y-2.5 pt-3">
          {bundles.map((bundle, i) => (
            <div
              key={i}
              className="space-y-1.5 p-3 rounded-[10px] bg-text-primary/[0.04] border border-line"
            >
              <div className="text-[10.5px] font-semibold text-text-faint mb-1">
                Bundle {i + 1}
              </div>
              <Field label="Name">
                <input
                  value={bundle.name}
                  onChange={(e) => {
                    const next = [...bundles];
                    next[i] = { ...next[i], name: e.target.value };
                    setProp("bundles", next);
                  }}
                  disabled={!canEdit}
                  className={inputCls}
                />
              </Field>
              <Field label="Description">
                <textarea
                  value={bundle.description}
                  onChange={(e) => {
                    const next = [...bundles];
                    next[i] = { ...next[i], description: e.target.value };
                    setProp("bundles", next);
                  }}
                  disabled={!canEdit}
                  rows={2}
                  className={textareaCls}
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Price (NGN)">
                  <input
                    value={bundle.price_ngn}
                    onChange={(e) => {
                      const next = [...bundles];
                      next[i] = { ...next[i], price_ngn: e.target.value };
                      setProp("bundles", next);
                    }}
                    disabled={!canEdit}
                    type="number"
                    className={inputCls}
                  />
                </Field>
                <Field label="Regular (NGN)">
                  <input
                    value={bundle.regular_price_ngn}
                    onChange={(e) => {
                      const next = [...bundles];
                      next[i] = {
                        ...next[i],
                        regular_price_ngn: e.target.value,
                      };
                      setProp("bundles", next);
                    }}
                    disabled={!canEdit}
                    type="number"
                    className={inputCls}
                  />
                </Field>
              </div>
              <Field label="Image URL">
                <input
                  value={bundle.image_url}
                  onChange={(e) => {
                    const next = [...bundles];
                    next[i] = { ...next[i], image_url: e.target.value };
                    setProp("bundles", next);
                  }}
                  disabled={!canEdit}
                  placeholder="https://…"
                  className={cn(inputCls, "font-mono text-[12px]")}
                />
              </Field>
            </div>
          ))}
        </div>
      );
    }

    case "quantity_tier_visualiser": {
      const defaults = [
        { qty: 2, save_ngn: "15000" },
        { qty: 3, save_ngn: "30000" },
        { qty: 4, save_ngn: "55000" },
      ];
      const tiers = (
        Array.isArray(props.tiers) ? props.tiers : defaults
      ) as Array<{ qty: number; save_ngn: string }>;
      return (
        <div className="space-y-2.5 pt-3">
          {tiers.map((tier, i) => (
            <div
              key={i}
              className="flex gap-2 items-end p-3 rounded-[10px] bg-text-primary/[0.04] border border-line"
            >
              <Field label="Min qty" className="flex-1">
                <input
                  value={tier.qty}
                  onChange={(e) => {
                    const next = [...tiers];
                    next[i] = { ...next[i], qty: Number(e.target.value) };
                    setProp("tiers", next);
                  }}
                  disabled={!canEdit}
                  type="number"
                  min={1}
                  className={inputCls}
                />
              </Field>
              <Field label="Save (NGN)" className="flex-1">
                <input
                  value={tier.save_ngn}
                  onChange={(e) => {
                    const next = [...tiers];
                    next[i] = { ...next[i], save_ngn: e.target.value };
                    setProp("tiers", next);
                  }}
                  disabled={!canEdit}
                  type="number"
                  className={inputCls}
                />
              </Field>
              {canEdit && tiers.length > 1 && (
                <button
                  onClick={() =>
                    setProp(
                      "tiers",
                      tiers.filter((_, j) => j !== i),
                    )
                  }
                  className="h-[42px] px-2 text-text-faint hover:text-danger"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          {canEdit && (
            <button
              onClick={() =>
                setProp("tiers", [...tiers, { qty: tiers.length + 2, save_ngn: "0" }])
              }
              className="text-[12px] text-accent-glow inline-flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add tier
            </button>
          )}
        </div>
      );
    }

    default:
      return null;
  }
}
