// @ts-nocheck
"use client";

import { useEffect, useMemo, useState } from "react";
import type { LandingConfig } from "./config";
import type { LandingPayload } from "./types";
import { LandingPreview, type LandingSubmit } from "./LandingPreview";
import { AtelierRevealPreview } from "./AtelierRevealPreview";
import { IntroOverlay } from "./IntroOverlay";
import { AfterHero } from "./AfterHero";

/**
 * The ended-state Atelier composition — shared by the public sales site and
 * the admin campaign preview. Mirrors the before page's three-layer stack
 * (IntroOverlay + AfterHero + LandingPreview body + reveal) but "shadows" the
 * LandingConfig with after-state copy (full-house Inner Circle, "Hear first"
 * CTA). The shadow is local — the brand's published Studio config is never
 * mutated. The signup handler is injected by the host (the live site POSTs to
 * the brand newsletter because THIS campaign is closed).
 */
function shadowForAfter(config: LandingConfig): LandingConfig {
  const seatsTotal = config.invitation.seatsTotal || 200;
  return {
    ...config,
    invitation: {
      ...config.invitation,
      heading: `${seatsTotal} seats.`,
      headingAccent: "Full house.",
      body: "The list closed at capacity. The room is being readied for the next chapter — the next door opens when it does.",
      formEyebrow: "Next chapter",
      formTitle: "Hear first when the",
      formTitleAccent: "doors open again.",
      seatsClaimedBase: seatsTotal,
      referralNote:
        "Bring three friends along — when the next chapter opens, the first three names you send earn you an additional private discount and bonus loyalty points on every order they place.",
    },
    form: {
      ...config.form,
      submitLabel: "Stay close",
      footnote: "One quiet message when the next chapter is ready.",
    },
  };
}

export function EndedState({
  payload,
  brandConfig,
  onSignup,
}: {
  payload: LandingPayload;
  brandConfig: LandingConfig;
  onSignup: LandingSubmit;
}) {
  const [revealDone, setRevealDone] = useState(false);
  const afterConfig = useMemo(() => shadowForAfter(brandConfig), [brandConfig]);

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
      <style>{`
        [data-state="ended-page"] .lp-marquee { animation-duration: 53s; }
        [data-state="ended-page"] .lp-marquee-slow { animation-duration: 93s; }
      `}</style>
      <div
        data-state="ended-page"
        className="fixed inset-0 overflow-y-auto bg-black"
      >
        <AfterHero payload={payload} brandConfig={brandConfig} />
        <LandingPreview config={afterConfig} onSubmit={onSignup} omitHero />
        {afterConfig.reveal.enabled && !revealDone && (
          <AtelierRevealPreview
            config={afterConfig}
            replayKey="once"
            onComplete={() => setRevealDone(true)}
          />
        )}
      </div>
    </>
  );
}
