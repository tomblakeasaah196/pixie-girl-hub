// @ts-nocheck
"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import type { LandingConfig } from "./config";
import { hexToTriplet, fontStack, fontHrefs } from "./config";

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
      "--text-muted": hexToTriplet(t.muted),
      "--text-faint": hexToTriplet(t.muted),
      "--border-c": hexToTriplet(t.primary),
      "--border-alpha": "0.12",
      "--accent": hexToTriplet(t.primary),
      "--accent-deep": hexToTriplet(t.primaryDeep),
      "--accent-glow": hexToTriplet(t.glow),
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
