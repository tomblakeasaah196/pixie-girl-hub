import { useBreadcrumbs } from "@/stores/breadcrumbs";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  GripVertical,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, Card } from "@/components/ui/primitives";
import { ImageUpload } from "@/components/ui/ImageUpload";
import {
  LOGIN_CONFIG_FALLBACK,
  usePlatformSettings,
  useSavePlatformSettings,
  type LoginConfig,
  type LoginQuote,
  type LoginStandard,
} from "@/lib/branding";

/**
 * Settings → Login screen content (canon §8 white-label discipline).
 * Everything the logged-out door renders — hero copy, the house quotes,
 * the Standard cards, per-region welcome lines, and the feature toggles —
 * is edited here and saved to platform_settings.login_config. Nothing about
 * the login page is hardcoded; this is where it's driven from.
 */

const CONTINENTS: ReadonlyArray<{ code: string; label: string }> = [
  { code: "default", label: "Default / unknown" },
  { code: "AF", label: "Africa" },
  { code: "AS", label: "Asia" },
  { code: "EU", label: "Europe" },
  { code: "NA", label: "North America" },
  { code: "SA", label: "South America" },
  { code: "OC", label: "Oceania" },
  { code: "AN", label: "Antarctica / afar" },
];

const TOGGLE_FIELDS: ReadonlyArray<{ key: keyof NonNullable<LoginConfig["toggles"]>; label: string; hint: string }> = [
  { key: "splash", label: "Splash screen", hint: "Brief logo splash on load" },
  { key: "particles", label: "Ambient particles", hint: "Drifting accent motes" },
  { key: "geo_welcome", label: "Regional welcome", hint: "Greet by visitor location" },
  { key: "business_badges", label: "Business badges", hint: "Show active houses" },
  { key: "quotes", label: "House quotes", hint: "Rotating quote carousel" },
  { key: "standards", label: "The Standard", hint: "Four pillar cards" },
  { key: "website_links", label: "Website links", hint: "Link to brand sites" },
  { key: "pin_login", label: "Quick PIN login", hint: "6-digit PIN tab" },
];

const ICON_OPTIONS = [
  "sparkles",
  "heart-handshake",
  "gem",
  "trending-up",
  "award",
  "shield-check",
  "star",
  "diamond",
  "globe",
];

const input =
  "w-full bg-text-primary/[0.04] border border-line/60 rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 transition-all placeholder:text-text-faint";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="micro mb-1.5 block">{label}</span>
      {children}
    </label>
  );
}

