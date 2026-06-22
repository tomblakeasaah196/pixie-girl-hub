/**
 * Storefront geo/currency + delivery-quote service (public).
 *
 * Currency rule: Nigeria shows & charges NGN. Everyone else SEES their local
 * currency (converted from the NGN price via FX) but is CHARGED in USD. We hand
 * the storefront the rates it needs:
 *   rate_to_ngn — NGN per 1 unit of the display currency (display = ngn / rate)
 *   usd_to_ngn  — NGN per 1 USD                       (usd charge = ngn / rate)
 *
 * FX is off by default (FX_PROVIDER=none); then rates are null and the
 * storefront falls back to NGN. Delivery fees come from the geofenced zones.
 */

"use strict";

const fx = require("../../services/fx.service");
const zones = require("../logistics/zones.service");

// ISO-2 country → display currency. Unknown non-NG countries default to USD.
const CURRENCY_BY_COUNTRY = {
  NG: "NGN",
  US: "USD",
  GB: "GBP",
  CA: "CAD",
  GH: "GHS",
  KE: "KES",
  ZA: "ZAR",
  AE: "AED",
  IE: "EUR",
  FR: "EUR",
  DE: "EUR",
  ES: "EUR",
  IT: "EUR",
  NL: "EUR",
};

function currencyForCountry(cc) {
  const up = String(cc || "NG").toUpperCase();
  if (up === "NG") return "NGN";
  return CURRENCY_BY_COUNTRY[up] || "USD";
}

async function resolveCurrency({ country }) {
  const cc = String(country || "NG").toUpperCase();
  const currency = currencyForCountry(cc);
  const charge_currency = cc === "NG" ? "NGN" : "USD";

  let rate_to_ngn = currency === "NGN" ? 1 : null;
  let usd_to_ngn = currency === "USD" ? null : null;
  let fx_enabled = false;

  const wanted = [...new Set([currency, "USD"])].filter((c) => c !== "NGN");
  if (wanted.length) {
    const rates = await fx.fetchRatesToNGN(wanted).catch(() => null);
    if (rates) {
      fx_enabled = true;
      if (currency !== "NGN") rate_to_ngn = rates[currency] ?? null;
      usd_to_ngn = rates.USD ?? null;
    }
  }

  return {
    country: cc,
    currency, // what to DISPLAY in
    charge_currency, // what the customer is CHARGED in
    rate_to_ngn, // NGN per 1 display-currency unit (display = ngn / rate)
    usd_to_ngn, // NGN per 1 USD (usd charge = ngn / rate)
    fx_enabled,
  };
}

/** Delivery fee for the customer's picked coordinates (geofenced zones). */
function deliveryQuote({ brand, lat, lng, country }) {
  return zones.quote({ brand, lat, lng, country_code: country });
}

/**
 * Read-only shipping rate card for the storefront. NGN fees per country (and
 * the local geofenced zones). The site converts to the display currency using
 * the rates from /currency.
 */
function shippingRates({ brand }) {
  return zones.shippingRates({ brand });
}

module.exports = {
  resolveCurrency,
  deliveryQuote,
  shippingRates,
  currencyForCountry,
};
