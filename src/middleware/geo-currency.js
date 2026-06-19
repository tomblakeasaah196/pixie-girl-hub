/**
 * Geo-currency routing middleware.
 *
 * Attaches two properties to every request, derived from the client IP:
 *   req.geoCountry   — ISO 3166-1 alpha-2 code (e.g. 'NG') or null
 *   req.geoCurrency  — storefront currency code (NGN | USD | GBP | EUR | CAD | GHS)
 *
 * Resolution order:
 *   1. MaxMind local lookup → ISO country code
 *   2. COUNTRY_CURRENCY_MAP[code] → supported currency
 *   3. Falls back to DEFAULT_CURRENCY ('USD') when code is absent/unmapped.
 *
 * Always calls next() — geo failure is never fatal. Sub-millisecond: the mmdb
 * lookup is a pure in-memory trie walk with no I/O.
 *
 * Mounted in applyGlobalMiddleware (middleware/index.js) so all routes —
 * storefront public, authenticated ERP, webhooks — have geo context available.
 * The storefront's SSR layer reads req.geoCurrency from the
 * GET /api/public/geo/currency response to initialise the price display.
 */

"use strict";

const geoip = require("../services/geoip");

/**
 * Map of ISO country codes → supported storefront currencies.
 * Currencies: NGN (Nigeria), USD (US + rest-of-world default),
 * GBP (UK), EUR (Eurozone), CAD (Canada), GHS (Ghana).
 */
const COUNTRY_CURRENCY_MAP = {
  // Nigerian Naira
  NG: "NGN",

  // British Pound
  GB: "GBP",

  // Canadian Dollar
  CA: "CAD",

  // Ghanaian Cedi
  GH: "GHS",

  // Eurozone members (ISO 4217 / EU membership as of 2024)
  AD: "EUR",
  AT: "EUR",
  BE: "EUR",
  CY: "EUR",
  EE: "EUR",
  FI: "EUR",
  FR: "EUR",
  DE: "EUR",
  GR: "EUR",
  IE: "EUR",
  IT: "EUR",
  LV: "EUR",
  LT: "EUR",
  LU: "EUR",
  MT: "EUR",
  MC: "EUR",
  ME: "EUR",
  NL: "EUR",
  PT: "EUR",
  SM: "EUR",
  SK: "EUR",
  SI: "EUR",
  ES: "EUR",
  VA: "EUR",
  XK: "EUR",

  // US Dollar — United States and territories
  US: "USD",
  PR: "USD",
  GU: "USD",
  VI: "USD",
  AS: "USD",
  MP: "USD",
};

/** Currency to assign when no mapping exists for the detected country. */
const DEFAULT_CURRENCY = "USD";

/**
 * @param {import('express').Request}  req
 * @param {import('express').Response} _res
 * @param {import('express').NextFunction} next
 */
function geoCurrencyMiddleware(req, _res, next) {
  const isoCode = geoip.lookupCountry(req.ip);
  req.geoCountry = isoCode;
  req.geoCurrency =
    (isoCode && COUNTRY_CURRENCY_MAP[isoCode]) || DEFAULT_CURRENCY;
  next();
}

module.exports = {
  geoCurrencyMiddleware,
  COUNTRY_CURRENCY_MAP,
  DEFAULT_CURRENCY,
};
