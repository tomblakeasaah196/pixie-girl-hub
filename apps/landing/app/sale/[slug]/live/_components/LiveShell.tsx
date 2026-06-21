"use client";

import { useEffect } from "react";
import type { LandingConfig } from "@landing-kit";
import type { LandingPayload } from "@/lib/types";
import { IntroOverlay } from "@/components/IntroOverlay";
import { LandingShell } from "@/components/LandingShell";
import { LiveHero } from "./LiveHero";

/**
 * Live-state composition:
 *
 *   IntroOverlay (cinematic curtain, session-once per slug)
 *   ───────────────────────────────────────────────────────
 *   LiveHero  — Atelier dark hero with the RED end-countdown, LIVE / Final
 *               hour / Sold-out pills, present-tense headline, two CTAs and
 *               an ambient "elapsed" hairline.
 *   ───────────────────────────────────────────────────────
 *   LandingShell omitHero — the proven commerce body (bundles, tier ladder,
 *               featured products, lookbook, stock counter) and the live
 *               overlays (sticky cart, cart drawer, upsell modal, exit-intent,
 *               viewer + just-bought tickers), unchanged.
 *
 * brandConfig supplies the Atelier theme tokens the hero paints with; the
 * commerce body keeps using its own per-brand tokens. The brand's published
 * Studio config is never mutated.
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
      <IntroOverlay
        brand={payload.brand?.business_key}
        campaignName={payload.name}
        sessionKey={`pgh-intro-seen:${payload.slug}`}
      />
      <LiveHero payload={payload} brandConfig={brandConfig} />
      <LandingShell payload={payload} omitHero />
    </>
  );
}
