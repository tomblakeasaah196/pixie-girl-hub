"use client";

import { useEffect } from "react";
import { LandingFooter, type LandingConfig } from "@landing-kit";
import type { LandingPayload } from "@/lib/types";
import { BrandThemeProvider } from "@/components/BrandThemeProvider";
import { LandingShell } from "@/components/LandingShell";
import { LiveHero } from "./LiveHero";
import { CurrencyFloater } from "./CurrencyFloater";

/**
 * Live-state composition (June 2026 — owner directive removed the
 * IntroOverlay "ribboned door" intro across every state; visitors land
 * straight on the commerce body):
 *
 *   LiveHero  — Atelier dark hero with the RED end-countdown, LIVE / Final
 *               hour / Sold-out pills, present-tense headline, two CTAs and
 *               an ambient "elapsed" hairline.
 *   ───────────────────────────────────────────────────────
 *   BrandThemeProvider — remaps the globals.css Maroon-Noir tokens to the
 *               brand's published Landing Studio palette (light Atelier),
 *               so the commerce body is visually coherent with the apex page
 *               and the before/ended states.
 *   ───────────────────────────────────────────────────────
 *   LandingShell omitHero — the proven commerce body (bundles, tier ladder,
 *               featured products, lookbook, stock counter) and the live
 *               overlays (sticky cart, cart drawer, upsell modal, exit-intent,
 *               viewer + just-bought tickers).
 *   ───────────────────────────────────────────────────────
 *   LandingFooter — the shared landing-kit "house" footer (the same one the
 *               owner authors on the apex page), rendered inside the brand
 *               theme so live / before / ended / apex all share one footer.
 */
export function LiveShell({
  payload,
  brandConfig,
}: {
  payload: LandingPayload;
  brandConfig: LandingConfig;
}) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute(
      "data-business",
      payload.brand?.business_key || "pixiegirl",
    );
  }, [payload.brand?.business_key]);

  return (
    <>
      <LiveHero payload={payload} brandConfig={brandConfig} />
      <BrandThemeProvider brandConfig={brandConfig}>
        <LandingShell payload={payload} omitHero />
        {/* The shared "house" footer (same one authored on the apex page),
            rendered inside the brand theme so it matches the before/ended
            states and the apex itself. */}
        <LandingFooter config={brandConfig} />
      </BrandThemeProvider>
      <CurrencyFloater payload={payload} />
    </>
  );
}
