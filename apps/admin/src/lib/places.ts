/// <reference types="@types/google.maps" />
/**
 * New Places API (Places API "New") helpers.
 *
 * Google disabled the legacy `google.maps.places.Autocomplete` widget for
 * Cloud projects created after 1 March 2025, so we drive autocomplete with the
 * data API (`AutocompleteSuggestion.fetchAutocompleteSuggestions` +
 * `Place.fetchFields`) and render our own themed dropdown. This keeps the
 * luxury look AND runs on the "Places API (New)" SKU.
 *
 * The Maps script is loaded by google-maps-loader (libraries=places,marker),
 * which resolves the browser key at runtime — so nothing here reads env.
 */

import { loadGoogleMaps } from "./google-maps-loader";

export interface PlaceAddress {
  line1: string;
  line2: string;
  area: string;
  city: string;
  state: string;
  country: string;
  country_code: string;
  postal_code: string;
  latitude: number | null;
  longitude: number | null;
  google_maps_url: string;
  formatted_address: string;
}

export interface PlaceSuggestion {
  placeId: string;
  primary: string;
  secondary: string;
  prediction: google.maps.places.PlacePrediction;
}

async function placesLib(): Promise<google.maps.PlacesLibrary | null> {
  const g = await loadGoogleMaps();
  if (!g) return null;
  // Prefer importLibrary — the officially recommended path that guarantees the
  // new Places classes (AutocompleteSuggestion, Place) are loaded. Fall back to
  // the already-populated namespace (the script loads with libraries=places).
  try {
    if (g.maps.importLibrary) {
      return await g.maps.importLibrary("places");
    }
  } catch {
    /* fall through to the namespace */
  }
  return (g.maps?.places as unknown as google.maps.PlacesLibrary) ?? null;
}

/** True when the new Places API is reachable (key set + library loaded). */
export async function placesAvailable(): Promise<boolean> {
  try {
    const lib = await placesLib();
    return Boolean(lib && lib.AutocompleteSuggestion);
  } catch {
    return false;
  }
}

/** A fresh per-session token (groups keystrokes + the detail fetch for billing). */
export function newSessionToken():
  | google.maps.places.AutocompleteSessionToken
  | undefined {
  try {
    return new google.maps.places.AutocompleteSessionToken();
  } catch {
    return undefined;
  }
}

/** Fetch typeahead predictions for the current query. Returns [] on any miss. */
export async function fetchSuggestions(
  input: string,
  opts: {
    sessionToken?: google.maps.places.AutocompleteSessionToken;
    regionCodes?: string[] | null;
  } = {},
): Promise<PlaceSuggestion[]> {
  const lib = await placesLib();
  if (!lib || !input.trim()) return [];
  const req: google.maps.places.AutocompleteRequest = {
    input,
    sessionToken: opts.sessionToken,
  };
  if (opts.regionCodes && opts.regionCodes.length) {
    req.includedRegionCodes = opts.regionCodes;
  }
  const { suggestions } =
    await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions(req);
  const out: PlaceSuggestion[] = [];
  for (const s of suggestions) {
    const p = s.placePrediction;
    if (!p) continue;
    out.push({
      placeId: p.placeId,
      primary: p.mainText?.text ?? p.text?.text ?? "",
      secondary: p.secondaryText?.text ?? "",
      prediction: p,
    });
  }
  return out;
}

/** Resolve a chosen prediction into a structured, persistable address. */
export async function resolvePlace(
  prediction: google.maps.places.PlacePrediction,
): Promise<PlaceAddress | null> {
  const { place } = await prediction.toPlace().fetchFields({
    fields: ["addressComponents", "formattedAddress", "location", "googleMapsURI"],
  });
  return parsePlace(place);
}

function pick(
  comps: google.maps.places.AddressComponent[],
  ...types: string[]
): string {
  const m = comps.find((c) => types.some((t) => c.types.includes(t)));
  return m?.longText ?? "";
}
function pickShort(
  comps: google.maps.places.AddressComponent[],
  ...types: string[]
): string {
  const m = comps.find((c) => types.some((t) => c.types.includes(t)));
  return m?.shortText ?? "";
}

export function parsePlace(place: google.maps.places.Place): PlaceAddress {
  const comps = place.addressComponents ?? [];
  const streetNumber = pick(comps, "street_number");
  const route = pick(comps, "route");
  const premise = pick(comps, "premise", "establishment", "point_of_interest");
  const line1 =
    [streetNumber, route].filter(Boolean).join(" ") ||
    premise ||
    (place.formattedAddress?.split(",")[0] ?? "");
  const loc = place.location;
  return {
    line1,
    line2: premise && premise !== line1 ? premise : "",
    area: pick(comps, "sublocality_level_1", "sublocality", "neighborhood"),
    city: pick(comps, "locality", "postal_town", "administrative_area_level_2"),
    state: pick(comps, "administrative_area_level_1"),
    country: pick(comps, "country"),
    country_code: pickShort(comps, "country"),
    postal_code: pick(comps, "postal_code"),
    latitude: loc ? loc.lat() : null,
    longitude: loc ? loc.lng() : null,
    google_maps_url: place.googleMapsURI ?? "",
    formatted_address: place.formattedAddress ?? "",
  };
}

export interface DeviceCoords {
  latitude: number;
  longitude: number;
  google_maps_url: string;
}

/**
 * Capture the device's GPS coordinates (HTTPS + user permission). No Maps key
 * needed — a reliable lat/lng fallback even when Places autocomplete is off.
 */
export function captureDeviceLocation(): Promise<DeviceCoords> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      reject(new Error("Location isn't supported on this device"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        resolve({
          latitude,
          longitude,
          google_maps_url: `https://www.google.com/maps?q=${latitude},${longitude}`,
        });
      },
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? "Location permission denied — you can type your address instead"
              : "Couldn't get your location — please type your address",
          ),
        ),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  });
}
