/**
 * Theme presets — the canonical list of ready-made palettes.
 *
 * One source of truth for two consumers (canon "single source of truth"):
 *   • Settings → Appearance (admin) — writes a preset into the shared
 *     Layer-A platform row, re-skinning the ERP for everyone.
 *   • The account-menu Appearance picker (any user) — applies a preset as a
 *     personal, client-side override on top of the platform default, so a
 *     user without Settings access can choose how the Hub looks for them
 *     without touching the logo, fonts, or anyone else's view.
 *
 * A preset only patches COLOUR tokens; it never carries a logo, product
 * name, or font — those stay platform white-label identity (Layer A).
 */

import type { ColourToken, ThemeMode, ThemeTokens } from "@/lib/branding";

export interface ThemePreset {
  /** Stable identifier persisted as the user's personal choice. */
  name: string;
  desc: string;
  mode: ThemeMode;
  patch: ThemeTokens;
}

export const THEME_PRESETS: ReadonlyArray<ThemePreset> = [
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

/** The three swatch tokens shown on a preset card. */
export const PRESET_SWATCHES: readonly ColourToken[] = ["bg", "accent", "text"];

/** Look up a preset by its persisted name. */
export function findPreset(name: string | null | undefined): ThemePreset | undefined {
  if (!name) return undefined;
  return THEME_PRESETS.find((p) => p.name === name);
}
