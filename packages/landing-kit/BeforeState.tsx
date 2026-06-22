// @ts-nocheck
"use client";

import { useEffect, useState } from "react";
import type { LandingConfig } from "./config";
import type { LandingPayload } from "./types";
import { LandingPreview, type LandingSubmit } from "./LandingPreview";
import { AtelierRevealPreview } from "./AtelierRevealPreview";
import { IntroOverlay } from "./IntroOverlay";
import { BeforeHero } from "./BeforeHero";

/**
 * The Atelier "before" (coming-soon) composition — shared by the public sales
 * site (apps/landing) and the admin campaign preview so the two never drift:
 *
 *   IntroOverlay        — session-once cinematic curtain
 *   BeforeHero          — dark ink hero + the 3D Atelier Hourglass countdown
 *   LandingPreview      — apex body (invitation form, gallery, pillars, footer)
 *   AtelierRevealPreview — logo-plane reveal, once on load
 *
 * The signup handler is injected by the host: the live site POSTs to the
 * campaign signup endpoint; the admin preview returns a sample code.
 */
export function BeforeState({
  payload,
  brandConfig,
  onSignup,
}: {
  payload: LandingPayload;
  brandConfig: LandingConfig;
  onSignup: LandingSubmit;
}) {
  const [revealDone, setRevealDone] = useState(false);

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
      <div className="fixed inset-0 overflow-y-auto bg-black">
        <BeforeHero payload={payload} brandConfig={brandConfig} />
        <LandingPreview config={brandConfig} onSubmit={onSignup} omitHero />
        {brandConfig.reveal.enabled && !revealDone && (
          <AtelierRevealPreview
            config={brandConfig}
            replayKey="once"
            onComplete={() => setRevealDone(true)}
          />
        )}
      </div>
    </>
  );
}
