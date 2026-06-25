"use client";

import { useEffect } from "react";

/**
 * Kills any stale service worker + cache left in a customer's browser.
 *
 * The sales landing is not a PWA, but an earlier build shipped a worker that
 * cached pages/assets and kept serving stale content (silent button failures,
 * checkout bouncing to an old page). This runs on every load and:
 *   1. unregisters every service worker registered for this origin, and
 *   2. deletes every Cache Storage bucket.
 *
 * Once a browser is clean it's a no-op (no registrations, no caches), so it is
 * safe to leave in permanently as a guard against regressions.
 */
export function PwaCleanup() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .getRegistrations?.()
        .then((regs) => regs.forEach((r) => r.unregister().catch(() => {})))
        .catch(() => {});
    }

    if (typeof caches !== "undefined" && caches.keys) {
      caches
        .keys()
        .then((keys) => keys.forEach((k) => caches.delete(k).catch(() => {})))
        .catch(() => {});
    }
  }, []);

  return null;
}
