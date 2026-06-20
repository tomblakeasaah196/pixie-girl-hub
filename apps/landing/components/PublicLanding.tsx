"use client";

import { useCallback, useState } from "react";
import {
  LandingPreview,
  AtelierRevealPreview,
  type LandingConfig,
  type LandingSubmit,
} from "@landing-kit";

/**
 * PublicLanding — the live "no active sale" page.
 *
 * Composes the shared renderer + cinematic reveal in the exact same shape as
 * the admin "Preview tab" (apps/admin … LandingPreviewPage): the renderer
 * fills a `fixed inset-0` scroll container and the reveal plays once on load
 * as an overlay sibling. That 1:1 composition is what makes the live page a
 * true WYSIWYG match for the studio preview.
 *
 * The only behavioural difference from the studio is the form: here it POSTs
 * to the Hub's public signup endpoint and shows the returned referral code.
 */
export function PublicLanding({ config }: { config: LandingConfig }) {
  const [revealDone, setRevealDone] = useState(false);

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

  return (
    <div className="fixed inset-0 overflow-y-auto bg-black">
      <LandingPreview config={config} onSubmit={onSubmit} />
      {config.reveal.enabled && !revealDone && (
        <AtelierRevealPreview
          config={config}
          replayKey="once"
          onComplete={() => setRevealDone(true)}
        />
      )}
    </div>
  );
}
