/**
 * Geoapify geocoding + map service.
 *
 * ONE server-side integration behind every map/address feature that used to
 * lean on Google Maps in the browser:
 *
 *  - reverseGeocode(lat, lng)   coords → a human address label (HR clock-in
 *                               labels, backfill).
 *  - autocomplete(text, bias)   a typed query → ranked address suggestions
 *                               with exact coordinates (the office-location
 *                               search box in HR settings).
 *  - staticMap({...})           a centred map image (PNG bytes) for the office
 *                               location picker — rendered as a plain <img>, so
 *                               there is no browser Maps SDK to load or break.
 *  - testConnection({apiKey})  validates a candidate key (used by the
 *                               "Configure Geoapify" admin-UI Test button).
 *
 * The API key stays SERVER-SIDE by design (never shipped to the browser): the
 * admin app calls our own /attendance/geo/* proxy, which calls Geoapify. Free
 * tier is 3,000 requests/day — ample for HR usage.
 *
 * Key source: shared.geoapify_settings (encrypted, configured from HR & Staff
 * → Settings → "Configure Geoapify" — see geoapify-settings.service.js),
 * cached in-process for CACHE_TTL_MS to avoid a DB round trip per call.
 * GEOAPIFY_API_KEY in .env is read only as an emergency fallback when no
 * active row is configured — new deployments should configure the key in the
 * admin UI instead. geoapify-settings.service.js is required lazily (inside
 * getApiKey(), not at module load) since it requires this module back for
 * testConnection — a top-level require here would be a circular import.
 *
 * Best-effort BY DESIGN: reverseGeocode + autocomplete return null / [] on a
 * missing key, bad input, timeout or any upstream error — they must never
 * throw, so a slow or down Geoapify can't break clock-in or a form. staticMap
 * DOES surface an error (the proxy maps it to a 5xx) so the UI can degrade to
 * manual coordinate entry. Callers must invoke geocoders OUTSIDE any DB
 * transaction so the HTTP wait never holds a connection open.
 */

"use strict";

const axios = require("axios");
const { logger } = require("../config/logger");
const { AppError } = require("../utils/errors");

const REVERSE_URL = "https://api.geoapify.com/v1/geocode/reverse";
const AUTOCOMPLETE_URL = "https://api.geoapify.com/v1/geocode/autocomplete";
const STATICMAP_URL = "https://maps.geoapify.com/v1/staticmap";
const TIMEOUT_MS = 3000;
const STATICMAP_TIMEOUT_MS = 6000;

// Lagos — the default map centre / search bias when the caller has no better
// hint (both businesses are Lagos-based).
const DEFAULT_BIAS = { lat: 6.5244, lng: 3.3792 };

const CACHE_TTL_MS = 60_000;
let cachedKey = null;
let cachedAt = 0;

/** Drop the cached key so the next call re-resolves (e.g. right after a save). */
function invalidateKeyCache() {
  cachedKey = null;
  cachedAt = 0;
}

/**
 * Resolve the active API key: DB-stored key first, GEOAPIFY_API_KEY as a
 * fallback, cached for CACHE_TTL_MS. Never throws — a DB hiccup just falls
 * through to the env var (or null).
 */
async function getApiKey() {
  const now = Date.now();
  if (cachedKey !== null && now - cachedAt < CACHE_TTL_MS) return cachedKey;
  let dbKey = null;
  try {
    const geoapifySettings = require("../modules/geoapify_settings/geoapify-settings.service");
    dbKey = await geoapifySettings.resolveActiveApiKey();
  } catch (err) {
    logger.warn({ err: err.message }, "[geoapify] key resolution from DB failed, falling back to env");
  }
  cachedKey = dbKey || process.env.GEOAPIFY_API_KEY || null;
  cachedAt = now;
  return cachedKey;
}

/** Whether a Geoapify key is configured (drives graceful UI degradation). */
async function isConfigured() {
  return Boolean(await getApiKey());
}

function validCoord(lat, lng) {
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (
    lat === null || lat === undefined || lng === null || lng === undefined ||
    Number.isNaN(latNum) || Number.isNaN(lngNum) ||
    latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180
  ) {
    return null;
  }
  return { lat: latNum, lng: lngNum };
}

/**
 * Coordinates → human address label. Best-effort: returns null (never throws)
 * on a missing key, bad coords, timeout or upstream error.
 */
async function reverseGeocode(lat, lng) {
  const apiKey = await getApiKey();
  if (!apiKey) return null;
  const point = validCoord(lat, lng);
  if (!point) return null;
  try {
    // Geoapify's param names are lat/lon (not lng).
    const { data } = await axios.get(REVERSE_URL, {
      params: { lat: point.lat, lon: point.lng, format: "json", limit: 1, apiKey },
      timeout: TIMEOUT_MS,
    });
    return (
      // format=json shape …
      data?.results?.[0]?.formatted ||
      // … and the default GeoJSON shape, in case the format param is dropped.
      data?.features?.[0]?.properties?.formatted ||
      null
    );
  } catch (err) {
    logger.warn({ err: err.message }, "[geoapify] reverse geocode failed");
    return null;
  }
}

/**
 * Typed query → ranked address suggestions (each with exact coordinates).
 *
 * Biases results toward `bias` (or Lagos) so nearby/Nigerian matches rank
 * first, without hard-excluding anywhere (an office can be abroad). Best-effort:
 * returns [] (never throws) on a missing key, empty query, timeout or error.
 *
 * @param {string} text  the partial address the user is typing
 * @param {{lat?:number,lng?:number,limit?:number}} [opts]
 * @returns {Promise<Array<{formatted:string,lat:number,lng:number,place_id:string|null,category:string|null,address_line1:string|null,city:string|null,county:string|null,state:string|null,state_code:string|null,postcode:string|null,country:string|null,country_code:string|null}>>}
 */
