/**
 * Browser geolocation capture for clock-in (HR attendance).
 *
 * Uses the W3C Geolocation API for coordinates only — no client-side
 * geocoding. The address label is derived server-side from these coordinates
 * via Geoapify at punch time (see src/services/geoapify.service.js). This
 * removes the Google Maps dependency from clock-in entirely. Coordinates are
 * the server-side truth; the stored address is display only. Requires a
 * secure (HTTPS) origin in production.
 */

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

/**
 * Capture the device's current location. On permission denial or timeout,
 * returns nulls with `denied: true` so the caller can decide whether to
 * proceed (remote day) or surface an "enable location" prompt (on-site). The
 * server reverse-geocodes the coordinates into an address label.
 */
export async function captureGeo(): Promise<CapturedGeo> {
  try {
    const pos = await getPosition();
    const { latitude, longitude, accuracy } = pos.coords;
    return {
      latitude,
      longitude,
      accuracy_m: accuracy ?? null,
    };
  } catch {
    return { latitude: null, longitude: null, accuracy_m: null, denied: true };
  }
}
