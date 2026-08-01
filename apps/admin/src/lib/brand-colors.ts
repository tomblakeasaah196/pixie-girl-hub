/**
 * Brand colour palette for the mail editor — sourced from the Storefront
 * Studio Branding/Theme tab (the same CSS variables the live website paints
 * with), so the colours a marketing officer can pick in an email are exactly
 * the ones set for the brand's site. Falls back to the storefront's shipped
 * defaults when a variable is unset or the user can't read the studio API.
 *
 * Email HTML needs hex, the storefront stores `oklch(…)` — so this converts.
 */

import { useMemo } from "react";
import { pickActive, useThemes } from "@/lib/storefront-studio";

export interface BrandSwatch {
  label: string;
  hex: string;
}

/** Mirror of the Storefront Studio colour controls (label → CSS var + shipped
 *  default). Keep in step with StorefrontStudioPage's CORE/ACCENT_COLORS. */
const PALETTE_DEFS: { label: string; key: string; def: string }[] = [
  { label: "Primary", key: "--taupe", def: "oklch(0.82 0.045 60)" },
  { label: "Soft accent", key: "--champagne", def: "oklch(0.71 0.06 60)" },
  { label: "Gold highlight", key: "--gold", def: "oklch(0.78 0.11 75)" },
  { label: "Rose", key: "--rose", def: "oklch(0.62 0.13 18)" },
  { label: "Deep burgundy", key: "--burgundy", def: "oklch(0.32 0.11 25)" },
  { label: "Main text", key: "--cream", def: "oklch(0.96 0.018 80)" },
  { label: "Subtle text", key: "--muted-foreground", def: "oklch(0.68 0.025 70)" },
  { label: "Page background", key: "--ink", def: "oklch(0.14 0.012 60)" },
  { label: "Cards & panels", key: "--card", def: "oklch(0.18 0.012 60)" },
  { label: "Muted surfaces", key: "--secondary", def: "oklch(0.22 0.015 60)" },
  { label: "Lines & dividers", key: "--border", def: "oklch(0.28 0.015 60)" },
];

// ── Colour parsing (oklch / hex / rgb → #rrggbb) ────────────

function srgbChannel(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.min(255, Math.max(0, Math.round(v * 255)));
}

function oklchToHex(L: number, C: number, Hdeg: number): string {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const toHex = (n: number) => srgbChannel(n).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`;
}

/** Best-effort CSS colour → #rrggbb; null when unparseable. */
export function cssColorToHex(value: string | undefined): string | null {
  const v = String(value ?? "").trim();
  if (!v) return null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const h = hex[1];
    return h.length === 3
      ? `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`.toLowerCase()
      : `#${h}`.toLowerCase();
  }
  const ok = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/[^)]*)?\)$/i.exec(v);
  if (ok) {
    const L = ok[1].endsWith("%") ? parseFloat(ok[1]) / 100 : parseFloat(ok[1]);
    return oklchToHex(L, parseFloat(ok[2]), parseFloat(ok[3]));
  }
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(v);
  if (rgb) {
    const toHex = (n: string) =>
      Math.min(255, parseInt(n, 10)).toString(16).padStart(2, "0");
    return `#${toHex(rgb[1])}${toHex(rgb[2])}${toHex(rgb[3])}`;
  }
  return null;
}

/** The brand's swatches for the mail editor's colour menu. */
export function useBrandPalette(): BrandSwatch[] {
  const themesQ = useThemes();
  const tokens = pickActive(themesQ.data)?.tokens;
  return useMemo(
    () =>
      PALETTE_DEFS.flatMap((d) => {
        const hex = cssColorToHex(tokens?.[d.key]) ?? cssColorToHex(d.def);
        return hex ? [{ label: d.label, hex }] : [];
      }),
    [tokens],
  );
}