async function autocomplete(text, opts = {}) {
  const apiKey = await getApiKey();
  if (!apiKey) return [];
  const q = typeof text === "string" ? text.trim() : "";
  if (q.length < 2) return [];
  const bias = validCoord(opts.lat, opts.lng) || DEFAULT_BIAS;
  const limit = Math.min(Math.max(Number(opts.limit) || 6, 1), 10);
  try {
    const { data } = await axios.get(AUTOCOMPLETE_URL, {
      params: {
        text: q,
        format: "json",
        limit,
        // proximity bias — ranks near the current pin (or Lagos) first.
        bias: `proximity:${bias.lng},${bias.lat}`,
        apiKey,
      },
      timeout: TIMEOUT_MS,
    });
    const results = Array.isArray(data?.results) ? data.results : [];
    return results
      .map((r) => ({
        formatted: r.formatted || r.address_line1 || "",
        lat: Number(r.lat),
        lng: Number(r.lon),
        place_id: r.place_id || null,
        category: r.category || r.result_type || null,
        // Structured components — added for the customer-onboarding delivery
        // address form (a full ship-to needs more than a label + coords).
        // Nigeria's LGA has no first-class slot in Geoapify's schema; it
        // surfaces as `county` (OSM admin_level=6), so that's the best fit.
        address_line1: r.address_line1 || r.street || r.name || null,
        city: r.city || r.town || r.village || null,
        county: r.county || null,
        state: r.state || null,
        state_code: r.state_code || null,
        postcode: r.postcode || null,
        country: r.country || null,
        country_code: r.country_code ? r.country_code.toUpperCase() : null,
      }))
      .filter((r) => r.formatted && !Number.isNaN(r.lat) && !Number.isNaN(r.lng));
  } catch (err) {
    logger.warn({ err: err.message }, "[geoapify] autocomplete failed");
    return [];
  }
}

/**
 * Centred static map image (raw PNG bytes) for the office-location picker.
 *
 * Returns just the map tiles — the marker + clock-in radius circle are drawn
 * as crisp DOM overlays on top of this image in the browser, so the image only
 * needs refetching when the centre or zoom changes (not on every radius tick).
 *
 * Unlike the geocoders this DOES throw on failure: the proxy turns it into a
 * 5xx and the picker degrades to manual coordinate entry, which is the honest
 * signal (a blank <img> would look "stuck loading", the exact bug we're fixing).
 *
 * @returns {Promise<{buffer:Buffer, contentType:string}>}
 */
async function staticMap({ lat, lng, zoom, width, height, style } = {}) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    const err = new Error("Geoapify not configured");
    err.code = "GEOAPIFY_NOT_CONFIGURED";
    throw err;
  }
  const point = validCoord(lat, lng) || DEFAULT_BIAS;
  const z = Math.min(Math.max(Number(zoom) || 16, 1), 20);
  const w = Math.min(Math.max(Math.round(Number(width) || 600), 100), 1000);
  const h = Math.min(Math.max(Math.round(Number(height) || 320), 100), 800);
  // Dark, low-chroma basemap that sits under the Maroon Noir glass without
  // fighting the maroon pin/circle overlays.
  const mapStyle = typeof style === "string" && style ? style : "dark-matter-brown";
  const { data, headers } = await axios.get(STATICMAP_URL, {
    params: {
      style: mapStyle,
      width: w,
      height: h,
      center: `lonlat:${point.lng},${point.lat}`,
      zoom: z,
      scaleFactor: 2, // retina-crisp
      apiKey,
    },
    responseType: "arraybuffer",
    timeout: STATICMAP_TIMEOUT_MS,
  });
  return {
    buffer: Buffer.from(data),
    contentType: headers?.["content-type"] || "image/png",
  };
}

/**
 * Confirm a candidate API key is live — validated via a reverse-geocode call
 * against a known coordinate (Geoapify has no dedicated "whoami"/account
 * endpoint). Used by geoapify-settings.service.js's "Test connection".
 */
async function testConnection({ apiKey }) {
  if (!apiKey) {
    throw new AppError("NO_TOKEN", "No Geoapify API key saved", 422);
  }
  try {
    const { data } = await axios.get(REVERSE_URL, {
      params: {
        lat: DEFAULT_BIAS.lat,
        lon: DEFAULT_BIAS.lng,
        format: "json",
        limit: 1,
        apiKey,
      },
      timeout: TIMEOUT_MS,
    });
    const sample_address =
      data?.results?.[0]?.formatted || data?.features?.[0]?.properties?.formatted || null;
    return { ok: true, sample_address };
  } catch (err) {
    const status = err.response && err.response.status;
    const body = err.response && err.response.data;
    const upstreamMsg =
      (body && (body.message || (body.error && (body.error.message || body.error)))) ||
      err.message;
    const message =
      status === 401 || status === 403 ? "Invalid Geoapify API key" : upstreamMsg || "Geoapify request failed";
    throw new AppError(
      "PROVIDER_PING_FAILED",
      message,
      status && status >= 400 && status < 500 ? status : 502,
    );
  }
}

module.exports = {
  reverseGeocode,
  autocomplete,
  staticMap,
  isConfigured,
  testConnection,
  invalidateKeyCache,
};
