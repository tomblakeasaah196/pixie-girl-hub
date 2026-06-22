import type { LandingPayload, LandingState } from "./types";

/**
 * The Before/Live/Ended trio is the canonical state. We also derive
 * useful sub-states the renderer can branch on:
 *  - vip_window: Live has started for VIPs but not public yet
 *  - last_call:  inside the surge window before ends_at
 *  - sold_out_hold: a Live state where all current bundles are 0
 *  - waitlist:   Ended with a next_campaign queued up
 */
export type DerivedState =
  | "before"
  | "before_vip_window"
  | "live"
  | "live_last_call"
  | "live_sold_out_hold"
  | "ended"
  | "ended_waitlist";

export function deriveState(
  payload: LandingPayload,
  now: number = Date.now(),
): {
  state: LandingState;
  derived: DerivedState;
  msToStart: number;
  msToEnd: number;
} {
  const starts = new Date(payload.starts_at).getTime();
  const ends = new Date(payload.ends_at).getTime();
  const msToStart = starts - now;
  const msToEnd = ends - now;

  let state: LandingState = payload.state || "before";
  // Defensive recompute — the backend is source of truth but the page
  // may render slightly after the cron flips, so use times as a tiebreaker.
  if (now >= ends) state = "ended";
  else if (now >= starts && state !== "ended") state = "live";
  else if (now < starts) state = "before";

  let derived: DerivedState = state;
  if (
    state === "before" &&
    payload.vip_early_access_minutes &&
    payload.vip_early_access_minutes > 0
  ) {
    const vipStart = starts - payload.vip_early_access_minutes * 60_000;
    if (now >= vipStart) derived = "before_vip_window";
  }
  if (
    state === "live" &&
    payload.last_call_surge_minutes &&
    payload.last_call_surge_minutes > 0
  ) {
    if (msToEnd <= payload.last_call_surge_minutes * 60_000)
      derived = "live_last_call";
  }
  if (state === "live") {
    const allOut = (payload.bundles || []).every(
      (b) =>
        b.current_stock_snapshot !== null &&
        b.current_stock_snapshot !== undefined &&
        Number(b.current_stock_snapshot) <= 0,
    );
    if (allOut && (payload.bundles || []).length > 0)
      derived = "live_sold_out_hold";
  }
  if (state === "ended" && payload.next_campaign?.slug)
    derived = "ended_waitlist";

  return { state, derived, msToStart, msToEnd };
}

/** Smart-viewer policy resolver. */
export function shouldShowViewerCount(
  campaign: Pick<
    LandingPayload,
    "show_viewer_count_policy" | "viewer_count_floor"
  > & {
    brand?: {
      show_viewer_count_policy?: "smart" | "on" | "off" | null;
      viewer_count_floor?: number | null;
    };
  },
  currentViewers: number,
): "show" | "pill_only" | "hidden" {
  const policy =
    campaign.show_viewer_count_policy ||
    campaign.brand?.show_viewer_count_policy ||
    "smart";
  const floor =
    campaign.viewer_count_floor ?? campaign.brand?.viewer_count_floor ?? 20;
  if (policy === "off") return "hidden";
  if (policy === "on") return "show";
  // smart
  if (currentViewers >= floor) return "show";
  if (currentViewers > 0) return "pill_only";
  return "hidden";
}
