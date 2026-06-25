"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import type { LandingConfig } from "@landing-kit";
import { hexToTriplet, fontStack, fontHrefs } from "@landing-kit";

/** Parse "#rrggbb" → [r,g,b]. Falls back to black on a malformed value. */
function parseHex(hex: string | null | undefined): [number, number, number] {
  if (!hex) return [0, 0, 0];
  const h = hex.replace("#", "");
  if (h.length < 6) return [0, 0, 0];
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * Blend two brand hex colours and return the "r g b" triplet the token system
 * expects. Used to derive *readable* secondary-text tones from the brand's own
 * ink + paper, instead of the brand "muted" swatch — which on the light Atelier
 * palette is a pale greige that fails WCAG on cream (≈1.6:1). Mixing ink toward
 * paper keeps the tone on-brand while guaranteeing contrast (0.30 ≈ 7:1,
 * 0.46 ≈ 4.8:1 on a cream paper).
 */
function mixTriplet(hexA: string, hexB: string, t: number): string {
  const a = parseHex(hexA);
  const b = parseHex(hexB);
  const m = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);
  return `${m(0)} ${m(1)} ${m(2)}`;
}

/**
 * Wraps the live-state commerce body in the brand's Atelier visual identity.
 *
 * Remaps the globals.css Maroon-Noir tokens (--bg, --text, --accent, etc.)
 * to values derived from the brand's published Landing Studio config, so
 * every block, card, glass surface, and footer renders on the light
 * Atelier palette — coherent with the apex page and the before/ended states.
 *
 * The LiveHero stays ABOVE this provider (keeping its own dark background);
 * only the commerce body below is wrapped.
 */
export function BrandThemeProvider({
  brandConfig,
  children,
}: {
  brandConfig: LandingConfig;
  children: ReactNode;
}) {
  const hrefs = useMemo(
    () => fontHrefs(brandConfig.typography),
    [brandConfig.typography],
  );
  useEffect(() => {
    if (typeof document === "undefined") return;
    for (const host of [
      "https://fonts.googleapis.com",
      "https://fonts.gstatic.com",
    ]) {
      if (!document.querySelector(`link[data-brand-font-pre="${host}"]`)) {
        const pre = document.createElement("link");
        pre.rel = "preconnect";
        pre.href = host;
        if (host.includes("gstatic")) pre.crossOrigin = "anonymous";
        pre.setAttribute("data-brand-font-pre", host);
        document.head.appendChild(pre);
      }
    }
    for (const href of hrefs) {
      if (document.querySelector(`link[data-brand-font="${href}"]`)) continue;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.setAttribute("data-brand-font", href);
      document.head.appendChild(link);
    }
  }, [hrefs]);

  const vars = useMemo(() => {
    const t = brandConfig.theme;
    const typ = brandConfig.typography;
    const tex = brandConfig.texture;
    return {
      "--bg": hexToTriplet(t.paper),
      "--panel": hexToTriplet(t.primaryDeep),
      "--panel-2": hexToTriplet(t.primary),
      "--panel-alpha": "0.05",
      "--text": hexToTriplet(t.ink),
      // Readable secondary text: blend the brand ink toward paper rather than
      // using the pale brand "muted" swatch (which fails WCAG on cream).
      "--text-muted": mixTriplet(t.ink, t.paper, 0.3),
      "--text-faint": mixTriplet(t.ink, t.paper, 0.46),
      // Dark ink reserved for text on the warm CTA fill inside dark overlays
      // (the cart drawer + product modal), where --text flips to paper.
      "--cta-ink": hexToTriplet(t.ink),
      "--border-c": hexToTriplet(t.primary),
      "--border-alpha": "0.12",
      "--accent": hexToTriplet(t.primary),
      "--accent-deep": hexToTriplet(t.primaryDeep),
      "--accent-glow": hexToTriplet(t.glow),
      // A deepened gold for accent TEXT/links on the light cream body. The raw
      // brand glow (a pale camel) fails WCAG as small text on paper; darkening
      // it toward ink keeps the gold character while passing contrast (~4.6:1).
      "--accent-readable": mixTriplet(t.glow, t.ink, 0.38),
      "--font-display": fontStack(typ?.display, "serif"),
      "--font-body": fontStack(typ?.body, "sans"),
      "--blur": `${tex?.glassBlur ?? 12}px`,
      "--glass-shadow": `inset 0 1px 0 rgb(${hexToTriplet(t.primary)} / 0.06), 0 12px 32px rgb(${hexToTriplet(t.primaryDeep)} / 0.08)`,
      "--brand-ink": hexToTriplet(t.ink),
      "--brand-paper": hexToTriplet(t.paper),
      "--brand-primary": hexToTriplet(t.primary),
      "--brand-primary-deep": hexToTriplet(t.primaryDeep),
      "--brand-accent": hexToTriplet(t.accent),
      "--brand-muted": hexToTriplet(t.muted),
      "--brand-glow": hexToTriplet(t.glow),
      "--font-atelier-display": fontStack(typ?.display, "serif"),
      "--font-atelier-body": fontStack(typ?.body, "sans"),
    } as React.CSSProperties;
  }, [brandConfig]);

  return (
    <div
      data-atelier-commerce=""
      style={{
        ...vars,
        background: `rgb(${hexToTriplet(brandConfig.theme.paper)})`,
        color: `rgb(${hexToTriplet(brandConfig.theme.ink)})`,
        fontFamily: "var(--font-body)",
      }}
    >
      {children}
    </div>
  );
}
