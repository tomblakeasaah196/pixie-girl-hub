/**
 * LandingStudioPage — standalone, full-screen editor for the brand-level
 * "no active sale" landing page. Not nested inside a campaign.
 *
 * Left: editor panels (identity, theme, background, logo + tint, hero,
 * invitation, form fields, gallery, pillars, socials, reveal).
 * Right: live preview. Save draft / Publish / Open preview in a new tab.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  ImageUp,
  Loader2,
  Play,
  Plus,
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
  uploadLandingImage,
  withDefaults,
  defaultConfig,
  type LandingConfig,
  type ChannelOption,
} from "@/lib/landing-studio";
import { DeniedState } from "@/components/ui/controls";
import { LandingPreview } from "./LandingPreview";
import { AtelierRevealPreview } from "./AtelierRevealPreview";

const THEME_KEYS: { key: keyof LandingConfig["theme"]; label: string }[] = [
  { key: "primary", label: "Primary" },
  { key: "primaryDeep", label: "Primary deep" },
  { key: "accent", label: "Accent" },
  { key: "glow", label: "Glow" },
  { key: "paper", label: "Paper (bg)" },
  { key: "ink", label: "Ink (hero bg)" },
  { key: "muted", label: "Muted text" },
];

export function LandingStudioPage() {
  const navigate = useNavigate();
  const can = useAuthStore((s) => s.can);
  const brandKey = useBusinessStore((s) => s.activeKey);
  const brandLabel = brandKey === "faitlynhair" ? "Faitlyn Hair" : "Pixie Girl";

  const studio = useLandingStudio();
  const saveDraft = useSaveLandingDraft();
  const publish = usePublishLanding();

  const [config, setConfig] = useState<LandingConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [replay, setReplay] = useState(0);
  const [showReveal, setShowReveal] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Load server config → local editable state when it arrives or brand changes.
  useEffect(() => {
    if (studio.data) {
      setConfig(withDefaults(brandKey, studio.data.config));
      setDirty(false);
    }
  }, [studio.data, brandKey]);

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

  function flash(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  async function onSave() {
    if (!config) return;
    try {
      await saveDraft.mutateAsync(config);
      setDirty(false);
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
    // The preview tab reads the saved draft; save first if dirty.
    const go = () => window.open(`/landing-studio/preview?brand=${brandKey}`, "_blank", "noopener");
    if (dirty && config) {
      void saveDraft.mutateAsync(config).then(() => { setDirty(false); go(); });
    } else {
      go();
    }
  }

  if (!can("sales_campaigns", "view")) {
    return <DeniedState message="You don't have access to the Landing Studio." />;
  }

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-bg">
      {/* Top bar */}
      <header className="flex items-center gap-3 px-4 h-14 border-b hairline shrink-0">
        <button
          onClick={() => navigate("/sales-campaigns")}
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-text-muted hover:text-text-primary"
        >
          <ArrowLeft className="w-4 h-4" /> Campaigns
        </button>
        <div className="h-5 w-px bg-line" />
        <div className="min-w-0">
          <div className="font-display text-[16px] leading-tight truncate">Landing Studio</div>
          <div className="micro -mt-0.5">
            {brandLabel} · sales landing (no active sale)
            {studio.data?.is_published ? " · published" : " · draft only"}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {dirty && <span className="text-[11px] text-warn">Unsaved changes</span>}
          <button
            onClick={openPreviewTab}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[10px] border hairline text-[13px] font-semibold text-text-muted hover:text-text-primary hover:border-accent/40"
          >
            <ExternalLink className="w-4 h-4" /> Preview tab
          </button>
          {canEdit && (
            <>
              <button
                onClick={onSave}
                disabled={saveDraft.isPending}
                title={dirty ? "Save your work in progress as a draft. This does NOT publish it live." : "No unsaved changes to save."}
                className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-[10px] text-[13px] font-semibold transition-colors ${
                  dirty
                    ? "border hairline text-text-muted hover:text-text-primary hover:border-accent/40"
                    : "border hairline text-text-faint border-line/50 cursor-default"
                } disabled:opacity-60`}
              >
                {saveDraft.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
              </button>
              <button
                onClick={onPublish}
                disabled={publish.isPending}
                title="Save and publish live in one step. Visitors will see this immediately."
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-[10px] bg-accent-deep text-text-primary text-[13px] font-semibold disabled:opacity-60"
              >
                {publish.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Publish
              </button>
            </>
          )}
        </div>
      </header>

      {/* Body: editor | preview */}
      <div className="flex-1 min-h-0 flex">
        {/* Editor */}
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
            <Editor config={config} update={update} brandKey={brandKey} onReset={() => { setConfig(defaultConfig(brandKey)); setDirty(true); }} onReplay={() => { setShowReveal(true); setReplay((r) => r + 1); }} />
          )}
        </aside>

        {/* Preview */}
        <main className="flex-1 min-w-0 relative bg-black/40 overflow-hidden">
          <div className="absolute inset-0 overflow-y-auto">
            {config && <LandingPreview config={config} />}
          </div>
          {config && showReveal && (
            <AtelierRevealPreview
              config={config}
              replayKey={replay}
              onComplete={() => setShowReveal(false)}
            />
          )}
          {config && (
            <button
              onClick={() => { setShowReveal(true); setReplay((r) => r + 1); }}
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
// Editor panels
// ════════════════════════════════════════════════════════════

function Editor({
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
        <p className="text-[11px] text-text-faint">Tint recolours the logo to a flat colour — fixes a dark logo on a dark header (or a cream logo on a cream footer).</p>
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

      <Section title="Reveal">
        <Toggle label="Cinematic reveal enabled" checked={config.reveal.enabled} onChange={(v) => update((d) => { d.reveal.enabled = v; })} />
        <Toggle label="Show scarcity counter" checked={config.reveal.showScarcity} onChange={(v) => update((d) => { d.reveal.showScarcity = v; })} />
        <Text label="Reveal tagline" value={config.reveal.tagline} onChange={(v) => update((d) => { d.reveal.tagline = v; })} />

        {config.reveal.threeD && (
          <>
            <div className="pt-2 mt-2 border-t border-border-c/10">
              <Toggle label="3D brand animation enabled" checked={config.reveal.threeD.enabled} onChange={(v) => update((d) => { if (d.reveal.threeD) d.reveal.threeD.enabled = v; })} />

              {config.reveal.threeD.enabled && (
                <>
                  <div className="mt-3">
                    <label className="text-[12px] font-semibold block mb-1.5">3D Variant</label>
                    <select
                      value={config.reveal.threeD.variant}
                      onChange={(e) => update((d) => { if (d.reveal.threeD) d.reveal.threeD.variant = e.target.value as "text-dual" | "logo-static"; })}
                      className="input-sm w-full"
                    >
                      <option value="text-dual">Text (Pixie Girl + Global)</option>
                      <option value="logo-static">Logo (Faitlyn Hair)</option>
                    </select>
                  </div>

                  <div className="mt-3">
                    <label className="text-[12px] font-semibold block mb-1.5">Rotation Speed</label>
                    <input
                      type="range"
                      min="0.5"
                      max="3"
                      step="0.1"
                      value={config.reveal.threeD.rotationSpeed}
                      onChange={(e) => update((d) => { if (d.reveal.threeD) d.reveal.threeD.rotationSpeed = parseFloat(e.target.value); })}
                      className="w-full"
                    />
                    <span className="text-[11px] text-text-muted">{config.reveal.threeD.rotationSpeed.toFixed(1)}x</span>
                  </div>

                  <div className="mt-3">
                    <label className="text-[12px] font-semibold block mb-1.5">Glow Intensity</label>
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.1"
                      value={config.reveal.threeD.glowIntensity}
                      onChange={(e) => update((d) => { if (d.reveal.threeD) d.reveal.threeD.glowIntensity = parseFloat(e.target.value); })}
                      className="w-full"
                    />
                    <span className="text-[11px] text-text-muted">{config.reveal.threeD.glowIntensity.toFixed(1)}x</span>
                  </div>
                </>
              )}
            </div>
          </>
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

function Range({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="micro block mb-1">{label}</span>
      <input type="range" value={value} min={min} max={max} step={0.05} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[rgb(var(--accent))]" />
    </label>
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
