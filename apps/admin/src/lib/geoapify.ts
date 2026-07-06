/**
 * Geoapify client (admin) — the office-location picker's data layer.
 *
 * The Geoapify key is SERVER-ONLY, so nothing here talks to Geoapify directly:
 * every call hits our own /attendance/geo/* proxy (auth + brand headers ride
 * along via the shared api client), which forwards to Geoapify. This replaces
 * the browser Google Maps SDK the picker used to depend on — no SDK to load,
 * so no "t.maps.Map is not a constructor" / stuck-on-"Loading map…".
 */

import { api } from "@/lib/api";

export interface GeoSuggestion {
  formatted: string;
  lat: number;
  lng: number;
  place_id: string | null;
  category: string | null;
  city: string | null;
  country: string | null;
}

/** Whether map + address search are available (else the picker degrades). */
export const geoStatus = () =>
  api.get<{ configured: boolean }>("/attendance/geo/status");

/** Typed text → ranked address suggestions, biased toward `bias` coordinates. */
export const geoSearch = (
  text: string,
  bias?: { lat: number; lng: number },
): Promise<GeoSuggestion[]> => {
  const p = new URLSearchParams({ text });
  if (bias) {
    p.set("lat", String(bias.lat));
    p.set("lng", String(bias.lng));
  }
  return api.get<GeoSuggestion[]>(`/attendance/geo/search?${p.toString()}`);
};

/** Coordinates → a human address label (null when unknown). */
export const geoReverse = (lat: number, lng: number) =>
  api.get<{ address: string | null }>(
    `/attendance/geo/reverse?lat=${lat}&lng=${lng}`,
  );

/**
 * Fetch a centred static map image as an object URL (auth-safe — an <img src>
 * can't send the bearer token, so we fetch the bytes and wrap them). The caller
 * owns the URL and must revokeObjectURL it when replacing/unmounting.
 */
export async function fetchStaticMapUrl(params: {
  lat: number;
  lng: number;
  zoom: number;
  width: number;
  height: number;
}): Promise<string> {
  const p = new URLSearchParams({
    lat: String(params.lat),
    lng: String(params.lng),
    zoom: String(params.zoom),
    width: String(Math.round(params.width)),
    height: String(Math.round(params.height)),
  });
  const blob = await api.getBlob(`/attendance/geo/staticmap?${p.toString()}`);
  return URL.createObjectURL(blob);
}
