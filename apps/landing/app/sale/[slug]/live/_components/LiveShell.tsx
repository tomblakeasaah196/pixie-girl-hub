"use client";

import { LiveState, type LandingConfig } from "@landing-kit";
import type { LandingPayload } from "@/lib/types";

/**
 * Live-state page for the public sales site. The Atelier composition (intro
 * curtain, dark hero + end-countdown, brand-themed commerce body with the
 * cart/overlays) is shared with the admin campaign preview via @landing-kit's
 * <LiveState>, so the live page and the studio preview can't drift.
 */
export function LiveShell({
  payload,
  brandConfig,
}: {
  payload: LandingPayload;
  brandConfig: LandingConfig;
}) {
  return <LiveState payload={payload} brandConfig={brandConfig} />;
}
