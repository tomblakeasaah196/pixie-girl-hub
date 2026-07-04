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
const bizRepo = require("../business_setup/business-config.repo");
const currencyService = require("../../services/currency.service");

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

/** Delivery fee for the customer's picked coordinates/zone code. */
function deliveryQuote({ brand, lat, lng, country, qty }) {
  return zones.quote({ brand, lat, lng, country_code: country, qty });
}

/**
 * Read-only shipping rate card for the storefront. NGN fees per country (and
 * the local geofenced zones). The site converts to the display currency using
 * the rates from /currency.
 */
function shippingRates({ brand }) {
  return zones.shippingRates({ brand });
}

/**
 * Geo picker options for the checkout autofill (countries, Nigerian states,
 * Lagos LGAs) — codes match the delivery zones so the quote resolves exactly.
 */
function geoOptions({ brand }) {
  return zones.geoOptions({ brand });
}

/**
 * Parametric currency feed for the storefront toolbar + price display.
 *
 * Returns every ACTIVE currency that has a resolvable rate, each with its
 * symbol / decimals / rounding + `rate_to_ngn` (NGN per 1 unit; display =
 * ngn / rate) from the SSOT, and a `settlement` flag (whether the store can
 * CHARGE in it — a Nomba/Stripe account exists and it's marked is_settlement).
 * `default` is the geo-resolved display currency for the visitor's country,
 * falling back to NGN. Adding a currency (GBP/EUR/…) is therefore admin-only:
 * activate it under Settings → Currencies and set its rate under FX rates.
 */
async function currencies({ brand, country }) {
  const active = await currencyService.listActiveCurrencies();
  const out = [];
  for (const c of active) {
    const rate = await currencyService.systemFxRate({
      brand,
      currency: c.currency_code,
    });
    if (rate == null || !(rate > 0)) continue; // no rate → can't show a price
    out.push({
      code: c.currency_code,
      name: c.display_name,
      symbol: c.symbol,
      decimals: Number(c.decimal_places),
      rounding_unit: Number(c.rounding_unit) || 1,
      rate_to_ngn: c.currency_code === "NGN" ? 1 : rate,
      settlement: !!c.is_settlement,
    });
  }
  // Default display currency, mirroring the landing's GeoIP rule and extending
  // it parametrically: prefer the visitor's LOCAL currency when we can display
  // it (e.g. GB → GBP once GBP is active + rated); else fall back to USD for any
  // non-Nigerian visitor (exactly what the landing does — non-NG → USD); else
  // NGN. `currencyForCountry` already maps unknown non-NG countries to USD.
  const cc = String(country || "").toUpperCase();
  const geoCur = currencyForCountry(country);
  const displayable = (code) => out.some((c) => c.code === code);
  let def = "NGN";
  if (displayable(geoCur)) def = geoCur;
  else if (cc && cc !== "NG" && displayable("USD")) def = "USD";
  return { base: "NGN", default: def, currencies: out };
}

/** Business pickup address for the storefront "collect in store" option. */
async function pickupAddress({ brand }) {
  const config = await bizRepo.findByKey(brand);
  if (!config) return { address: null, phone: null };
  return { address: config.address || null, phone: config.phone || null };
}

module.exports = {
  resolveCurrency,
  currencies,
  deliveryQuote,
  shippingRates,
  geoOptions,
  pickupAddress,
  currencyForCountry,
};
