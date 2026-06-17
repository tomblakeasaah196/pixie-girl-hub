/**
 * Lightweight Google Maps JS API loader.
 *
 * Avoids adding @googlemaps/js-api-loader as a dependency — we only
 * need the Places + Maps libraries on two pages so a small script-tag
 * loader is enough.
 *
 * The key reads from `VITE_GOOGLE_PLACES_API_KEY`. When unset the
 * loader returns null and the callers fall back to the manual address
 * form, so the build still works in dev without the key.
 */

const API_KEY = import.meta.env.VITE_GOOGLE_PLACES_API_KEY as
  | string
  | undefined;

let promise: Promise<typeof window.google | null> | null = null;

declare global {
  interface Window {
    google?: typeof google;
  }
}

export function isGoogleMapsConfigured(): boolean {
  return !!API_KEY;
}

export function loadGoogleMaps(): Promise<typeof window.google | null> {
  if (!API_KEY) return Promise.resolve(null);
  if (promise) return promise;
  promise = new Promise((resolve, reject) => {
    if (window.google && window.google.maps) {
      resolve(window.google);
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      API_KEY,
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
  return promise;
}
