"use client";

/**
 * Meta (Facebook) Pixel — client-side event helpers.
 *
 * The base pixel (init + PageView) is installed once by components/MetaPixel.tsx
 * in the root layout. These helpers fire the funnel/conversion events on top of
 * it (ViewContent, AddToCart, InitiateCheckout, Lead, Purchase) so Meta can
 * optimise ad delivery and report ROAS.
 *
 * Every call is a safe no-op when the pixel never loaded — `fbq` is absent on
 * the server, when no pixel id is configured for the brand, or before
 * fbevents.js finishes loading (the snippet's stub queues calls, so we still
 * fire). Values are NGN major units (the cart/order's native currency); the
 * on-screen ₦/$ toggle is display-only and never changes what we report.
 */

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

/** Fire a standard Meta Pixel event. No-ops if the pixel isn't present. */
export function fbTrack(
  event: string,
  params?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  try {
    window.fbq?.("track", event, params);
  } catch {
    // Never let analytics throw into the UI.
  }
}

/**
 * Fire an event at most once per dedup key, persisted across reloads.
 *
 * Used for Purchase: the thank-you page polls the order and a buyer may refresh
 * it, so we key on the order id and remember (localStorage) that we already
 * reported it — Meta would otherwise count the same sale several times.
 */
export function fbTrackOnce(
  key: string,
  event: string,
  params?: Record<string, unknown>,
): void {
  if (typeof window === "undefined" || !key) return;
  const storageKey = `pgh-fb-evt:${event}:${key}`;
  try {
    if (localStorage.getItem(storageKey)) return;
    localStorage.setItem(storageKey, "1");
  } catch {
    // localStorage blocked (private mode / quota): fall through and still fire.
    // Worst case is a duplicate on a hard refresh — acceptable vs. never firing.
  }
  fbTrack(event, params);
}
