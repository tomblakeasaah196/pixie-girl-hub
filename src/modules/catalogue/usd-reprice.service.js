/**
 * USD bulk-reprice (Catalogue → Config "Apply USD exchange rate") — business
 * logic. Transaction + snapshot + audit + event.
 *
 * Owner directive: an admin enters ONE NGN-per-USD rate and every USD price in
 * the catalogue is recomputed from its NGN value. This is a deliberate, audited
 * write into the (manual) USD columns — not a live render-time FX recompute. The
 * prior values are snapshotted so the last apply can be undone.
 *
 * The rate is also what every dollar checkout, pay link and Nomba USD credit
 * converts at, so changing it needs the CEO (workflow catalogue:
 * usd_rate_change). The CEO applies directly; anyone else's Apply becomes a
 * pending request the CEO approves (which applies it, in the same transaction)
 * or rejects. One request at a time. Undo is a rate change too — CEO only.
 */

"use strict";

const repo = require("./usd-reprice.repo");
const events = require("./catalogue.events");
const { audit } = require("../../middleware/audit");
const { transaction, ex } = require("../../config/database");
const fx = require("../../services/fx.service");
const wf = require("../../workflows/engine");
const { randomUUID } = require("crypto");
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
  const [status, counts, market, pending] = await Promise.all([
    repo.status({ brand }),
    repo.counts({ brand }),
    marketRate(),
    pendingRequest({ brand }),
  ]);
  return {
    ...status,
    counts,
    market_rate: market.rate,
    pending_request: pending,
  };
}

// ── Rate-change approval ──────────────────────────────────
// Workflow instances need a reference; a requested rate has no row of its own,
// so the instance IS the request (its context carries the rate) under this
// reference_table, with a fresh id per request.
const RATE_CHANGE_REF = "catalogue_usd_rate_changes";

/** The open request for this brand, as the modal shows it, or null. */
async function pendingRequest({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT wi.instance_id, wi.context, wi.initiated_at, wi.initiated_by,
            u.email AS requested_by_email
       FROM shared.workflow_instances wi
       LEFT JOIN shared.users u ON u.user_id = wi.initiated_by
      WHERE wi.business = $1 AND wi.reference_table = $2 AND wi.status = 'pending'
      ORDER BY wi.initiated_at DESC
      LIMIT 1`,
    [brand, RATE_CHANGE_REF],
  );
  const r = rows[0];
  if (!r) return null;
  const ctx = r.context || {};
  return {
    instance_id: r.instance_id,
    rate: Number(ctx.rate),
    rounding: ctx.rounding,
    current_rate: ctx.current_rate === null || ctx.current_rate === undefined ? null : Number(ctx.current_rate),
    requested_by: r.initiated_by,
    requested_by_email: r.requested_by_email || null,
    requested_at: r.initiated_at,
  };
}

const fmtRate = (r) => `₦${Number(r).toLocaleString("en-NG")}/$1`;

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

/**
 * Reprice the catalogue at `rate` inside `client`'s transaction: snapshot the
 * prior values, record the run, persist the rate. Shared by a CEO's direct
 * Apply and an approved request.
 */
async function applyWithClient({ client, brand, user, rate, rounding }) {
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
}

/** Post-commit: event + audit for an applied rate. */
async function recordApplied({ brand, user, request_id, rate, rounding, result, approved_request }) {
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
      approved_request: approved_request || null,
    },
    is_sensitive: true,
    request_id,
  });
  return {
    status: "applied",
    run_id: result.run_id,
    rate: Number(rate),
    rounding,
    rows_changed: result.rows_changed,
    counts: result.counts,
    applied_at: result.applied_at,
  };
}

/**
 * Apply the rate. The CEO's Apply reprices immediately; anyone else's opens a
 * CEO approval request (returned as status 'pending_approval') and changes
 * nothing yet. Refused while another request is waiting.
 */
async function apply({ brand, user, request_id, rate, rounding, confirm }) {
  if (confirm !== true)
    throw new AppError(
      "CONFIRMATION_REQUIRED",
      "USD reprice attempted without confirmation",
      400,
      { user_message: "Tick the confirmation box before applying the rate." },
    );

  if (!(user && user.is_ceo))
    return requestRateChange({ brand, user, request_id, rate, rounding });

  const result = await transaction((client) =>
    applyWithClient({ client, brand, user, rate, rounding }),
  );
  return recordApplied({ brand, user, request_id, rate, rounding, result });
}

/** Open the CEO approval request for a rate change. */
async function requestRateChange({ brand, user, request_id, rate, rounding }) {
  const out = await transaction(async (client) => {
    if (await pendingRequest({ client, brand }))
      throw new AppError(
        "RATE_CHANGE_PENDING",
        "A USD rate change is already waiting for approval",
        409,
        {
          user_message:
            "A rate change is already waiting for the CEO. It has to be approved or rejected before another can be requested.",
        },
      );
    const { config } = await repo.status({ client, brand });
    const current = config && config.usd_fx_rate !== null ? Number(config.usd_fx_rate) : null;
    const instance = await wf.openInstance({
      client,
      business: brand,
      trigger_module: "catalogue",
      trigger_action: "usd_rate_change",
      reference_table: RATE_CHANGE_REF,
      reference_id: randomUUID(),
      opened_by: user ? user.user_id : null,
      context: {
        rate: Number(rate),
        rounding,
        current_rate: current,
        // Read by the approvals inbox as the task's one-line summary.
        description: current
          ? `${fmtRate(rate)} (now ${fmtRate(current)})`
          : fmtRate(rate),
      },
    });
    // A definition edited down to no applicable stage auto-approves: apply now.
    if (instance.status === "approved") {
      const result = await applyWithClient({ client, brand, user, rate, rounding });
      return { applied: result, instance };
    }
    return { applied: null, instance };
  });

  if (out.applied)
    return recordApplied({
      brand,
      user,
      request_id,
      rate,
      rounding,
      result: out.applied,
      approved_request: out.instance.instance_id,
    });

  await audit({
    business: brand,
    user_id: user ? user.user_id : null,
    action_key: "catalogue.usd_rate_change.requested",
    target_type: RATE_CHANGE_REF,
    target_id: out.instance.reference_id,
    after: {
      rate: Number(rate),
      rounding,
      workflow_instance_id: out.instance.instance_id,
    },
    is_sensitive: true,
    request_id,
  });
  return {
    status: "pending_approval",
    instance_id: out.instance.instance_id,
    rate: Number(rate),
    rounding,
  };
}

/** Load a pending request of THIS brand, or 404 — never act on another's. */
async function loadRequest({ client, brand, instance_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.workflow_instances
      WHERE instance_id = $1 AND business = $2 AND reference_table = $3`,
    [instance_id, brand, RATE_CHANGE_REF],
  );
  const inst = rows[0];
  if (!inst)
    throw new AppError("NOT_FOUND", "Rate change request not found", 404);
  if (inst.status !== "pending")
    throw new AppError(
      "INVALID_STATE",
      `This request is already ${inst.status}`,
      409,
      { user_message: `This rate change was already ${inst.status}.` },
    );
  return inst;
}

