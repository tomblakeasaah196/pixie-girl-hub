import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ExternalLink,
  Info,
  Loader2,
  RotateCcw,
  Save,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, Card, Pill } from "@/components/ui/primitives";
import { useActiveBusiness, useBusinessStore } from "@/stores/business";
import { useUiStore } from "@/stores/ui";
import {
  COLOUR_TOKENS,
  SCALAR_TOKENS,
  FONT_HOST_ALLOWLIST,
  hexToTriplet,
  tripletToHex,
  isAllowedFontUrl,
  useBranding,
  useFontCatalog,
  usePlatformSettings,
  useSaveBusinessBranding,
  useSavePlatformSettings,
  type ColourToken,
  type FontCatalogItem,
  type PlatformBranding,
  type ScalarToken,
  type ThemeMode,
  type ThemeTokens,
} from "@/lib/branding";

/**
 * Settings → Appearance (canon §2.3). The Layer-A platform skin and
 * Layer-B per-brand identity, both backed by the database.
 *
 * Editing is preview-first: every tweak paints the live document so
 * the admin sees the change immediately, but nothing persists until
 * they click Save. The mutation's onSuccess invalidates the branding
 * query → ThemeProvider re-applies the canonical row → the preview
 * "snaps" to truth, proving the round-trip worked.
 */

const PRESETS: ReadonlyArray<{
  name: string;
  desc: string;
  mode: ThemeMode;
  patch: ThemeTokens;
}> = [
  {
    name: "Maroon Noir",
    desc: "Black · deep red · cream",
    mode: "dark",
    patch: {
      bg: "15 8 9",
      panel: "26 15 17",
      "panel-2": "39 22 25",
      text: "244 233 217",
      "text-muted": "179 164 155",
      "text-faint": "128 112 107",
      accent: "168 29 29",
      "accent-deep": "105 9 9",
      "accent-glow": "216 92 87",
    },
  },
  {
    name: "Porcelain White",
    desc: "White · deep red · ink",
    mode: "light",
    patch: {
      bg: "251 250 249",
      panel: "255 255 255",
      "panel-2": "244 241 238",
      text: "26 16 17",
      "text-muted": "107 94 92",
      "text-faint": "155 142 138",
      accent: "105 9 9",
      "accent-deep": "105 9 9",
      "accent-glow": "140 20 20",
    },
  },
  {
    name: "Onyx Ruby",
    desc: "Neutral black · ruby",
    mode: "dark",
    patch: {
      bg: "12 11 13",
      panel: "24 22 26",
      accent: "177 30 30",
      "accent-deep": "155 24 24",
    },
  },
] as const;

