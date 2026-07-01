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
export const SCALAR_TOKENS = [
  "panel-alpha",
  "border-alpha",
  "mesh-op",
] as const;

export type ColourToken = (typeof COLOUR_TOKENS)[number];
export type ScalarToken = (typeof SCALAR_TOKENS)[number];

export type ThemeMode = "dark" | "light";
export type ThemeTokens = Partial<Record<ColourToken | ScalarToken, string>>;
export type Theme = Partial<Record<ThemeMode, ThemeTokens>>;

// ── Login page content (DB-driven; canon "little/no hardcoded data") ──
// Mirrors platform_settings.login_config seeded in migration 000209.
export interface LoginQuote {
  text: string;
  author?: string;
}
export interface LoginStandard {
  /** lucide-react icon name (kebab-case), resolved by the renderer. */
  icon: string;
  title: string;
  body: string;
}
export interface LoginRegionMessage {
  welcome: string;
  note: string;
}
export interface LoginToggles {
  splash?: boolean;
  particles?: boolean;
  quotes?: boolean;
  standards?: boolean;
  pin_login?: boolean;
  website_links?: boolean;
  geo_welcome?: boolean;
  business_badges?: boolean;
}
export interface LoginConfig {
  hero?: {
    eyebrow?: string;
    headline?: string;
    subline?: string;
    cta_label?: string;
  };
  quotes?: LoginQuote[];
  standards?: LoginStandard[];
  /** Keyed by 2-letter continent code (AF/AS/EU/NA/SA/OC/AN) + "default". */
  region_messages?: Record<string, LoginRegionMessage>;
  toggles?: LoginToggles;
  background?: { style?: "mesh" | "image"; image_url?: string | null };
}

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
  login_config?: LoginConfig | null;
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
  /** Public marketing site (shown on the logged-out screen when filled). */
  website?: string | null;
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
  website: string | null;
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

// ── Login content — DB-driven, with a graceful built-in fallback so a
//    cold load (API unreachable) still renders a complete, on-brand
//    login screen. The DB seed (migration 000209) is the source of truth.
export const LOGIN_CONFIG_FALLBACK: Required<
  Pick<LoginConfig, "hero" | "quotes" | "standards" | "toggles" | "background">
> & { region_messages: Record<string, LoginRegionMessage> } = {
  hero: {
    eyebrow: "PIXIE GIRL HUB",
    headline: "Where beauty becomes an operation.",
    subline:
      "One command center for Pixie Girl Global and Faitlyn Hair — sales, stylists, stock, and storefronts, in concert.",
    cta_label: "Access Hub",
  },
  quotes: [
    { text: "Luxury is in each detail.", author: "Hubert de Givenchy" },
    { text: "Two brands, one vision — always forward.", author: "Pixie Girl" },
    {
      text: "Craft is care made visible.",
      author: "The House",
    },
  ],
  standards: [
    {
      icon: "sparkles",
      title: "Craftsmanship",
      body: "Every detail considered, every finish intentional.",
    },
    {
      icon: "heart-handshake",
      title: "Relationships",
      body: "Built on trust, sustained by excellence.",
    },
    {
      icon: "gem",
      title: "Provenance",
      body: "Curated hair, traceable origins, honest quality.",
    },
    {
      icon: "trending-up",
      title: "Momentum",
      body: "Two brands, one vision — always forward.",
    },
  ],
  region_messages: {
    default: {
      welcome: "Welcome",
      note: "Two brands, one vision — always forward.",
    },
  },
  toggles: {
    splash: true,
    particles: true,
    quotes: true,
    standards: true,
    pin_login: true,
    website_links: true,
    geo_welcome: true,
    business_badges: true,
  },
  background: { style: "mesh", image_url: null },
};

/** Resolve the login content from the branding payload, layering the
 *  DB config over the fallback so partial configs never blank the page. */
export function useLoginConfig(): LoginConfig {
  const { data } = useBranding();
  const cfg = data?.platform?.login_config ?? {};
  return {
    hero: { ...LOGIN_CONFIG_FALLBACK.hero, ...(cfg.hero ?? {}) },
    quotes: cfg.quotes?.length ? cfg.quotes : LOGIN_CONFIG_FALLBACK.quotes,
    standards: cfg.standards?.length
      ? cfg.standards
      : LOGIN_CONFIG_FALLBACK.standards,
    region_messages: {
      ...LOGIN_CONFIG_FALLBACK.region_messages,
      ...(cfg.region_messages ?? {}),
    },
    toggles: { ...LOGIN_CONFIG_FALLBACK.toggles, ...(cfg.toggles ?? {}) },
    background: {
      ...LOGIN_CONFIG_FALLBACK.background,
      ...(cfg.background ?? {}),
    },
  };
}

// ── Branding image upload (logos, favicon, login background) ──
// POSTs to /platform-settings/upload-image and returns the stored public
// URL, which the caller then saves onto the relevant settings field.
export async function uploadBrandingImage(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const { url } = await api.postForm<{ url: string }>(
    "/platform-settings/upload-image",
    form,
    { onProgress },
  );
  return url;
}

// ── Logo upload + icon generation ─────────────────────────
// Uploads a master logo with purpose=logo; the backend makes the
// background transparent and generates the favicon.ico + PWA icon set.
// Returns the cleaned display-logo URL plus the derived favicon and a
// transparency note the UI surfaces.
export interface LogoUploadResult {
  url: string;
  favicon_url: string;
  icons: {
    favicon: string;
    favicon64: string;
    icon192: string;
    icon512: string;
    maskable512: string;
    apple: string;
  };
  transparency: { hadAlpha: boolean; keyed: boolean; warning: string | null };
}

export async function uploadBrandingLogo(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<LogoUploadResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("purpose", "logo");
  return api.postForm<LogoUploadResult>(
    "/platform-settings/upload-image",
    form,
    { onProgress },
  );
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

// ── Contrast-safe brand colour ────────────────────────────
// A brand accent (e.g. a deep navy or maroon) can be illegible on the
// dark login backdrop — or a pale brand colour on a light theme. These
// helpers keep the brand hue but nudge lightness until it clears a WCAG
// legibility threshold against the active background.

function parseHex(hex: string): [number, number, number] | null {
  if (!HEX_RE.test(hex)) return null;
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

const chToHex = (n: number) =>
  Math.min(255, Math.max(0, Math.round(n)))
    .toString(16)
    .padStart(2, "0");

/** WCAG relative luminance of an sRGB colour (0..1). */
function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : ((cs + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(l1: number, l2: number): number {
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Return a readable variant of `hex` for the given theme: keeps the hue but
 * blends toward cream (dark bg) or near-black (light bg) until it clears a
 * ~4.5:1 contrast ratio. Already-legible colours are returned unchanged.
 */
export function readableAccent(hex: string, dark: boolean, min = 4.5): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  // Approximate the login/app background luminance per theme.
  const bgL = dark ? 0.02 : 0.94;
  const target = dark ? [244, 233, 217] : [15, 8, 9]; // cream / near-black
  let [r, g, b] = rgb;
  for (let i = 0; i < 16; i += 1) {
    if (contrastRatio(relativeLuminance(r, g, b), bgL) >= min) break;
    r += (target[0] - r) * 0.16;
    g += (target[1] - g) * 0.16;
    b += (target[2] - b) * 0.16;
  }
  return `#${chToHex(r)}${chToHex(g)}${chToHex(b)}`;
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
