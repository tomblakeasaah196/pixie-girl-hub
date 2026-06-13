/**
 * FX rate provider (J-3). Env-driven, pluggable, and OFF by default.
 *
 * Configure via env:
 *   FX_PROVIDER     none | exchangerate_host | openexchangerates | fixer
 *   FX_API_KEY      provider key (required by all but exchangerate_host's free tier)
 *   FX_API_BASE_URL optional base URL override
 *   FX_BASE_CURRENCY default 'NGN'
 *
 * `fetchRatesToNGN(currencies)` returns a map { USD: <units of NGN per 1 USD>, … }
 * or `null` when no provider is configured (so the refresh cron no-ops cleanly).
 * Network/shape errors throw — the caller logs and skips that run.
 */

"use strict";

const axios = require("axios");
const { config } = require("../config/env");
const { logger } = require("../config/logger");

function isConfigured() {
  if (config.FX_PROVIDER === "none") return false;
  // exchangerate_host has a free no-key tier; the others need a key.
  if (config.FX_PROVIDER !== "exchangerate_host" && !config.FX_API_KEY)
    return false;
  return true;
}

/**
 * @param {string[]} currencies non-NGN currency codes to price (e.g. ['USD','GBP'])
 * @returns {Promise<Record<string, number>|null>} { CUR: rate_to_NGN } or null
 */
async function fetchRatesToNGN(currencies) {
  if (!isConfigured()) return null;
  const wanted = (currencies || []).filter((c) => c && c !== "NGN");
  if (!wanted.length) return {};

  switch (config.FX_PROVIDER) {
    case "exchangerate_host":
      return viaExchangerateHost(wanted);
    case "openexchangerates":
      return viaBaseRelative(
        config.FX_API_BASE_URL || "https://openexchangerates.org/api",
        "/latest.json",
        { app_id: config.FX_API_KEY },
        wanted,
      );
    case "fixer":
      return viaBaseRelative(
        config.FX_API_BASE_URL || "https://data.fixer.io/api",
        "/latest",
        { access_key: config.FX_API_KEY },
        wanted,
      );
    default:
      logger.warn(
        { provider: config.FX_PROVIDER },
        "unknown FX provider — skipping",
      );
      return null;
  }
}

// exchangerate.host: base=NGN gives NGN→X; invert for X→NGN.
async function viaExchangerateHost(wanted) {
  const base = config.FX_API_BASE_URL || "https://api.exchangerate.host";
  const params = { base: "NGN", symbols: wanted.join(",") };
  if (config.FX_API_KEY) params.access_key = config.FX_API_KEY;
  const { data } = await axios.get(`${base}/latest`, {
    params,
    timeout: 15000,
  });
  if (!data || !data.rates)
    throw new Error("exchangerate_host: no rates in response");
  const out = {};
  for (const cur of wanted) {
    const ngnToX = Number(data.rates[cur]);
    if (ngnToX > 0) out[cur] = 1 / ngnToX;
  }
  return out;
}

// Providers that return rates relative to a response base (USD/EUR). Compute
// X→NGN = rates.NGN / rates.X.
async function viaBaseRelative(baseUrl, path, params, wanted) {
  const { data } = await axios.get(`${baseUrl}${path}`, {
    params: { ...params, symbols: [...wanted, "NGN"].join(",") },
    timeout: 15000,
  });
  if (!data || !data.rates || !data.rates.NGN)
    throw new Error("FX provider: NGN rate missing in response");
  const ngn = Number(data.rates.NGN);
  const out = {};
  for (const cur of wanted) {
    const x = Number(data.rates[cur]);
    if (x > 0) out[cur] = ngn / x;
  }
  return out;
}

module.exports = { isConfigured, fetchRatesToNGN };
