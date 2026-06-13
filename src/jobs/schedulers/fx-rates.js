/**
 * Daily FX rate refresh (J-3 / V2.2 §5.2). Runs 06:00 Africa/Lagos.
 *
 * Pulls live rates for the active non-NGN currencies from the env-configured
 * provider (fx.service), applies the configured buffer, and appends rows to
 * shared.currency_rates (append-only; lookups take the latest by valid_at).
 *
 * No provider configured (FX_PROVIDER=none / missing key) → no-op, logged. The
 * rate source stays manual-override until creds are added.
 */

"use strict";

const { query } = require("../../config/database");
const { logger } = require("../../config/logger");
const { config } = require("../../config/env");
const fx = require("../../services/fx.service");

async function activeNonBaseCurrencies() {
  const { rows } = await query(
    `SELECT currency_code FROM shared.currencies
      WHERE is_active = true AND currency_code <> $1`,
    [config.FX_BASE_CURRENCY],
  );
  return rows.map((r) => r.currency_code);
}

async function runFxRateRefresh() {
  if (!fx.isConfigured()) {
    logger.info(
      { provider: config.FX_PROVIDER },
      "fx rate refresh skipped — no provider configured",
    );
    return { updated: 0, skipped: true };
  }

  let currencies;
  try {
    currencies = await activeNonBaseCurrencies();
  } catch (err) {
    logger.error({ err: err.message }, "fx refresh: currency lookup failed");
    return { updated: 0 };
  }

  let rates;
  try {
    rates = await fx.fetchRatesToNGN(currencies);
  } catch (err) {
    logger.error({ err: err.message }, "fx refresh: provider fetch failed");
    return { updated: 0 };
  }
  if (!rates) return { updated: 0, skipped: true };

  const buffer = 1 + Number(config.FX_BUFFER_PCT || 0);
  const source = `auto:${config.FX_PROVIDER}`;
  let updated = 0;
  for (const [cur, marketRate] of Object.entries(rates)) {
    if (!(marketRate > 0)) continue;
    const buffered = (marketRate * buffer).toFixed(6);
    try {
      await query(
        `INSERT INTO shared.currency_rates
           (from_currency, to_currency, rate, source, is_manual_override, valid_at)
         VALUES ($1, $2, $3, $4, false, now())`,
        [cur, config.FX_BASE_CURRENCY, buffered, source],
      );
      updated += 1;
    } catch (err) {
      logger.warn(
        { err: err.message, currency: cur },
        "fx refresh: rate insert failed",
      );
    }
  }
  logger.info(
    { updated, provider: config.FX_PROVIDER },
    "fx rate refresh done",
  );
  return { updated };
}

module.exports = { runFxRateRefresh };
