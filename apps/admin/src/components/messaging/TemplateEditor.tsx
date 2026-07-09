import { Plus, Trash2, Info } from "lucide-react";
import {
  CATEGORY_META,
  detectPositionalVars,
  type TemplateComponent,
  type WhatsAppTemplate,
  type TemplateCategory,
} from "@/lib/whatsapp-templates-api";

/**
 * Shared WhatsApp-template editor form + component (de)serialisers.
 *
 * Meta represents a template as an array of typed components
 * (HEADER / BODY / FOOTER / BUTTONS). Authoring that raw JSON by hand is
 * error-prone, so the UI works with a flat `TemplateForm` and converts
 * to/from Meta's shape here. Body uses positional {{1}} {{2}} variables —
 * Meta's convention — which the composer prompts the rep to fill at send.
 */

export interface TemplateButton {
  type: "QUICK_REPLY" | "URL";
  text: string;
  url?: string;
}

export interface TemplateForm {
  name: string;
  language: string;
  category: TemplateCategory;
  header: string;
  body: string;
  footer: string;
  buttons: TemplateButton[];
}

export function emptyForm(): TemplateForm {
  return {
    name: "",
    language: "en_US",
    category: "UTILITY",
    header: "",
    body: "",
    footer: "",
    buttons: [],
  };
}

const LANGUAGES = [
  { code: "en_US", label: "English (US)" },
  { code: "en_GB", label: "English (UK)" },
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
  { code: "ha", label: "Hausa" },
  { code: "ig", label: "Igbo" },
  { code: "yo", label: "Yoruba" },
];

/** Flat form → Meta components array. */
export function buildComponents(form: TemplateForm): TemplateComponent[] {
  const components: TemplateComponent[] = [];
  if (form.header.trim()) {
    components.push({ type: "HEADER", format: "TEXT", text: form.header.trim() });
  }
  components.push({ type: "BODY", text: form.body.trim() });
  if (form.footer.trim()) {
    components.push({ type: "FOOTER", text: form.footer.trim() });
  }
  const buttons = form.buttons
    .filter((b) => b.text.trim())
    .map((b) =>
      b.type === "URL"
        ? { type: "URL", text: b.text.trim(), url: (b.url || "").trim() }
        : { type: "QUICK_REPLY", text: b.text.trim() },
    );
  if (buttons.length) {
    components.push({ type: "BUTTONS", buttons });
  }
  return components;
}

/** Meta template row → flat form (for editing). */
export function parseTemplate(tpl: WhatsAppTemplate): TemplateForm {
  const comp = (type: string) =>
    (tpl.components || []).find((c) => (c.type || "").toUpperCase() === type);
  const header = comp("HEADER");
  const body = comp("BODY");
  const footer = comp("FOOTER");
  const buttonsC = comp("BUTTONS");
  const buttons: TemplateButton[] = ((buttonsC?.buttons as Array<Record<string, unknown>>) || []).map(
    (b) => ({
      type: (String(b.type).toUpperCase() === "URL" ? "URL" : "QUICK_REPLY") as
        | "URL"
        | "QUICK_REPLY",
      text: String(b.text || ""),
      url: b.url ? String(b.url) : undefined,
    }),
  );
  return {
    name: tpl.name,
    language: tpl.language,
    category: tpl.category,
    header: header?.text || "",
    body: body?.text || "",
    footer: footer?.text || "",
    buttons,
  };
}

