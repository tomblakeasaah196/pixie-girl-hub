/**
 * Injects a font stylesheet into <head>. Reuses the same <link>
 * element so flipping fonts doesn't pile up old stylesheets across
 * a session.
 *
 * The URL is trusted by the time it gets here — the backend's
 * platform_settings validator (and the UI's isAllowedFontUrl) only
 * accept https URLs on the trusted font-host allow-list. We still
 * sanity-check on this side so a stale localStorage value can't
 * smuggle a hostile sheet on app boot.
 */

import { isAllowedFontUrl } from "@/lib/branding";

const LINK_ID = "pgh-font-css";

export function loadFontStylesheet(url: string | null | undefined): void {
  if (typeof document === "undefined") return;
  const existing = document.getElementById(LINK_ID) as HTMLLinkElement | null;

  if (!url) {
    existing?.remove();
    return;
  }
  if (!isAllowedFontUrl(url)) {
    // Refuse silently; the UI surfaces a validation error before save,
    // so reaching here means a stale or tampered cache.
    return;
  }
  if (existing && existing.href === url) return;
  if (existing) {
    existing.href = url;
    return;
  }
  const link = document.createElement("link");
  link.id = LINK_ID;
  link.rel = "stylesheet";
  link.href = url;
  document.head.appendChild(link);
}