export function LoginEditorPage() {
  useBreadcrumbs([{ label: "Settings", href: "/settings" }, { label: "Login Editor" }]);
  const platform = usePlatformSettings(true);
  const save = useSavePlatformSettings();

  const initial: LoginConfig = useMemo(() => {
    const c = platform.data?.login_config ?? {};
    return {
      hero: { ...LOGIN_CONFIG_FALLBACK.hero, ...(c.hero ?? {}) },
      quotes: c.quotes?.length ? c.quotes : LOGIN_CONFIG_FALLBACK.quotes,
      standards: c.standards?.length
        ? c.standards
        : LOGIN_CONFIG_FALLBACK.standards,
      region_messages: {
        ...LOGIN_CONFIG_FALLBACK.region_messages,
        ...(c.region_messages ?? {}),
      },
      toggles: { ...LOGIN_CONFIG_FALLBACK.toggles, ...(c.toggles ?? {}) },
      background: { ...LOGIN_CONFIG_FALLBACK.background, ...(c.background ?? {}) },
    };
  }, [platform.data]);

  const [draft, setDraft] = useState<LoginConfig | null>(null);
  const cfg = draft ?? initial;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(initial);

  const patch = (next: Partial<LoginConfig>) =>
    setDraft({ ...cfg, ...next });

  if (platform.isLoading && !platform.data) {
    return (
      <div className="flex items-center gap-2 text-text-muted">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading login content…
      </div>
    );
  }

  const onSave = () =>
    save.mutate(
      { login_config: cfg },
      { onSuccess: () => setDraft(null) },
    );

  return (
    <div className="max-w-[820px] space-y-7 pb-28">
      <div>
        <Link
          to="/settings"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-text-muted hover:text-text-primary mb-3"
        >
          <ArrowLeft className="w-4 h-4" /> Appearance
        </Link>
        <h1 className="font-display text-[26px]">Login screen</h1>
        <p className="text-text-muted text-[13.5px] mt-1">
          Everything on the signed-out door is configured here — no code, no
          redeploy.
        </p>
      </div>

      {/* Hero copy */}
      <Card className="p-5 space-y-4">
        <div className="micro">Hero</div>
        <Field label="Eyebrow">
          <input
            className={input}
            value={cfg.hero?.eyebrow ?? ""}
            onChange={(e) => patch({ hero: { ...cfg.hero, eyebrow: e.target.value } })}
          />
        </Field>
        <Field label="Headline">
          <input
            className={input}
            value={cfg.hero?.headline ?? ""}
            onChange={(e) =>
              patch({ hero: { ...cfg.hero, headline: e.target.value } })
            }
          />
        </Field>
        <Field label="Subline">
          <textarea
            className={cn(input, "min-h-[72px] resize-y")}
            value={cfg.hero?.subline ?? ""}
            onChange={(e) =>
              patch({ hero: { ...cfg.hero, subline: e.target.value } })
            }
          />
        </Field>
        <Field label="Button label">
          <input
            className={cn(input, "max-w-[220px]")}
            value={cfg.hero?.cta_label ?? ""}
            onChange={(e) =>
              patch({ hero: { ...cfg.hero, cta_label: e.target.value } })
            }
          />
        </Field>
      </Card>

      {/* Toggles */}
      <Card className="p-5">
        <div className="micro mb-4">Show / hide</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {TOGGLE_FIELDS.map((tf) => {
            const on = cfg.toggles?.[tf.key] !== false;
            return (
              <button
                key={tf.key}
                onClick={() =>
                  patch({ toggles: { ...cfg.toggles, [tf.key]: !on } })
                }
                className={cn(
                  "flex items-center gap-3 p-3 rounded-xl border text-left transition-all",
                  on
                    ? "border-accent/40 bg-accent/[0.07]"
                    : "border-line/50 bg-text-primary/[0.02]",
                )}
              >
                <span
                  className={cn(
                    "grid place-items-center w-9 h-5 rounded-full transition-colors shrink-0",
                    on ? "bg-accent-deep" : "bg-text-primary/15",
                  )}
                >
                  <span
                    className={cn(
                      "w-4 h-4 rounded-full bg-[#F4E9D9] transition-transform",
                      on ? "translate-x-2" : "-translate-x-2",
                    )}
                  />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold">
                    {tf.label}
                  </span>
                  <span className="block text-[11px] text-text-faint truncate">
                    {tf.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Background */}
      <Card className="p-5 space-y-4">
        <div className="micro">Background</div>
        <div className="flex gap-2">
          {(["mesh", "image"] as const).map((style) => {
            const on = (cfg.background?.style ?? "mesh") === style;
            return (
              <button
                key={style}
                onClick={() =>
                  patch({ background: { ...cfg.background, style } })
                }
                className={cn(
                  "px-4 py-2 rounded-xl border text-[12.5px] font-semibold capitalize transition-all",
                  on
                    ? "border-accent/45 text-accent-glow bg-accent/[0.08]"
                    : "hairline text-text-muted hover:text-text-primary",
                )}
              >
                {style === "mesh" ? "Brand mesh" : "Image"}
              </button>
            );
          })}
        </div>
        {(cfg.background?.style ?? "mesh") === "image" && (
          <ImageUpload
            label="Login background image"
            value={cfg.background?.image_url ?? null}
            onChange={(url) =>
              patch({ background: { ...cfg.background, image_url: url } })
            }
            hint="A dark scrim is applied automatically to keep text legible. Large landscape image recommended."
          />
        )}
      </Card>

      {/* Quotes */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="micro">House quotes</div>
          <Button
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() =>
              patch({
                quotes: [...(cfg.quotes ?? []), { text: "", author: "" }],
              })
            }
          >
            Add quote
          </Button>
        </div>
        <div className="space-y-3">
          {(cfg.quotes ?? []).map((q: LoginQuote, i) => (
            <div key={i} className="flex gap-2 items-start">
              <GripVertical className="w-4 h-4 text-text-faint mt-2.5 shrink-0" />
              <div className="flex-1 space-y-2">
                <input
                  className={input}
                  placeholder="Quote text"
                  value={q.text}
                  onChange={(e) => {
                    const next = [...cfg.quotes!];
                    next[i] = { ...q, text: e.target.value };
                    patch({ quotes: next });
                  }}
                />
                <input
                  className={cn(input, "max-w-[280px]")}
                  placeholder="Author (optional)"
                  value={q.author ?? ""}
                  onChange={(e) => {
                    const next = [...cfg.quotes!];
                    next[i] = { ...q, author: e.target.value };
                    patch({ quotes: next });
                  }}
                />
              </div>
              <button
                aria-label="Remove quote"
                onClick={() =>
                  patch({ quotes: cfg.quotes!.filter((_, j) => j !== i) })
                }
                className="grid place-items-center w-8 h-8 rounded-lg text-text-faint hover:text-danger hover:bg-danger/10 mt-1"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          {(cfg.quotes?.length ?? 0) === 0 && (
            <p className="text-text-faint text-[12.5px]">No quotes yet.</p>
          )}
        </div>
      </Card>

      {/* Standards */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="micro">The Standard (pillars)</div>
          <Button
            size="sm"
            icon={<Plus className="w-3.5 h-3.5" />}
            onClick={() =>
              patch({
                standards: [
                  ...(cfg.standards ?? []),
                  { icon: "sparkles", title: "", body: "" },
                ],
              })
            }
          >
            Add pillar
          </Button>
        </div>
        <div className="space-y-3">
          {(cfg.standards ?? []).map((s: LoginStandard, i) => (
            <div
              key={i}
              className="grid grid-cols-[120px_1fr_auto] gap-2 items-start"
            >
              <select
                className={input}
                value={s.icon}
                onChange={(e) => {
                  const next = [...cfg.standards!];
                  next[i] = { ...s, icon: e.target.value };
                  patch({ standards: next });
                }}
              >
                {ICON_OPTIONS.map((ic) => (
                  <option key={ic} value={ic}>
                    {ic}
                  </option>
                ))}
              </select>
              <div className="space-y-2">
                <input
                  className={input}
                  placeholder="Title"
                  value={s.title}
                  onChange={(e) => {
                    const next = [...cfg.standards!];
                    next[i] = { ...s, title: e.target.value };
                    patch({ standards: next });
                  }}
                />
                <input
                  className={input}
                  placeholder="Body"
                  value={s.body}
                  onChange={(e) => {
                    const next = [...cfg.standards!];
                    next[i] = { ...s, body: e.target.value };
                    patch({ standards: next });
                  }}
                />
              </div>
              <button
                aria-label="Remove pillar"
                onClick={() =>
                  patch({ standards: cfg.standards!.filter((_, j) => j !== i) })
                }
                className="grid place-items-center w-8 h-8 rounded-lg text-text-faint hover:text-danger hover:bg-danger/10"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </Card>

      {/* Region messages */}
      <Card className="p-5">
        <div className="micro mb-1">Regional welcomes</div>
        <p className="text-text-faint text-[12px] mb-4">
          Shown by the visitor's detected continent (IP). The default covers
          unknown locations.
        </p>
        <div className="space-y-4">
          {CONTINENTS.map(({ code, label }) => {
            const rm = cfg.region_messages?.[code] ?? { welcome: "", note: "" };
            return (
              <div key={code} className="grid grid-cols-[120px_1fr] gap-3 items-start">
                <div className="text-[12.5px] font-semibold text-text-muted pt-2">
                  {label}
                </div>
                <div className="space-y-2">
                  <input
                    className={input}
                    placeholder="Welcome line"
                    value={rm.welcome}
                    onChange={(e) =>
                      patch({
                        region_messages: {
                          ...cfg.region_messages,
                          [code]: { ...rm, welcome: e.target.value },
                        },
                      })
                    }
                  />
                  <input
                    className={input}
                    placeholder="Note / context line"
                    value={rm.note}
                    onChange={(e) =>
                      patch({
                        region_messages: {
                          ...cfg.region_messages,
                          [code]: { ...rm, note: e.target.value },
                        },
                      })
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <p className="text-text-faint text-[12px]">
        Business names, logos and website links come from each business's setup
        (Settings → Appearance / Business). Fill a business's website to show its
        link on the login screen.
      </p>

      {/* Sticky save bar */}
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-30">
        <div className="dropglass rounded-full shadow-glass flex items-center gap-3 pl-5 pr-2 py-2">
          <span className="text-[12.5px] text-text-muted">
            {save.isSuccess && !dirty ? (
              <span className="inline-flex items-center gap-1.5 text-success">
                <Check className="w-4 h-4" /> Saved
              </span>
            ) : dirty ? (
              "Unsaved changes"
            ) : (
              "All changes saved"
            )}
          </span>
          <Button
            variant="primary"
            size="sm"
            disabled={!dirty || save.isPending}
            onClick={onSave}
            icon={
              save.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )
            }
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
