"use client";

import { useCallback } from "react";
import {
  EndedState,
  type LandingConfig,
  type LandingSubmit,
} from "@landing-kit";
import type { LandingPayload } from "@/lib/types";

/**
 * Ended-state page for the public sales site. The Atelier composition (intro
 * curtain, after-hero, shadowed invitation body, reveal) is shared with the
 * admin campaign preview via @landing-kit's <EndedState>. This wrapper supplies
 * the live signup handler — a POST to the brand newsletter, because THIS
 * campaign is closed (the next campaign's before page owns its own cohort).
 */
export function AfterShell({
  payload,
  brandConfig,
}: {
  payload: LandingPayload;
  brandConfig: LandingConfig;
}) {
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
    <EndedState
      payload={payload}
      brandConfig={brandConfig}
      onSignup={onSubmit}
    />
  );
}