export function TemplateEditorFields({
  form,
  onChange,
  lockName,
}: {
  form: TemplateForm;
  onChange: (f: TemplateForm) => void;
  lockName?: boolean;
}) {
  const set = (patch: Partial<TemplateForm>) => onChange({ ...form, ...patch });
  const vars = detectPositionalVars(buildComponents(form));

  return (
    <div className="space-y-3.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-[11.5px] text-text-muted mb-1">
            Template name
          </span>
          <input
            value={form.name}
            disabled={lockName}
            onChange={(e) =>
              set({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })
            }
            placeholder="order_shipped_update"
            className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13.5px] font-mono focus:outline-none focus:border-accent/40 disabled:opacity-60"
            autoComplete="off"
          />
          {lockName ? (
            <p className="text-[10.5px] text-text-faint mt-1">
              Name is Meta&rsquo;s addressing key — can&rsquo;t change after creation.
            </p>
          ) : (
            <p className="text-[10.5px] text-text-faint mt-1">
              Lowercase letters, numbers &amp; underscores only.
            </p>
          )}
        </label>
        <label className="block">
          <span className="block text-[11.5px] text-text-muted mb-1">Language</span>
          <select
            value={form.language}
            onChange={(e) => set({ language: e.target.value })}
            className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13.5px] focus:outline-none focus:border-accent/40"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label} ({l.code})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <span className="block text-[11.5px] text-text-muted mb-1">Category</span>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {(["UTILITY", "MARKETING", "AUTHENTICATION"] as TemplateCategory[]).map(
            (cat) => {
              const meta = CATEGORY_META[cat];
              const active = form.category === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => set({ category: cat })}
                  className={`text-left rounded-xl border px-3 py-2 transition-colors ${
                    active
                      ? "border-accent/50 bg-accent/10"
                      : "border-border/60 bg-panel-2 hover:border-accent/30"
                  }`}
                >
                  <div className="text-[12.5px] font-medium">{meta.label}</div>
                  <div className="text-[10.5px] text-text-faint leading-snug mt-0.5">
                    {meta.blurb}
                  </div>
                </button>
              );
            },
          )}
        </div>
      </div>

      <label className="block">
        <span className="block text-[11.5px] text-text-muted mb-1">
          Header <span className="text-text-faint">(optional)</span>
        </span>
        <input
          value={form.header}
          onChange={(e) => set({ header: e.target.value })}
          placeholder="Your order is on its way 🚚"
          className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13px] focus:outline-none focus:border-accent/40"
        />
      </label>

      <label className="block">
        <span className="block text-[11.5px] text-text-muted mb-1">
          Body <span className="text-danger">*</span>
        </span>
        <textarea
          value={form.body}
          onChange={(e) => set({ body: e.target.value })}
          placeholder={"Hi {{1}}, your order {{2}} has shipped and will arrive in {{3}} days. Track it anytime — thank you for shopping with us! 🌹"}
          rows={5}
          className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13px] focus:outline-none focus:border-accent/40"
        />
        <div className="mt-1 flex items-start gap-1.5 text-[10.5px] text-text-faint">
          <Info className="w-3 h-3 mt-[1px] shrink-0" />
          <span>
            Use numbered placeholders{" "}
            <code className="font-mono bg-panel-2 px-1 rounded">{"{{1}}"}</code>{" "}
            <code className="font-mono bg-panel-2 px-1 rounded">{"{{2}}"}</code>{" "}
            for values filled in at send time.
            {vars.length > 0 && (
              <>
                {" "}
                Detected: {vars.map((v) => `{{${v}}}`).join(" ")}
              </>
            )}
          </span>
        </div>
      </label>

      <label className="block">
        <span className="block text-[11.5px] text-text-muted mb-1">
          Footer <span className="text-text-faint">(optional)</span>
        </span>
        <input
          value={form.footer}
          onChange={(e) => set({ footer: e.target.value })}
          placeholder="Reply STOP to opt out"
          className="w-full rounded-xl bg-panel-2 border hairline px-3 py-2 text-[13px] focus:outline-none focus:border-accent/40"
        />
      </label>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11.5px] text-text-muted">
            Buttons <span className="text-text-faint">(optional, max 3)</span>
          </span>
          {form.buttons.length < 3 && (
            <button
              type="button"
              onClick={() =>
                set({
                  buttons: [
                    ...form.buttons,
                    { type: "QUICK_REPLY", text: "" },
                  ],
                })
              }
              className="text-[11.5px] text-accent-glow inline-flex items-center gap-1 hover:underline"
            >
              <Plus className="w-3 h-3" /> Add button
            </button>
          )}
        </div>
        <div className="space-y-2">
          {form.buttons.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <select
                value={b.type}
                onChange={(e) => {
                  const next = [...form.buttons];
                  next[i] = { ...b, type: e.target.value as TemplateButton["type"] };
                  set({ buttons: next });
                }}
                className="rounded-lg bg-panel-2 border hairline px-2 py-1.5 text-[12px] focus:outline-none"
              >
                <option value="QUICK_REPLY">Quick reply</option>
                <option value="URL">URL</option>
              </select>
              <input
                value={b.text}
                onChange={(e) => {
                  const next = [...form.buttons];
                  next[i] = { ...b, text: e.target.value };
                  set({ buttons: next });
                }}
                placeholder="Button text"
                className="flex-1 rounded-lg bg-panel-2 border hairline px-2.5 py-1.5 text-[12.5px] focus:outline-none focus:border-accent/40"
              />
              {b.type === "URL" && (
                <input
                  value={b.url || ""}
                  onChange={(e) => {
                    const next = [...form.buttons];
                    next[i] = { ...b, url: e.target.value };
                    set({ buttons: next });
                  }}
                  placeholder="https://…"
                  className="flex-1 rounded-lg bg-panel-2 border hairline px-2.5 py-1.5 text-[12.5px] font-mono focus:outline-none focus:border-accent/40"
                />
              )}
              <button
                type="button"
                onClick={() =>
                  set({ buttons: form.buttons.filter((_, j) => j !== i) })
                }
                className="p-1.5 text-text-faint hover:text-danger"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