export function AppearancePage() {
  const branding = useBranding();
  const platform = usePlatformSettings(true);
  const fonts = useFontCatalog();

  const saved: PlatformBranding | null =
    platform.data ?? branding.data?.platform ?? null;

  if (!saved) {
    return (
      <div className="flex items-center gap-2 text-text-muted">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading appearance…
      </div>
    );
  }

  return (
    <div className="max-w-[820px] space-y-8 pb-24">
      <LayerASection
        saved={saved}
        fonts={fonts.data ?? []}
        platformError={platform.isError}
      />
      <div className="h-px bg-text-primary/10" />
      <LayerBSection />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// LAYER A — Platform / white-label
// ──────────────────────────────────────────────────────────────

function LayerASection({
  saved,
  fonts,
  platformError,
}: {
  saved: PlatformBranding;
  fonts: FontCatalogItem[];
  platformError: boolean;
}) {
  const { theme: uiMode, setTheme } = useUiStore();
  const save = useSavePlatformSettings();

  // Draft is the editable copy of `saved`. Diffed on save so we only
  // send the minimum patch.
  const [draft, setDraft] = useState<PlatformBranding>(saved);
  useEffect(() => setDraft(saved), [saved]);

  const dirty = useMemo(() => !shallowEqual(draft, saved), [draft, saved]);

  // Mode tab — independent from the user's preferred ui mode so an
  // admin can edit the light theme while sitting in dark.
  const [editMode, setEditMode] = useState<ThemeMode>(uiMode as ThemeMode);

  // Live-preview the draft — paint tokens onto :root as the admin
  // edits. Effect cleans up by re-applying the saved row, so a Reset
  // click + navigate-away leaves nothing stuck.
  useEffect(() => {
    const root = document.documentElement;
    const tokens = draft.theme?.[editMode] ?? {};
    for (const t of COLOUR_TOKENS) {
      const v = tokens[t];
      if (v) root.style.setProperty(`--${t}`, v);
    }
    for (const t of SCALAR_TOKENS) {
      const v = tokens[t];
      if (v) root.style.setProperty(`--${t}`, v);
    }
    root.style.setProperty("--font-display", draft.font_display);
    root.style.setProperty("--font-body", draft.font_body);
    root.style.setProperty("--font-mono", draft.font_mono);
  }, [draft, editMode]);

  const reset = () => setDraft(saved);
  const onSave = () => {
    const patch = diff(draft, saved);
    if (Object.keys(patch).length === 0) return;
    save.mutate(patch);
  };

  // Match the edit mode to the document so what the admin sees on
  // :root matches what tokens they're tweaking.
  useEffect(() => {
    document.documentElement.dataset.theme = editMode;
  }, [editMode]);
  // Restore the user's preferred mode when leaving the page.
  useEffect(() => () => setTheme(uiMode), [setTheme, uiMode]);

  return (
    <section>
      <SectionHeader
        layer="A"
        tone="danger"
        title="App Appearance — the platform"
        subtitle="The white-label switch. Logos, fonts, the full Maroon Noir token bag — light &amp; dark — applied across the ERP."
      />

      {platformError && (
        <Banner tone="warn" className="mt-2">
          Couldn&rsquo;t load the protected settings (auth not yet wired). You
          can preview changes; <strong>Save</strong> needs the auth module to
          land.
        </Banner>
      )}

      {/* Product identity */}
      <Card className="mt-4 p-5 space-y-4">
        <div className="micro">Product identity</div>
        <div className="grid grid-cols-2 gap-3">
          <Field
            label="Product name"
            value={draft.product_name}
            onChange={(v) => setDraft({ ...draft, product_name: v })}
          />
          <Field
            label="Company name"
            value={draft.company_name ?? ""}
            onChange={(v) =>
              setDraft({ ...draft, company_name: v || null })
            }
          />
          <Field
            label="Tagline"
            value={draft.tagline ?? ""}
            onChange={(v) => setDraft({ ...draft, tagline: v || null })}
            colSpan={2}
          />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field
            label="Logo URL (dark backgrounds)"
            value={draft.logo_dark_url ?? ""}
            onChange={(v) =>
              setDraft({ ...draft, logo_dark_url: v || null })
            }
          />
          <Field
            label="Logo URL (light backgrounds)"
            value={draft.logo_light_url ?? ""}
            onChange={(v) =>
              setDraft({ ...draft, logo_light_url: v || null })
            }
          />
          <Field
            label="Favicon URL"
            value={draft.favicon_url ?? ""}
            onChange={(v) => setDraft({ ...draft, favicon_url: v || null })}
          />
        </div>
      </Card>

      {/* Theme presets */}
      <Card className="mt-4 p-5 space-y-3">
        <div className="micro">Theme preset</div>
        <div className="grid grid-cols-3 gap-2.5">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => {
                setEditMode(p.mode);
                const current = draft.theme?.[p.mode] ?? {};
                setDraft({
                  ...draft,
                  theme: { ...draft.theme, [p.mode]: { ...current, ...p.patch } },
                });
              }}
              className="text-left p-3 rounded-[13px] border hairline bg-text-primary/[0.03] hover:border-accent/40 transition-colors"
            >
              <div className="flex gap-1.5 mb-2.5">
                {(["bg", "accent", "text"] as ColourToken[]).map((t) => {
                  const v = p.patch[t];
                  return (
                    <span
                      key={t}
                      className="w-[20px] h-[20px] rounded-[6px] border hairline"
                      style={{ background: v ? `rgb(${v})` : "transparent" }}
                    />
                  );
                })}
              </div>
              <div className="font-display text-[14px]">{p.name}</div>
              <div className="text-[10px] text-text-faint">{p.desc}</div>
            </button>
          ))}
        </div>
      </Card>

      {/* Tokens editor */}
      <Card className="mt-4 p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="micro">Tokens · editing</div>
          <div className="flex gap-1 bg-text-primary/[0.05] rounded-[10px] p-1">
            {(["dark", "light"] as ThemeMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setEditMode(m)}
                className={cn(
                  "px-3 py-1 text-[11.5px] font-semibold rounded-[8px] capitalize",
                  editMode === m
                    ? "bg-accent/15 text-accent-glow"
                    : "text-text-muted hover:text-text-primary",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {COLOUR_TOKENS.map((t) => (
            <TokenRow
              key={t}
              token={t}
              value={draft.theme?.[editMode]?.[t]}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  theme: {
                    ...draft.theme,
                    [editMode]: { ...(draft.theme?.[editMode] ?? {}), [t]: v },
                  },
                })
              }
            />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3">
          {SCALAR_TOKENS.map((t) => (
            <ScalarRow
              key={t}
              token={t}
              value={draft.theme?.[editMode]?.[t]}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  theme: {
                    ...draft.theme,
                    [editMode]: { ...(draft.theme?.[editMode] ?? {}), [t]: v },
                  },
                })
              }
            />
          ))}
        </div>
      </Card>

      {/* Fonts */}
      <Card className="mt-4 p-5 space-y-4">
        <div className="micro">Typography</div>

        <FontPicker
          label="Display (headlines)"
          value={draft.font_display}
          fonts={fonts.filter((f) =>
            ["display", "serif"].includes(f.category),
          )}
          onChange={(v) => setDraft({ ...draft, font_display: v })}
        />
        <FontPicker
          label="Body (UI &amp; long-form)"
          value={draft.font_body}
          fonts={fonts.filter((f) =>
            ["sans", "serif"].includes(f.category),
          )}
          onChange={(v) => setDraft({ ...draft, font_body: v })}
        />
        <FontPicker
          label="Mono (numerics &amp; SKUs)"
          value={draft.font_mono}
          fonts={fonts.filter((f) => f.category === "mono")}
          onChange={(v) => setDraft({ ...draft, font_mono: v })}
        />

        <FontUrlField
          value={draft.font_css_url}
          onChange={(v) => setDraft({ ...draft, font_css_url: v })}
        />
      </Card>

      {/* Preview snapshot */}
      <Card className="mt-4 p-5">
        <div className="micro mb-3">Preview · live document</div>
        <PreviewSnapshot draft={draft} editMode={editMode} />
        <p className="mt-3 text-[11px] text-text-faint">
          Hover the cards above — the page itself is the preview. Click{" "}
          <strong>Save changes</strong> when you&rsquo;re happy.
        </p>
      </Card>

      <StickyActions
        dirty={dirty}
        saving={save.isPending}
        error={save.error ? formatError(save.error) : null}
        success={save.isSuccess && !dirty ? "Saved" : null}
        onReset={reset}
        onSave={onSave}
      />
    </section>
  );
}

