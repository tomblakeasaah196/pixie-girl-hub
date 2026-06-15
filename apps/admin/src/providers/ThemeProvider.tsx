import { useEffect, type ReactNode } from "react";
import { useUiStore } from "@/stores/ui";
import { useActiveBusiness } from "@/stores/business";
import {
  useBranding,
  COLOUR_TOKENS,
  SCALAR_TOKENS,
  type ThemeMode,
  type ThemeTokens,
} from "@/lib/branding";
import { loadFontStylesheet } from "@/lib/font-loader";

/**
 * Applies the two-layer theme to the document (canon §2.3).
 *
 *  Layer A — platform skin / white-label. Loaded from
 *    GET /api/public/branding (no auth) so it works pre-login.
 *    Applies the `theme[mode]` token bag plus fonts + favicon.
 *
 *  Layer B — per-business accent. Reads from the same branding
 *    payload's `businesses[]` array, picking the active brand by
 *    its persisted key in the business store.
 *
 *  Both layers fall back to the in-CSS defaults (Maroon Noir +
 *  Pixie red) so a cold load with the API unreachable still
 *  renders correctly.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useUiStore((s) => s.theme);
  const density = useUiStore((s) => s.density);
  const biz = useActiveBusiness();
  const branding = useBranding();

  // Layer-A skin: data-theme / data-density on <html>.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.density = density;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const bgToken =
        branding.data?.platform?.theme?.[theme as ThemeMode]?.bg ??
        (theme === "dark" ? "15 8 9" : "251 250 249");
      meta.setAttribute("content", `rgb(${bgToken.replace(/ /g, ",")})`);
    }
  }, [theme, density, branding.data]);

  // Layer-A tokens: paint the active mode's token bag onto :root.
  // We rewrite the CSS variables in place; index.css supplies the
  // baseline so a missing token simply keeps its file-defined default.
  useEffect(() => {
    const tokens: ThemeTokens | undefined =
      branding.data?.platform?.theme?.[theme as ThemeMode];
    if (!tokens) return;
    const root = document.documentElement;
    for (const t of COLOUR_TOKENS) {
      const v = tokens[t];
      if (v) root.style.setProperty(`--${t}`, v);
    }
    for (const t of SCALAR_TOKENS) {
      const v = tokens[t];
      if (v) root.style.setProperty(`--${t}`, v);
    }
  }, [theme, branding.data]);

  // Layer-A fonts + external font CSS.
  useEffect(() => {
    const p = branding.data?.platform;
    if (!p) return;
    const root = document.documentElement;
    root.style.setProperty("--font-display", p.font_display);
    root.style.setProperty("--font-body", p.font_body);
    root.style.setProperty("--font-mono", p.font_mono);
    loadFontStylesheet(p.font_css_url);
  }, [branding.data]);

  // Layer-A document title + PWA name — reflect the dynamic product
  // name (canon: app name is DB-driven). Falls back to the static
  // title baked into index.html when branding hasn't loaded.
  useEffect(() => {
    const name = branding.data?.platform?.product_name;
    if (name) document.title = name;
  }, [branding.data]);

  // Layer-A favicon — swaps to whichever mode is active so a brand
  // can ship a cream mark for dark and a deep mark for light. Prefers
  // a dedicated favicon when set, else the mode logo. Leaves the static
  // /favicon.svg (linked in index.html) in place when nothing is set,
  // so there's always an icon and never a 404.
  useEffect(() => {
    const p = branding.data?.platform;
    if (!p) return;
    const url =
      p.favicon_url ??
      (theme === "dark" ? p.logo_dark_url : p.logo_light_url) ??
      null;
    if (!url) return;
    const ensure = (rel: string): HTMLLinkElement => {
      let el = document.querySelector(
        `link[rel="${rel}"]`,
      ) as HTMLLinkElement | null;
      if (!el) {
        el = document.createElement("link");
        el.rel = rel;
        document.head.appendChild(el);
      }
      return el;
    };
    const icon = ensure("icon");
    // The branding asset is a raster URL; drop the SVG type from the
    // static default so the browser doesn't mis-sniff it.
    icon.removeAttribute("type");
    icon.href = url;
    ensure("apple-touch-icon").href = url;
  }, [theme, branding.data]);

  // Layer-B accent: gradient + accent for the active business chip /
  // ambient wash. Hex values (used in linear-gradient()), not triplets.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--biz-1", biz.grad1);
    root.style.setProperty("--biz-2", biz.grad2);
    root.style.setProperty("--biz-accent", biz.accent);
  }, [biz.key, biz.grad1, biz.grad2, biz.accent]);

  return <>{children}</>;
}
