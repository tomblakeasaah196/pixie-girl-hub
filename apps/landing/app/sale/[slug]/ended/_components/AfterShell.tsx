"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LandingPreview,
  AtelierRevealPreview,
  type LandingConfig,
  type LandingSubmit,
} from "@landing-kit";
import type { LandingPayload } from "@/lib/types";
import { IntroOverlay } from "@/components/IntroOverlay";
import { AfterHero } from "./AfterHero";

/**
 * The after-state page composition mirrors the before page's three-layer
 * stack — IntroOverlay + AfterHero + LandingPreview body + AtelierRevealPreview
 * — but the LandingConfig piped into the body is "shadowed" with after-state
 * copy (full-house Inner Circle, "Hear first" form CTA) and the form submits
 * to the brand newsletter endpoint because THIS campaign is closed.
 *
 * The shadow happens locally — the brand's published Studio config is never
 * mutated, so the apex page renders identically. A future Campaign Builder
 * accordion ("Ended-state overlay") would let the admin override these
 * strings per campaign; until then, the defaults below are the spec.
 */

function shadowForAfter(config: LandingConfig): LandingConfig {
  const seatsTotal = config.invitation.seatsTotal || 200;
  return {
    ...config,
    invitation: {
      ...config.invitation,
      heading: `${seatsTotal} seats.`,
      headingAccent: "Full house.",
      body:
        "The list closed at capacity. The room is being readied for the next chapter — the next door opens when it does.",
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

export function AfterShell({
  payload,
  brandConfig,
}: {
  payload: LandingPayload;
  brandConfig: LandingConfig;
}) {
  const [revealDone, setRevealDone] = useState(false);
  const afterConfig = useMemo(() => shadowForAfter(brandConfig), [brandConfig]);

  // Brand-wide newsletter — this campaign is closed, so signups belong on the
  // brand list. The next campaign's before page handles its own cohort.
  const onSubmit: LandingSubmit = useCallback(
    async ({ name, email, whatsapp, referral, channel }) => {
      const res = await fetch("/api/public/landing/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, whatsapp, referral, channel }),
      });
      if (!res.ok) throw new Error(`Signup failed: ${res.status}`);
      const json = await res.json();
      return { code: json?.data?.code ?? "" };
    },
    [],
  );

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
        /* After page: slow the gallery marquee 25% so the body reads as
           memory rather than active anticipation. Scoped to this page only. */
        [data-state="ended-page"] .lp-marquee { animation-duration: 53s; }
        [data-state="ended-page"] .lp-marquee-slow { animation-duration: 93s; }
      `}</style>
      <div
        data-state="ended-page"
        className="fixed inset-0 overflow-y-auto bg-black"
      >
        <AfterHero payload={payload} brandConfig={brandConfig} />
        <LandingPreview
          config={afterConfig}
          onSubmit={onSubmit}
          omitHero
        />
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
