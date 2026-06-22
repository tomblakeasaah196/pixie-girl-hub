"use client";

import { useCallback } from "react";
import {
  BeforeState,
  type LandingConfig,
  type LandingSubmit,
} from "@landing-kit";
import type { LandingPayload } from "@/lib/types";

/**
 * Before-state page for the public sales site.
 *
 * The Atelier composition (intro curtain, 3D hourglass hero, invitation body,
 * cinematic reveal) is shared with the admin campaign preview via
 * @landing-kit's <BeforeState>, so the live page and the studio preview can't
 * drift. This wrapper supplies only the live signup handler — a POST to the
 * campaign-scoped signup endpoint so the cohort can be reached later about
 * THIS drop specifically.
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

  return (
    <BeforeState
      payload={payload}
      brandConfig={brandConfig}
      onSignup={onSubmit}
    />
  );
}
