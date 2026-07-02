/**
 * Floating toolbar config.
 *
 * A draggable glass cluster of circular buttons (currency, theme, WhatsApp,
 * help) pinned to the viewport edge on every storefront page — ported from the
 * sale-landing concept and restyled with the maison tokens.
 *
 * It's Studio-editable: the config lives inside the published theme tokens under
 * `tokens.toolbar` (a free-form JSONB slice), edited in Storefront Studio →
 * Toolbar. `resolveToolbar` merges whatever Studio published over the baked
 * defaults, tolerating partial/legacy shapes so the toolbar always renders.
 */

export type ToolbarDock = "left" | "right";

export interface ToolbarHelpStep {
  title: string;
  body: string;
}

export interface ToolbarConfig {
  enabled: boolean;
  dock: ToolbarDock;
  buttons: {
    currency: boolean;
    theme: boolean;
    whatsapp: boolean;
    help: boolean;
  };
  whatsapp: { number: string; greeting: string };
  help: { title: string; steps: ToolbarHelpStep[] };
}

export const DEFAULT_HELP_STEPS: ToolbarHelpStep[] = [
  { title: "Browse the maison", body: "Explore the catalogue, bundles and shades. Tap any piece to see photos, details and sizing." },
  { title: "Choose your options", body: "Pick your length, texture or shade — the price updates live as you choose." },
  { title: "Add to bag", body: "Tap Add to bag. Your currency (₦ or $) follows the toggle on this toolbar." },
  { title: "Checkout securely", body: "Open your bag, tap Checkout, add delivery details and pay. We ship worldwide from Lagos." },
];

export const DEFAULT_TOOLBAR: ToolbarConfig = {
  enabled: true,
  dock: "left",
  buttons: { currency: true, theme: true, whatsapp: true, help: true },
  whatsapp: {
    number: "",
    greeting: "Hi! I'd love some help choosing the right piece.",
  },
  help: { title: "How to shop", steps: DEFAULT_HELP_STEPS },
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === "boolean" ? v : fallback;

/** Keep only WhatsApp digits (wa.me wants a bare international number). */
export function waDigits(raw: string): string {
  return (raw || "").replace(/[^\d]/g, "");
}

function resolveSteps(raw: unknown): ToolbarHelpStep[] {
  if (!Array.isArray(raw)) return DEFAULT_HELP_STEPS;
  const steps = raw
    .map((x): ToolbarHelpStep | null => {
      if (!x || typeof x !== "object") return null;
      const o = x as Record<string, unknown>;
      const title = str(o.title);
      const body = str(o.body);
      if (!title && !body) return null;
      return { title, body };
    })
    .filter((x): x is ToolbarHelpStep => x !== null);
  return steps.length ? steps : DEFAULT_HELP_STEPS;
}

/**
 * Merge the Studio `tokens.toolbar` slice over the defaults. `fallbackWhatsApp`
 * is the brand's WhatsApp from nav socials, used when Studio hasn't set a number.
 */
export function resolveToolbar(
  raw: unknown,
  fallbackWhatsApp?: string,
): ToolbarConfig {
  const d = DEFAULT_TOOLBAR;
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const buttons = (o.buttons && typeof o.buttons === "object"
    ? o.buttons
    : {}) as Record<string, unknown>;
  const wa = (o.whatsapp && typeof o.whatsapp === "object"
    ? o.whatsapp
    : {}) as Record<string, unknown>;
  const help = (o.help && typeof o.help === "object"
    ? o.help
    : {}) as Record<string, unknown>;

  const number = waDigits(str(wa.number)) || waDigits(fallbackWhatsApp || "");

  return {
    enabled: bool(o.enabled, d.enabled),
    dock: o.dock === "right" ? "right" : "left",
    buttons: {
      currency: bool(buttons.currency, d.buttons.currency),
      theme: bool(buttons.theme, d.buttons.theme),
      whatsapp: bool(buttons.whatsapp, d.buttons.whatsapp),
      help: bool(buttons.help, d.buttons.help),
    },
    whatsapp: {
      number,
      greeting: str(wa.greeting) || d.whatsapp.greeting,
    },
    help: {
      title: str(help.title) || d.help.title,
      steps: resolveSteps(help.steps),
    },
  };
}
