/**
 * Currency SSOT helper — the single place the storefront + settlement read
 * "what currencies exist" and "what is 1 unit worth in NGN".
 *
 * All money in the Hub is anchored in NGN. A foreign figure (display OR charge)
 * is always NGN ÷ rate, where `rate` = NGN per 1 unit of that currency. This
 * module resolves that rate from ONE authority per currency so display and
 * settlement can never disagree:
 *
 *   • NGN            → 1 (the anchor).
 *   • USD            → the brand catalogue tool's `catalogue_config.usd_fx_rate`
 *                      (Catalogue → Config → "Apply USD exchange rate"). This is
 *                      the rate the storefront already displays + settles at, so
 *                      USD figures are byte-identical to before this change.
 *                      Falls back to a manual `shared.currency_rates` USD row if
 *                      the catalogue rate was never set.
 *   • everything else→ the latest `shared.currency_rates` row (from_currency→NGN),
 *                      preferring an admin manual override over an auto-refreshed
 *                      provider rate. This is the "system exchange rate" an admin
 *                      sets under Settings → Currencies / FX rates.
 *
 * Returns null when no rate is configured for a currency — the caller then
 * treats it as not displayable / not settleable (never guesses a rate).
 *
 * CHARGING is limited to SETTLEMENT_CURRENCIES (NGN + USD — what Nomba settles).
 * A currency can be display-only (shown in the toolbar, prices converted) — the
 * buyer SEES it but is charged in USD. `is_settlement` on `shared.currencies`
 * no longer widens that set.
 */

"use strict";

const { query } = require("../config/database");
const { VALID } = require("../config/brands");

/** Active currencies from the shared registry, in display order. */
async function listActiveCurrencies() {
  const { rows } = await query(
    `SELECT currency_code, display_name, symbol, decimal_places, rounding_unit,
            is_settlement, display_order
       FROM shared.currencies
      WHERE is_active = true
      ORDER BY display_order, currency_code`,
  );
  return rows;
}

/** The brand catalogue tool's USD rate (NGN per $1). Null when never applied. */
async function catalogueUsdRate(brand) {
  if (!VALID.has(brand)) return null;
  try {
    const { rows } = await query(
      `SELECT usd_fx_rate FROM ${brand}.catalogue_config WHERE singleton = true`,
    );
    const r = rows[0] && rows[0].usd_fx_rate;
    return r != null && Number(r) > 0 ? Number(r) : null;
  } catch {
    return null;
  }
}

/** Latest shared.currency_rates rate for CUR→NGN, preferring a manual override
 *  (an admin-set "system rate") over an auto-refreshed provider rate. */
async function sharedRate(currency, { manualOnly = false } = {}) {
  const cur = String(currency || "").toUpperCase();
  if (!cur || cur === "NGN") return null;
  try {
    // Prefer the most recent MANUAL override; only then fall back to the most
    // recent auto row — so an admin's set rate is sticky against the daily FX
    // refresh appending newer auto rows.
    const { rows } = await query(
      `SELECT rate
         FROM shared.currency_rates
        WHERE from_currency = $1 AND to_currency = 'NGN'
          ${manualOnly ? "AND is_manual_override = true" : ""}
        ORDER BY is_manual_override DESC, valid_at DESC
        LIMIT 1`,
      [cur],
    );
    const r = rows[0] && rows[0].rate;
    return r != null && Number(r) > 0 ? Number(r) : null;
  } catch {
    return null;
  }
}

/**
 * NGN per 1 unit of `currency` for `brand`. See the module header for the
 * per-currency authority. Returns null when no rate is configured.
 */
async function systemFxRate({ brand, currency }) {
  const cur = String(currency || "NGN").toUpperCase();
  if (cur === "NGN") return 1;
  if (cur === "USD") {
    // USD authority = the catalogue tool (the storefront's existing SSOT);
    // a manual currency_rates USD override wins if an admin set one.
    const manual = await sharedRate("USD", { manualOnly: true });
    if (manual) return manual;
    const cat = await catalogueUsdRate(brand);
    if (cat) return cat;
    return sharedRate("USD");
  }
  // Other currencies: the shared currency_rates SSOT (admin manual > auto).
  return sharedRate(cur);
}

/**
 * The only currencies a checkout may charge in. Nomba — the sole gateway from
 * Sept 2026 — settles Naira and US Dollars on one account; nothing else may
 * reach a gateway, whatever `is_settlement` says on a shared.currencies row.
 */
const SETTLEMENT_CURRENCIES = Object.freeze(["NGN", "USD"]);

/**
 * Resolve the currency an order should SETTLE (charge) in, given the buyer's
 * chosen DISPLAY currency:
 *   • NGN display          → settle NGN.
 *   • any foreign display  → settle USD — the buyer sees their currency but
 *     pays dollars. A GBP/EUR row flagged is_settlement no longer routes a
 *     GBP/EUR charge to the gateway (Nomba takes NGN + USD only).
 */
async function resolveSettlementCurrency({ displayCurrency }) {
  const disp = String(displayCurrency || "NGN").toUpperCase();
  return disp === "NGN" ? "NGN" : "USD";
}

module.exports = {
  SETTLEMENT_CURRENCIES,
  listActiveCurrencies,
  systemFxRate,
  resolveSettlementCurrency,
  catalogueUsdRate,
  sharedRate,
};
