import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const m = window.matchMedia(query);
    const handler = () => setMatches(m.matches);
    handler();
    m.addEventListener("change", handler);
    return () => m.removeEventListener("change", handler);
  }, [query]);
  return matches;
}

/* ── Responsive tiers ──────────────────────────────────────────────────────
   Three tiers (matching the engineering reference): phone ≤767, tablet
   768–1023, desktop ≥1024. The PHONE boundary (≤767) is frozen — nothing in
   the desktop pass may change behaviour at or below it. Desktop is the tier
   that gets the rail sidebar, the centered content container, master-detail,
   wider overlays and denser tables. */

/** Desktop = ≥1024px. Rail sidebar, centered container, master-detail, etc. */
export const useIsDesktop = () => useMediaQuery("(min-width: 1024px)");

/** Tablet = 768–1023px. Drawer sidebar + bottom nav, full-width fluid body. */
export const useIsTablet = () =>
  useMediaQuery("(min-width: 768px) and (max-width: 1023px)");

/** Phone = ≤767px. The frozen tier — never changed by the desktop pass. */
export const useIsPhone = () => useMediaQuery("(max-width: 767px)");
