/**
 * Geoapify reverse geocoding (HR clock-in location labels).
 *
 * Turns the coordinates captured at clock-in into a human address ONCE, at
 * punch time, server-side. The UI never geocodes on render — it displays the
 * stored label and links the stored coordinates to a map.
 *
 * Best-effort BY DESIGN: returns null on a missing key, bad coords, timeout
 * or any upstream error — it must never throw, so a slow or down Geoapify
 * can't break clock-in. Callers must invoke it OUTSIDE any DB transaction so
 * the HTTP wait never holds a connection open.
 *
 * Env: GEOAPIFY_API_KEY (blank = coords + map pin still work, no label).
 * Free tier is 3,000 requests/day — ample for clock-ins.
 */

"use strict";

const axios = require("axios");
const { logger } = require("../config/logger");

const REVERSE_URL = "https://api.geoapify.com/v1/geocode/reverse";
const TIMEOUT_MS = 3000;

async function reverseGeocode(lat, lng) {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey) return null;
  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (
    lat === null || lat === undefined || lng === null || lng === undefined ||
    Number.isNaN(latNum) || Number.isNaN(lngNum)
  ) {
    return null;
  }
  try {
    // Geoapify's param names are lat/lon (not lng).
    const { data } = await axios.get(REVERSE_URL, {
      params: { lat: latNum, lon: lngNum, format: "json", limit: 1, apiKey },
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

module.exports = { reverseGeocode };
