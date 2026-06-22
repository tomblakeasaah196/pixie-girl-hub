/**
 * Browser geolocation capture for clock-in (HR attendance).
 *
 * Uses the W3C Geolocation API (not Google Places) for coordinates, then
 * best-effort reverse-geocodes to a human address via the already-loaded
 * Google Maps Geocoder. Coordinates are the server-side truth; the address is
 * display only. Requires a secure (HTTPS) origin in production.
 */

import { loadGoogleMaps } from "./google-maps-loader";

export interface CapturedGeo {
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  address?: string;
  denied?: boolean;
}

/** Promisified getCurrentPosition with a sane timeout. */
function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Geolocation unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0,
    });
  });
}

async function reverseGeocode(lat: number, lng: number): Promise<string | undefined> {
  try {
    const g = await loadGoogleMaps();
    if (!g) return undefined;
    const geocoder = new g.maps.Geocoder();
    const res = await geocoder.geocode({ location: { lat, lng } });
    return res.results?.[0]?.formatted_address;
  } catch {
    return undefined;
  }
}

/**
 * Capture the device's current location (+ address). On permission denial or
 * timeout, returns nulls with `denied: true` so the caller can decide whether
 * to proceed (remote day) or surface a "enable location" prompt (on-site).
 */
export async function captureGeo(): Promise<CapturedGeo> {
  try {
    const pos = await getPosition();
    const { latitude, longitude, accuracy } = pos.coords;
    const address = await reverseGeocode(latitude, longitude);
    return {
      latitude,
      longitude,
      accuracy_m: accuracy ?? null,
      address,
    };
  } catch {
    return { latitude: null, longitude: null, accuracy_m: null, denied: true };
  }
}