// ──────────────────────────────────────────────────────────────
// LAYER B — Per-business branding (active brand only for now)
// ──────────────────────────────────────────────────────────────

function LayerBSection() {
  const active = useActiveBusiness();
  const branding = useBranding();
  const save = useSaveBusinessBranding();
  const setActive = useBusinessStore((s) => s.setActive);
  const businesses = branding.data?.businesses ?? [];
  const row = businesses.find((b) => b.business_key === active.key);

  const [accent, setAccent] = useState(active.accent);
  const [grad1, setGrad1] = useState(active.grad1);
  const [grad2, setGrad2] = useState(active.grad2);
  useEffect(() => {
    setAccent(active.accent);
    setGrad1(active.grad1);
    setGrad2(active.grad2);
  }, [active.key, active.accent, active.grad1, active.grad2]);

  // Live preview the gradient + accent.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--biz-1", grad1);
    root.style.setProperty("--biz-2", grad2);
    root.style.setProperty("--biz-accent", accent);
  }, [accent, grad1, grad2]);

  const dirty =
    accent !== active.accent || grad1 !== active.grad1 || grad2 !== active.grad2;

  const reset = () => {
    setAccent(active.accent);
    setGrad1(active.grad1);
    setGrad2(active.grad2);
  };

  const onSave = () =>
    save.mutate({
      accent_colour: accent,
      brand_theme: {
        ...row?.brand_theme,
        grad1,
        grad2,
        accent,
      },
    });

  return (
    <section>
      <SectionHeader
        layer="B"
        tone="info"
        title="Brand Appearance — each business"
        subtitle="Per-business gradient + accent. Used by the shell chip, the ambient wash, and every email / document — Invoices, POs, Delivery Notes, Receipts, Contracts."
      />

      {businesses.length > 1 && (
        <div className="flex gap-1.5 mt-3">
          {businesses.map((b) => (
            <button
              key={b.business_key}
              onClick={() => setActive(b.business_key)}
              className={cn(
                "px-3 py-1.5 text-[12px] font-semibold rounded-[10px] border",
                active.key === b.business_key
                  ? "border-accent/45 text-accent-glow bg-accent/[0.08]"
                  : "hairline text-text-muted",
              )}
            >
              {b.display_name}
            </button>
          ))}
        </div>
      )}

      <Card className="mt-4 p-5 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <ColourField label="Accent" value={accent} onChange={setAccent} />
          <ColourField label="Gradient start" value={grad1} onChange={setGrad1} />
          <ColourField label="Gradient end" value={grad2} onChange={setGrad2} />
        </div>
        <div
          className="h-[68px] rounded-[14px] border hairline relative overflow-hidden"
          style={{
            background: `linear-gradient(140deg, ${grad1}, ${grad2})`,
          }}
        >
          <div className="absolute inset-0 grid place-items-center font-display text-white text-lg drop-shadow">
            {active.name} brand chip
          </div>
        </div>
      </Card>

      <StickyActions
        dirty={dirty}
        saving={save.isPending}
        error={save.error ? formatError(save.error) : null}
        success={save.isSuccess && !dirty ? `${active.name} saved` : null}
        onReset={reset}
        onSave={onSave}
        offsetY={64}
      />
    </section>
  );
}

