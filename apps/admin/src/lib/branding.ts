/**
 * Branding — types, queries, mutations, and the token allow-list
 * that mirrors the backend validator (one source of truth on the
 * server; we keep a copy here so the UI can build the right inputs
 * and validate locally before a round-trip).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ── Token allow-list (mirrors src/modules/platform_settings/platform-settings.validator.js)
export const COLOUR_TOKENS = [
  "bg",
  "panel",
  "panel-2",
  "text",
  "text-muted",
  "text-faint",
  "border-c",
  "accent",
  "accent-deep",
  "accent-glow",
  "sage",
  "rose",
  "info",
  "success",
  "warn",
  "danger",
] as const;
export const SCALAR_TOKENS = ["panel-alpha", "border-alpha", "mesh-op"] as const;

export type ColourToken = (typeof COLOUR_TOKENS)[number];
export type ScalarToken = (typeof SCALAR_TOKENS)[number];

export type ThemeMode = "dark" | "light";
export type ThemeTokens = Partial<
  Record<ColourToken | ScalarToken, string>
>;
export type Theme = Partial<Record<ThemeMode, ThemeTokens>>;

export interface PlatformBranding {
  product_name: string;
  tagline: string | null;
  company_name: string | null;
  logo_dark_url: string | null;
  logo_light_url: string | null;
  favicon_url: string | null;
  font_display: string;
  font_body: string;
  font_mono: string;
  font_css_url: string | null;
  theme: Theme;
  updated_at?: string;
}

export interface BusinessBranding {
  business_key: string;
  display_name: string;
  accent_colour: string | null;
  secondary_colour: string | null;
  logo_path: string | null;
  logo_alt_path: string | null;
  favicon_path: string | null;
  brand_theme: {
    grad1?: string;
    grad2?: string;
    accent?: string;
    accent_deep?: string;
  } | null;
  brand_fonts: { display?: string; body?: string; mono?: string } | null;
}

export interface BrandingPayload {
  platform: PlatformBranding | null;
  businesses: BusinessBranding[];
}

export interface FontCatalogItem {
  font_id: string;
  family: string;
  css_value: string;
  loader_url: string | null;
  category: "display" | "sans" | "serif" | "mono";
  use_hint: string | null;
  is_active: boolean;
  display_order: number;
}

// ── Public branding (unauthenticated; safe at app boot) ────
export function useBranding() {
  return useQuery<BrandingPayload>({
    queryKey: ["branding"],
    queryFn: () => api.get<BrandingPayload>("/branding", "public"),
    staleTime: 60_000,
  });
}

// ── Protected: full platform settings (auth-gated) ────────
export function usePlatformSettings(enabled = true) {
  return useQuery<PlatformBranding>({
    queryKey: ["platform-settings"],
    queryFn: () => api.get<PlatformBranding>("/platform-settings"),
    enabled,
  });
}

export function useFontCatalog() {
  return useQuery<FontCatalogItem[]>({
    queryKey: ["font-catalog"],
    queryFn: () => api.get<FontCatalogItem[]>("/platform-settings/fonts"),
    staleTime: 5 * 60_000,
  });
}

export function useSavePlatformSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<PlatformBranding>) =>
      api.patch<PlatformBranding>("/platform-settings", patch),
    onSuccess: () => {
      // Branding feed + protected detail both depend on the same row.
      qc.invalidateQueries({ queryKey: ["branding"] });
      qc.invalidateQueries({ queryKey: ["platform-settings"] });
    },
  });
}

// ── Per-brand branding (Layer B) — flows through business-setup
//    /config, which already audits + emits events on the backend.
export type BusinessConfigPatch = Partial<{
  accent_colour: string;
  secondary_colour: string | null;
  logo_path: string | null;
  logo_alt_path: string | null;
  favicon_path: string | null;
  brand_theme: BusinessBranding["brand_theme"];
  brand_fonts: BusinessBranding["brand_fonts"];
  mission_statement: string;
  display_name: string;
}>;

export function useSaveBusinessBranding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: BusinessConfigPatch) =>
      api.patch<unknown>("/business-setup/config", patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branding"] });
    },
  });
}

// ── Local-only helpers ────────────────────────────────────
const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

/** Convert a #rrggbb (or rrggbb) hex string to the "R G B" triplet
 *  the CSS variables expect. Returns null for invalid input. */
export function hexToTriplet(hex: string): string | null {
  if (!HEX_RE.test(hex)) return null;
  const h = hex.replace("#", "");
  return `${parseInt(h.slice(0, 2), 16)} ${parseInt(h.slice(2, 4), 16)} ${parseInt(h.slice(4, 6), 16)}`;
}

/** Convert an "R G B" triplet back to a #rrggbb hex. Used by the
 *  Appearance UI to seed colour-picker inputs from the loaded theme. */
export function tripletToHex(triplet: string): string {
  const m = /^(\d{1,3}) (\d{1,3}) (\d{1,3})$/.exec(triplet.trim());
  if (!m) return "#000000";
  const toHex = (n: string) =>
    Math.min(255, Math.max(0, parseInt(n, 10)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`;
}

// ── Trusted font CSS hosts — mirrors the backend allow-list so the
//    UI can warn on paste rather than waiting for a server 400.
export const FONT_HOST_ALLOWLIST = [
  "fonts.googleapis.com",
  "fonts.bunny.net",
  "use.typekit.net",
  "rsms.me",
];

export function isAllowedFontUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === "https:" &&
      FONT_HOST_ALLOWLIST.includes(u.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}
