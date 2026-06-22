// @ts-nocheck
"use client";

import { useEffect } from "react";
import type { LandingConfig } from "./config";
import type { LandingPayload } from "./types";
import { IntroOverlay } from "./IntroOverlay";
import { BrandThemeProvider } from "./BrandThemeProvider";
import { LandingShell } from "./LandingShell";
import { LiveHero } from "./LiveHero";

/**
 * The live-state Atelier composition — shared by the public sales site and the
 * admin campaign preview:
 *
 *   IntroOverlay        — session-once cinematic curtain
 *   LiveHero            — dark Atelier hero with the end-countdown + CTAs
 *   BrandThemeProvider  — remaps tokens to the brand's light Atelier palette
 *     LandingShell omitHero — the commerce body (bundles, tiers, featured
 *       products, lookbook, stock) + overlays (sticky cart, drawer, upsell,
 *       exit-intent, viewer/just-bought tickers).
 */
export function LiveState({
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
      <IntroOverlay
        brand={payload.brand?.business_key}
        campaignName={payload.name}
        sessionKey={`pgh-intro-seen:${payload.slug}`}
      />
      <LiveHero payload={payload} brandConfig={brandConfig} />
      <BrandThemeProvider brandConfig={brandConfig}>
        <LandingShell payload={payload} omitHero />
      </BrandThemeProvider>
    </>
  );
}
