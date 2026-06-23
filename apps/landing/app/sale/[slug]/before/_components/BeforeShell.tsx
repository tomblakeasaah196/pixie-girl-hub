"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LandingPreview,
  AtelierRevealPreview,
  type LandingConfig,
  type LandingSubmit,
} from "@landing-kit";
import type { LandingPayload } from "@/lib/types";
import { BeforeHero } from "./BeforeHero";

/**
 * The before-state page composition:
 *
 *   BeforeHero (dark ink section)
 *     · brand monogram backdrop
 *     · tier-driven eyebrow
 *     · serif headline + accent
 *     · Atelier Hourglass (3D countdown)
 *     · save-the-date / Google Calendar / Join the list
 *     · scroll indicator
 *   ───────────────────────────────────────────────
 *   LandingPreview (apex body — Invitation, Gallery, Pillars, Footer)
 *     · omitHero={true} so its own hero is skipped
 *     · onSubmit POSTs to the campaign-scoped signup endpoint so the cohort
 *       can be reached later about THIS drop specifically
 *   ───────────────────────────────────────────────
 *   AtelierRevealPreview (the apex's logo plane scene, once on load)
 *
 * The IntroOverlay "ribboned door" intro was removed June 2026 (owner
 * directive — visitors land straight on the page).
 */

function synthesizeCode(brandName: string, name: string): string {
  const prefix =
    brandName.replace(/[^A-Za-z]/g, "").slice(0, 5).toUpperCase() || "HOUSE";
  const handle =
    (name.trim().split(/\s+/)[0] || "FRIEND").toUpperCase().slice(0, 6);
  const digits = Math.floor(100 + Math.random() * 900);
  return `${prefix}-${handle}-${digits}`;
}

export function BeforeShell({
  payload,
  brandConfig,
}: {
  payload: LandingPayload;
  brandConfig: LandingConfig;
}) {
  const [revealDone, setRevealDone] = useState(false);

  const onSubmit: LandingSubmit = useCallback(
    async ({ name, email, whatsapp, channel }) => {
      const notify_via =
        channel === "whatsapp"
          ? "whatsapp"
          : channel === "both"
            ? "both"
            : "email";
      const res = await fetch(
        `/api/public/sale/${encodeURIComponent(payload.slug)}/signup`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email || undefined,
            phone: whatsapp || undefined,
            notify_via,
            source: "before",
          }),
        },
      );
      if (!res.ok) throw new Error(`Signup failed: ${res.status}`);
      return { code: synthesizeCode(brandConfig.brandName, name) };
    },
    [payload.slug, brandConfig.brandName],
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
      <div className="fixed inset-0 overflow-y-auto bg-black">
        <BeforeHero payload={payload} brandConfig={brandConfig} />
        <LandingPreview
          config={brandConfig}
          onSubmit={onSubmit}
          omitHero
        />
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