// ──────────────────────────────────────────────────────────────
// Pieces
// ──────────────────────────────────────────────────────────────

function SectionHeader({
  layer,
  tone,
  title,
  subtitle,
}: {
  layer: "A" | "B";
  tone: "danger" | "info";
  title: string;
  subtitle: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2.5 mb-1.5">
        <Pill tone={tone} dot={false}>
          Layer {layer}
        </Pill>
        <h3 className="font-display text-[17px] font-medium">{title}</h3>
      </div>
      <p className="text-xs text-text-muted">{subtitle}</p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  colSpan,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  colSpan?: number;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className={cn("block", colSpan === 2 && "col-span-2")}>
      <span className="micro block mb-1.5">{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-text-primary/[0.04] hairline border rounded-[10px] px-3 py-2 text-[13px] focus:outline-none focus:border-accent/50"
      />
    </label>
  );
}

function ColourField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="micro block mb-1.5">{label}</span>
      <div className="flex items-center gap-2 bg-text-primary/[0.04] hairline border rounded-[10px] px-2 py-1.5">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-8 h-8 rounded-[6px] bg-transparent border-0 cursor-pointer"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-transparent text-[12.5px] font-mono focus:outline-none"
        />
      </div>
    </label>
  );
}

function TokenRow({
  token,
  value,
  onChange,
}: {
  token: ColourToken;
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  const hex = value ? tripletToHex(value) : "#000000";
  return (
    <div className="flex items-center gap-2 p-2 rounded-[10px] hover:bg-text-primary/[0.03]">
      <span
        className="w-7 h-7 rounded-[7px] border hairline shrink-0"
        style={{ background: value ? `rgb(${value})` : "transparent" }}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold text-text-muted truncate">
          --{token}
        </div>
        <div className="text-[10.5px] text-text-faint font-mono truncate">
          {value ?? "(default)"}
        </div>
      </div>
      <input
        type="color"
        value={hex}
        onChange={(e) => {
          const t = hexToTriplet(e.target.value);
          if (t) onChange(t);
        }}
        className="w-7 h-7 rounded-[6px] bg-transparent border-0 cursor-pointer shrink-0"
      />
    </div>
  );
}

function ScalarRow({
  token,
  value,
  onChange,
}: {
  token: ScalarToken;
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  const num = value ? Number(value) : 0;
  return (
    <label className="block">
      <span className="micro block mb-1.5">--{token}</span>
      <div className="flex items-center gap-2 bg-text-primary/[0.04] hairline border rounded-[10px] px-2 py-1.5">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={isNaN(num) ? 0 : num}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1"
        />
        <span className="text-[11px] font-mono w-9 text-right">
          {value ?? "—"}
        </span>
      </div>
    </label>
  );
}

function FontPicker({
  label,
  value,
  fonts,
  onChange,
}: {
  label: string;
  value: string;
  fonts: FontCatalogItem[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current =
    fonts.find((f) => f.css_value === value) ??
    ({ family: "Custom", css_value: value, use_hint: "Custom font stack" } as FontCatalogItem);
  return (
    <div className="relative">
      <span className="micro block mb-1.5">{label}</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between bg-text-primary/[0.04] hairline border rounded-[10px] px-3 py-2 text-left hover:border-accent/40"
      >
        <span className="text-[13px]" style={{ fontFamily: current.css_value }}>
          {current.family}
        </span>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-text-faint transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="absolute z-20 mt-1.5 left-0 right-0 max-h-[280px] overflow-auto p-1.5 rounded-[12px] dropglass">
          {fonts.map((f) => (
            <button
              key={f.font_id}
              type="button"
              onClick={() => {
                onChange(f.css_value);
                setOpen(false);
              }}
              className="w-full flex items-center justify-between gap-2 p-2 rounded-[8px] text-left hover:bg-text-primary/[0.06]"
            >
              <div className="min-w-0">
                <div
                  className="text-[13.5px] truncate"
                  style={{ fontFamily: f.css_value }}
                >
                  {f.family}
                </div>
                {f.use_hint && (
                  <div className="text-[10px] text-text-faint truncate">
                    {f.use_hint}
                  </div>
                )}
              </div>
              {f.css_value === value && (
                <Check className="w-4 h-4 text-accent-glow shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FontUrlField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [showHelp, setShowHelp] = useState(false);
  const v = value ?? "";
  const valid = v === "" || isAllowedFontUrl(v);
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="micro">Custom font CSS URL (optional)</span>
        <button
          type="button"
          onClick={() => setShowHelp((s) => !s)}
          className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text-primary"
        >
          <Info className="w-3.5 h-3.5" />
          How it works
        </button>
      </div>
      <input
        type="url"
        value={v}
        placeholder="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap"
        onChange={(e) => onChange(e.target.value || null)}
        className={cn(
          "w-full bg-text-primary/[0.04] hairline border rounded-[10px] px-3 py-2 text-[12.5px] font-mono focus:outline-none",
          valid ? "focus:border-accent/50" : "border-danger/50",
        )}
      />
      {!valid && (
        <p className="text-[11px] text-danger mt-1">
          URL must be https on a trusted host: {FONT_HOST_ALLOWLIST.join(", ")}
        </p>
      )}
      {showHelp && (
        <div className="mt-2 p-3 rounded-[10px] bg-text-primary/[0.04] hairline border text-[11.5px] text-text-muted leading-relaxed">
          <p className="mb-1.5">
            <strong className="text-text-primary">Want a font that isn&rsquo;t in the picker?</strong>
          </p>
          <ol className="list-decimal pl-4 space-y-1">
            <li>
              Go to{" "}
              <a
                href="https://fonts.google.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent-glow inline-flex items-center gap-0.5 hover:underline"
              >
                fonts.google.com <ExternalLink className="w-3 h-3" />
              </a>{" "}
              and pick your family.
            </li>
            <li>
              Click <em>Get embed code</em> → copy the{" "}
              <code className="font-mono">&lt;link href="…"&gt;</code> URL only.
            </li>
            <li>
              Paste it here and update the font family above to match (e.g.{" "}
              <code className="font-mono">"Space Grotesk", sans-serif</code>).
            </li>
          </ol>
          <p className="mt-2 text-text-faint">
            For safety we only accept https URLs from {FONT_HOST_ALLOWLIST.join(", ")}.
            Stylesheets carry CSS power — restricting hosts blocks hostile
            sheets from sneaking in via this field.
          </p>
        </div>
      )}
    </div>
  );
}

function PreviewSnapshot({
  draft,
  editMode,
}: {
  draft: PlatformBranding;
  editMode: ThemeMode;
}) {
  const tokens = draft.theme?.[editMode] ?? {};
  const colour = (t: ColourToken) =>
    tokens[t] ? `rgb(${tokens[t]})` : "transparent";
  return (
    <div
      className="rounded-[14px] border hairline overflow-hidden"
      style={{ background: colour("bg") }}
    >
      <div
        className="p-4 flex items-center justify-between"
        style={{
          background: colour("panel"),
          color: colour("text"),
          fontFamily: draft.font_body,
        }}
      >
        <span
          className="font-display text-base"
          style={{ fontFamily: draft.font_display }}
        >
          {draft.product_name}
        </span>
        <span
          className="text-[11px] px-2 py-1 rounded-full"
          style={{
            background: tokens.accent ? `rgb(${tokens.accent} / 0.15)` : "transparent",
            color: tokens["accent-glow"]
              ? `rgb(${tokens["accent-glow"]})`
              : colour("accent"),
          }}
        >
          Live preview
        </span>
      </div>
      <div className="p-4 space-y-2" style={{ color: colour("text") }}>
        <div style={{ color: colour("text-muted"), fontSize: 11 }}>
          {draft.tagline ?? "(no tagline set)"}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="px-3 py-1.5 rounded-[10px] text-[12px] font-semibold"
            style={{
              background: colour("accent-deep"),
              color: colour("text"),
            }}
          >
            Primary action
          </button>
          <button
            type="button"
            className="px-3 py-1.5 rounded-[10px] text-[12px] font-semibold border"
            style={{
              borderColor: tokens["border-c"]
                ? `rgb(${tokens["border-c"]} / ${tokens["border-alpha"] ?? "0.2"})`
                : "transparent",
              color: colour("text"),
            }}
          >
            Secondary
          </button>
        </div>
      </div>
    </div>
  );
}

function StickyActions({
  dirty,
  saving,
  error,
  success,
  onReset,
  onSave,
  offsetY = 0,
}: {
  dirty: boolean;
  saving: boolean;
  error: string | null;
  success: string | null;
  onReset: () => void;
  onSave: () => void;
  offsetY?: number;
}) {
  if (!dirty && !saving && !success && !error) return null;
  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-40"
      style={{ bottom: 24 + offsetY }}
    >
      <div className="dropglass rounded-[14px] px-4 py-2.5 flex items-center gap-3 shadow-xl">
        {error && (
          <span className="text-[11.5px] text-danger max-w-[260px] truncate">
            {error}
          </span>
        )}
        {success && !error && (
          <span className="text-[11.5px] text-success flex items-center gap-1">
            <Check className="w-4 h-4" /> {success}
          </span>
        )}
        {dirty && !error && (
          <span className="text-[11.5px] text-warn">Unsaved changes</span>
        )}
        <Button variant="ghost" size="sm" icon={<RotateCcw className="w-4 h-4" />} onClick={onReset} disabled={saving || !dirty}>
          Reset
        </Button>
        <Button
          variant="primary"
          size="sm"
          icon={
            saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )
          }
          onClick={onSave}
          disabled={!dirty || saving}
        >
          Save changes
        </Button>
      </div>
    </div>
  );
}

function Banner({
  tone,
  children,
  className,
}: {
  tone: "warn" | "info" | "danger";
  children: React.ReactNode;
  className?: string;
}) {
  const TONE: Record<typeof tone, string> = {
    warn: "bg-warn/10 border-warn/40 text-warn",
    info: "bg-info/10 border-info/40 text-info",
    danger: "bg-danger/10 border-danger/40 text-danger",
  };
  return (
    <div
      className={cn(
        "border rounded-[10px] px-3 py-2 text-[12px]",
        TONE[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function shallowEqual<T extends object>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function diff(
  draft: PlatformBranding,
  saved: PlatformBranding,
): Partial<PlatformBranding> {
  const out: Partial<PlatformBranding> = {};
  (
    [
      "product_name",
      "tagline",
      "company_name",
      "logo_dark_url",
      "logo_light_url",
      "favicon_url",
      "font_display",
      "font_body",
      "font_mono",
      "font_css_url",
    ] as const
  ).forEach((k) => {
    if (draft[k] !== saved[k]) (out as Record<string, unknown>)[k] = draft[k];
  });
  if (JSON.stringify(draft.theme) !== JSON.stringify(saved.theme)) {
    out.theme = draft.theme;
  }
  return out;
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Save failed";
}
