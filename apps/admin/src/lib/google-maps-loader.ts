/**
 * Lightweight Google Maps JS API loader.
 *
 * Avoids adding @googlemaps/js-api-loader as a dependency — we only
 * need the Places + Maps libraries on two pages so a small script-tag
 * loader is enough.
 *
 * The key is resolved at RUNTIME via getMapsApiKey() (a build-time VITE var
 * if present, else GET /api/public/config), so it can be set on the live
 * server without rebuilding the admin bundle. When no key is configured the
 * loader resolves to null and the callers fall back to the manual address
 * form, so the build still works in dev without the key.
 */

import { getMapsApiKey } from "./runtime-config";

let promise: Promise<typeof window.google | null> | null = null;

declare global {
  interface Window {
    google?: typeof google;
  }
}

/** Whether a Maps key is configured (resolved at runtime). */
export async function isGoogleMapsConfigured(): Promise<boolean> {
  return Boolean(await getMapsApiKey());
}

export function loadGoogleMaps(): Promise<typeof window.google | null> {
  if (promise) return promise;
  const p = (async (): Promise<typeof window.google | null> => {
    const key = await getMapsApiKey();
    if (!key) return null;
    if (window.google && window.google.maps) return window.google;
    return new Promise<typeof window.google | null>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
        key,
      )}&libraries=places,marker&v=weekly&loading=async`;
      script.async = true;
      script.defer = true;
      script.onload = () => {
        if (window.google && window.google.maps) resolve(window.google);
        else reject(new Error("Google Maps loaded but no API on window"));
      };
      script.onerror = () =>
        reject(new Error("Google Maps script failed to load"));
      document.head.appendChild(script);
    });
  })();
  promise = p;
  // Don't cache a "no key" / failed attempt forever — a later mount can retry.
  p.then((g) => {
    if (!g) promise = null;
  }).catch(() => {
    promise = null;
  });
  return p;
}
