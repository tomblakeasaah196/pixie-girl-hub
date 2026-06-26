/**
 * USD bulk-reprice (Catalogue → Config "Apply USD exchange rate") — business
 * logic. Transaction + snapshot + audit + event.
 *
 * Owner directive: an admin enters ONE NGN-per-USD rate and every USD price in
 * the catalogue is recomputed from its NGN value. This is a deliberate, audited
 * write into the (manual) USD columns — not a live render-time FX recompute. The
 * prior values are snapshotted so the last apply can be undone.
 */

"use strict";

const repo = require("./usd-reprice.repo");
const events = require("./catalogue.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const fx = require("../../services/fx.service");
const { AppError } = require("../../utils/errors");
const { money, charmRound, Decimal } = require("../../utils/money");

/**
 * JS mirror of usd-reprice.repo.roundExpr — converts an NGN amount to USD at a
 * rate under the chosen rounding. Used for the preview math and unit tests; the
 * apply path runs the equivalent SQL set-based. Keep the two in sync.
 *
 * @param {number|string|null} ngn
 * @param {number|string} rate  NGN per 1 USD
 * @param {'exact'|'whole'|'ninety_nine'} rounding
 * @returns {number|null}
 */
function roundUsd(ngn, rate, rounding = "exact") {
  if (ngn === null || ngn === undefined) return null;
  const x = money(ngn).dividedBy(money(rate));
  if (rounding === "whole")
    return Number(x.toDecimalPlaces(0, Decimal.ROUND_HALF_UP));
  if (rounding === "ninety_nine") return Number(charmRound(x, "USD"));
  return Number(x.toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
}

/** Every section a run touches (recorded on the run for the audit trail). */
const FULL_SCOPE = Object.fromEntries(repo.TABLES.map((t) => [t.key, true]));

/** Status for the modal: last applied rate (+ who/when), live market hint, and
 *  the per-section counts a run would touch right now. */
async function getStatus({ brand }) {
  const [status, counts, market] = await Promise.all([
    repo.status({ brand }),
    repo.counts({ brand }),
    marketRate(),
  ]);
  return { ...status, counts, market_rate: market.rate };
}

/** The live NGN-per-USD market rate (informational hint), or null when no FX
 *  provider is configured / the lookup fails. Never throws into the request. */
async function marketRate() {
  try {
    if (!fx.isConfigured()) return { rate: null };
    const rates = await fx.fetchRatesToNGN(["USD"]);
    return { rate: rates && rates.USD ? Number(rates.USD) : null };
  } catch {
    return { rate: null };
  }
}

/** Read-only preview: per-section counts + a 3–5 product before/after sample. */
async function preview({ brand, rate, rounding }) {
  const [counts, sample] = await Promise.all([
    repo.counts({ brand }),
    repo.sampleStyled({ brand, limit: 5 }),
  ]);
  const rows = sample.map((s) => ({
    name: s.name,
    ngn: s.retail_price_ngn !== null ? Number(s.retail_price_ngn) : null,
    current_usd:
      s.retail_price_usd !== null ? Number(s.retail_price_usd) : null,
    new_usd: roundUsd(s.retail_price_ngn, rate, rounding),
  }));
  return { rate: Number(rate), rounding, counts, sample: rows };
}

/** Apply the rate across the catalogue (transactional), snapshot prior values,
 *  record the run, persist the last rate, audit + emit. */
async function apply({ brand, user, request_id, rate, rounding, confirm }) {
  if (confirm !== true)
    throw new AppError(
      "CONFIRMATION_REQUIRED",
      "USD reprice attempted without confirmation",
      400,
      { user_message: "Tick the confirmation box before applying the rate." },
    );

  const result = await transaction(async (client) => {
    const { snapshot, counts, rows_changed } = await repo.applyAll({
      client,
      brand,
      rate,
      rounding,
    });
    const run = await repo.insertRun({
      client,
      brand,
      rate,
      rounding,
      scope: FULL_SCOPE,
      rows_changed,
      snapshot,
      applied_by: user ? user.user_id : null,
    });
    await repo.setConfigRate({
      client,
      brand,
      rate,
      user_id: user ? user.user_id : null,
    });
    return { run_id: run.run_id, applied_at: run.applied_at, counts, rows_changed };
  });

  events.emit("usd_reprice.applied", {
    brand,
    run_id: result.run_id,
    rate: Number(rate),
    rounding,
    rows_changed: result.rows_changed,
  });
  await audit({
    business: brand,
    user_id: user ? user.user_id : null,
    action_key: "catalogue.usd_reprice.applied",
    target_type: "catalogue_usd_reprice_run",
    target_id: result.run_id,
    after: {
      rate: Number(rate),
      rounding,
      rows_changed: result.rows_changed,
      counts: result.counts,
    },
    is_sensitive: true,
    request_id,
  });

  return {
    run_id: result.run_id,
    rate: Number(rate),
    rounding,
    rows_changed: result.rows_changed,
    counts: result.counts,
    applied_at: result.applied_at,
  };
}

/** Undo the last (non-undone) run — restore every snapshotted USD value. */
async function undo({ brand, user, request_id }) {
  const run = await repo.latestRun({ brand });
  if (!run)
    throw new AppError("NOTHING_TO_UNDO", "No reprice run to undo", 404, {
      user_message: "There is no USD reprice to undo.",
    });

  const rows_restored = await transaction(async (client) => {
    const restored = await repo.restoreSnapshot({
      client,
      brand,
      snapshot: run.snapshot,
    });
    await repo.markUndone({
      client,
      brand,
      run_id: run.run_id,
      user_id: user ? user.user_id : null,
    });
    return restored;
  });

  events.emit("usd_reprice.undone", { brand, run_id: run.run_id, rows_restored });
  await audit({
    business: brand,
    user_id: user ? user.user_id : null,
    action_key: "catalogue.usd_reprice.undone",
    target_type: "catalogue_usd_reprice_run",
    target_id: run.run_id,
    after: { rows_restored },
    is_sensitive: true,
    request_id,
  });

  return { run_id: run.run_id, rows_restored };
}

module.exports = {
  roundUsd,
  getStatus,
  marketRate,
  preview,
  apply,
  undo,
};