/**
 * The CEO approves a requested rate — which applies it, in the same
 * transaction as the decision, at the rate and rounding that were requested
 * (never re-read from the client). The engine enforces who may act.
 */
async function approveRateChange({ brand, user, request_id, instance_id, notes }) {
  const out = await transaction(async (client) => {
    const inst = await loadRequest({ client, brand, instance_id });
    const result = await wf.act({
      client,
      instance_id,
      user,
      action: "approve",
      notes,
    });
    if (result.status !== "approved") return { inst, applied: null };
    const ctx = inst.context || {};
    const applied = await applyWithClient({
      client,
      brand,
      user,
      rate: ctx.rate,
      rounding: ctx.rounding,
    });
    return { inst, applied };
  });
  if (!out.applied) return { status: "pending_approval", instance_id };
  const ctx = out.inst.context || {};
  return recordApplied({
    brand,
    user,
    request_id,
    rate: ctx.rate,
    rounding: ctx.rounding,
    result: out.applied,
    approved_request: instance_id,
  });
}

/** The CEO rejects a requested rate; nothing changes. */
async function rejectRateChange({ brand, user, request_id, instance_id, notes }) {
  const inst = await transaction(async (client) => {
    const found = await loadRequest({ client, brand, instance_id });
    await wf.act({ client, instance_id, user, action: "reject", notes });
    return found;
  });
  await audit({
    business: brand,
    user_id: user ? user.user_id : null,
    action_key: "catalogue.usd_rate_change.rejected",
    target_type: RATE_CHANGE_REF,
    target_id: inst.reference_id,
    after: { rate: Number((inst.context || {}).rate), notes: notes || null },
    is_sensitive: true,
    request_id,
  });
  return { status: "rejected", instance_id };
}

/** Undo the last (non-undone) run — restore every snapshotted USD value. */
async function undo({ brand, user, request_id }) {
  // Undo reprices the whole catalogue back — a rate change like any other, so
  // it is the CEO's call (otherwise it would bypass the approval).
  if (!(user && user.is_ceo))
    throw new AppError("CEO_ONLY", "Only the CEO can undo a USD reprice", 403, {
      user_message:
        "Only the CEO can undo a USD rate change. Ask them, or request the old rate instead.",
    });
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
  approveRateChange,
  rejectRateChange,
  pendingRequest,
  undo,
  RATE_CHANGE_REF,
};
