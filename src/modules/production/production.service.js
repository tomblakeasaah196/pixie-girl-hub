/**
 * Production & Landed Cost (V2.2 §6.24) — business logic.
 *
 * Production runs: open → advance through the factory→Lagos→styled statuses;
 * cost components append (the DB trigger rolls them up to the run's landed
 * cost); finished units post a `production_in` movement to Stock (SSOT).
 * Service jobs: pending → in_progress → completed (the DB trigger auto-creates
 * a staff task on insert). G-1: a deposit-triggered order opens a styling
 * service job so work begins once the deposit clears.
 */

"use strict";

const repo = require("./production.repo");
const events = require("./production.events");
const stockService = require("../stock/stock.service");
const rolesRepo = require("../../shared/access/roles.repo");
const currency = require("../../services/currency.service");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { money, toCurrencyString } = require("../../utils/money");
const { NotFoundError, AppError } = require("../../utils/errors");

// ── Cost visibility (field-level RBAC, V2.2 §3 layer 5) ───
//
// The China factory manager and the CEO both work this module, but only one of
// them should see what a batch really costs us in Naira. The factory manager
// enters what the factory charges (CNY/USD) and never sees the NGN landed
// cost, per-unit cost, or the roll-up that prices our products.
//
// The role is a seeded system role, so its id is stable — resolve it once and
// memoise. A failed lookup returns null, which fails CLOSED for nobody: the
// redaction simply doesn't fire, matching pre-existing behaviour.
const FACTORY_MANAGER_ROLE = "factory_manager";
let factoryManagerRoleId;
async function factoryManagerRole() {
  if (factoryManagerRoleId === undefined) {
    try {
      const role = await rolesRepo.findRoleByName(FACTORY_MANAGER_ROLE);
      factoryManagerRoleId = role ? role.role_id : null;
    } catch {
      factoryManagerRoleId = null;
    }
  }
  return factoryManagerRoleId;
}

/** May this caller see NGN cost on a run? CEO always; factory managers never. */
async function canSeeCost(user) {
  if (!user) return false;
  if (user.is_ceo) return true;
  const roleId = await factoryManagerRole();
  if (!roleId) return true;
  return !(user.role_ids || []).includes(roleId);
}

// Every NGN figure that reveals our true cost basis. `amount`/`currency` on a
// cost component survive — that is the factory's own invoice figure, which the
// factory manager typed in and must be able to check.
const REDACTED_RUN_FIELDS = [
  "total_factory_cost_ngn",
  "total_freight_ngn",
  "total_customs_ngn",
  "total_3pl_lagos_ngn",
  "total_styling_ngn",
  "total_packaging_ngn",
  "total_wastage_ngn",
  "total_other_ngn",
  "total_landed_cost_ngn",
  "per_unit_cost_ngn",
  "effective_funding_rate",
];
const REDACTED_COMPONENT_FIELDS = ["amount_ngn", "fx_rate_used"];

/** Strip cost columns from a run (and its components) unless `visible`. */
function redactRun(run, visible) {
  if (!run || visible) return run;
  const out = { ...run, cost_redacted: true };
  for (const f of REDACTED_RUN_FIELDS) delete out[f];
  if (Array.isArray(out.components)) {
    out.components = out.components.map((c) => {
      const cc = { ...c };
      for (const f of REDACTED_COMPONENT_FIELDS) delete cc[f];
      return cc;
    });
  }
  return out;
}

// The denominator for per-unit landed cost: prefer the most "real" unit count
// available (received → produced → planned), floored at 1 to avoid div-by-zero.
function unitsForCostBasis(run) {
  return run.units_received || run.units_produced || run.units_planned || 1;
}

/**
 * Recompute a run's per-unit landed cost and snapshot it into
 * landed_cost_breakdown (append-only; previous snapshot flips is_latest=false).
 * Reads the trigger-maintained roll-up columns on the run, so it must run AFTER
 * the cost_components insert / run update has committed within the same tx.
 * Idempotent in effect — each call writes a fresh dated snapshot.
 */
async function recomputeLandedCost({ client, brand, id, reason }) {
  const run = await repo.getRunBare({ client, brand, id });
  if (!run) throw new NotFoundError("Production run");

  const units = unitsForCostBasis(run);
  const total = money(run.total_landed_cost_ngn || 0);
  const perUnit = total.div(units);
  const perUnitStr = toCurrencyString(perUnit);

  const prev = await repo.getLatestBreakdown({ client, brand, run_id: id });
  let variancePct = null;
  if (prev && money(prev.per_unit_landed_cost_ngn).gt(0)) {
    const prevPer = money(prev.per_unit_landed_cost_ngn);
    variancePct = Number(
      perUnit.minus(prevPer).div(prevPer).times(100).toFixed(4),
    );
  }

  await repo.markBreakdownsNotLatest({ client, brand, run_id: id });
  const breakdown = await repo.insertBreakdown({
    client,
    brand,
    b: {
      run_id: id,
      computed_reason: reason,
      factory_cost_total_ngn: toCurrencyString(
        money(run.total_factory_cost_ngn || 0),
      ),
      freight_total_ngn: toCurrencyString(money(run.total_freight_ngn || 0)),
      customs_total_ngn: toCurrencyString(money(run.total_customs_ngn || 0)),
      lagos_3pl_total_ngn: toCurrencyString(
        money(run.total_3pl_lagos_ngn || 0),
      ),
      styling_total_ngn: toCurrencyString(money(run.total_styling_ngn || 0)),
      packaging_total_ngn: toCurrencyString(
        money(run.total_packaging_ngn || 0),
      ),
      wastage_total_ngn: toCurrencyString(money(run.total_wastage_ngn || 0)),
      other_total_ngn: toCurrencyString(money(run.total_other_ngn || 0)),
      total_landed_cost_ngn: toCurrencyString(total),
      units_in_run: units,
      per_unit_landed_cost_ngn: perUnitStr,
      weighted_avg_fx_rate: run.effective_funding_rate ?? null,
      funding_currency: run.funding_currency || null,
      variance_from_previous_pct: variancePct,
    },
  });
  await repo.setRunPerUnitCost({
    client,
    brand,
    id,
    per_unit_cost_ngn: perUnitStr,
  });
  events.emit("run.cost_recomputed", {
    brand,
    run_id: id,
    per_unit: perUnitStr,
  });
  return breakdown;
}

// Public wrappers for the recompute (manual refresh + read).
async function refreshLandedCost({ brand, id, reason = "manual_refresh" }) {
  return transaction((client) =>
    recomputeLandedCost({ client, brand, id, reason }),
  );
}
async function getLandedCost({ brand, user, id }) {
  const run = await repo.getRunBare({ brand, id });
  if (!run) throw new NotFoundError("Production run");
  // The breakdown IS the cost basis — there is nothing left to redact, so a
  // caller who may not see cost is refused outright rather than served an
  // empty shell.
  if (!(await canSeeCost(user)))
    throw new AppError(
      "COST_HIDDEN",
      "Landed cost is not visible to your role.",
      403,
    );
  const [latest, history] = await Promise.all([
    repo.getLatestBreakdown({ brand, run_id: id }),
    repo.listBreakdowns({ brand, run_id: id }),
  ]);
  return { latest, history };
}

const A = (
  brand,
  user,
  action_key,
  target_type,
  target_id,
  after,
  request_id,
) =>
  audit({
    business: brand,
    user_id: user ? user.user_id : null,
    action_key,
    target_type,
    target_id,
    after,
    request_id,
  });

// ── Production runs ────────────────────────────────────────
async function listRuns({ brand, user, ...args }) {
  const page = await repo.listRuns({ brand, ...args });
  const visible = await canSeeCost(user);
  return { ...page, data: page.data.map((r) => redactRun(r, visible)) };
}
async function getRun({ brand, user, id }) {
  const run = await repo.getRun({ brand, id });
  if (!run) throw new NotFoundError("Production run");
  return redactRun(run, await canSeeCost(user));
}

/**
 * NGN per 1 unit of `cur`. Prefers the rate the caller actually transacted at
 * (they may have bought CNY at a street rate), else the system rate, else
 * refuses — we never invent a rate, because it silently becomes our cost basis.
 */
async function resolveFxRate({ brand, cur, supplied }) {
  const code = String(cur || "NGN").toUpperCase();
  if (supplied !== null && supplied !== undefined && Number(supplied) > 0)
    return money(supplied);
  if (code === "NGN") return money(1);
  const rate = await currency.systemFxRate({ brand, currency: code });
  if (!rate || Number(rate) <= 0)
    throw new AppError(
      "FX_RATE_UNAVAILABLE",
      `No exchange rate is configured for ${code}. Enter the rate you converted at, or set one under Settings → FX Rates.`,
      422,
    );
  return money(rate);
}

/** Public: the rate the cost form pre-fills with (editable by the operator). */
async function fxRate({ brand, cur }) {
  const code = String(cur || "NGN").toUpperCase();
  const rate =
    code === "NGN" ? 1 : await currency.systemFxRate({ brand, currency: code });
  return {
    currency: code,
    rate: rate !== null && rate !== undefined ? Number(rate) : null,
  };
}

/**
 * Build the unit rows for one product line. Each unit is individually coded
 * (`FLH-RUN-0002-001`) because the spec tracks every wig from raw hair through
 * Lagos styling — the grouped view in the UI is a projection of these rows.
 */
function unitRowsFor({ line, run, skus, startSeq }) {
  const rows = [];
  for (let n = 0; n < line.quantity; n += 1) {
    const seq = startSeq + n;
    rows.push({
      unit_code: `${run.run_number}-${String(seq).padStart(3, "0")}`,
      run_id: run.run_id,
      variant_id: line.variant_id || null,
      sku_snapshot: line.variant_id ? skus[line.variant_id] || null : null,
      status: "planned",
    });
  }
  return rows;
}

/**
 * Open a production run. A run is only useful once it says WHAT is being made
 * and WHAT the factory is charging, so both arrive with the run:
 *
 *   lines[]  → one production_run_units row per unit, plus (when the line
 *              carries a unit cost) a `factory_unit_cost` cost_component of
 *              qty × unit_cost, converted to NGN at the run's FX rate.
 *   po_id    → pull the lines straight off an approved purchase order instead,
 *              and stamp production_run_id back onto the PO lines.
 *
 * Freight, customs, 3PL and the rest are added afterwards as run-level costs —
 * they are not known on day one and do not belong to any single product.
 */
async function openRun({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    let lines = input.lines || [];
    let supplier_id = input.supplier_id || null;
    let po_currency = input.currency || null;
    let po = null;

    // PO import — the PO is the source of truth for what was ordered.
    if (input.po_id) {
      po = await repo.getPoWithLines({ client, brand, po_id: input.po_id });
      if (!po) throw new NotFoundError("Purchase order");
      supplier_id = supplier_id || po.supplier_id;
      po_currency = po_currency || po.po_currency;
      if (!lines.length) {
        lines = po.lines
          .filter((l) => l.qty_ordered > 0)
          .map((l) => ({
            variant_id: l.variant_id || undefined,
            quantity: l.qty_ordered,
            unit_cost: Number(l.unit_price) || 0,
            description: l.description,
          }));
      }
    }

    const cur = String(po_currency || "NGN").toUpperCase();
    const units_planned =
      input.units_planned !== null && input.units_planned !== undefined
        ? input.units_planned
        : lines.reduce((s, l) => s + (l.quantity || 0), 0);

    const run_number = await repo.nextNumber({
      client,
      brand,
      type: "production_run",
    });
    const run = await repo.createRun({
      client,
      brand,
      run: {
        run_number,
        title: input.title,
        status: input.status || "planned",
        units_planned,
        supplier_id,
        po_id: input.po_id || null,
        funding_currency: cur === "NGN" ? null : cur,
        planned_start_date: input.planned_start_date,
        expected_ready_date: input.expected_ready_date,
        expected_arrival_date: input.expected_arrival_date,
        notes: input.notes,
        created_by: user ? user.user_id : null,
      },
    });

    if (lines.length) {
      await addRunLines({
        client,
        brand,
        user,
        run,
        lines,
        cur,
        fx_rate_used: input.fx_rate_used,
        incurred_at: input.incurred_at,
      });
    }
    if (input.po_id)
      await repo.linkPoLinesToRun({
        client,
        brand,
        po_id: input.po_id,
        run_id: run.run_id,
      });

    // Snapshot even a zero-cost run so the breakdown history starts at open.
    await recomputeLandedCost({
      client,
      brand,
      id: run.run_id,
      reason: "state_change",
    });

    await A(
      brand,
      user,
      "production.run.open",
      "production_run",
      run.run_id,
      { run_number, units_planned, lines: lines.length, po_id: input.po_id },
      request_id,
    );
    events.emit("run.opened", { brand, run_id: run.run_id });
    return repo.getRun({ client, brand, id: run.run_id });
  });
}

/**
 * Put product lines on a run: units for each line, and one aggregated
 * `factory_unit_cost` component covering the priced lines. One component, not
 * one per line, because the factory invoices the batch — the per-line split
 * lives on the units.
 */
async function addRunLines({
  client,
  brand,
  user,
  run,
  lines,
  cur,
  fx_rate_used,
  incurred_at,
}) {
  const variantIds = [
    ...new Set(lines.map((l) => l.variant_id).filter(Boolean)),
  ];
  const skus = await repo.variantSkus({
    client,
    brand,
    variant_ids: variantIds,
  });

  let seq = (await repo.countUnits({ client, brand, run_id: run.run_id })) + 1;
  const unitRows = [];
  for (const line of lines) {
    unitRows.push(...unitRowsFor({ line, run, skus, startSeq: seq }));
    seq += line.quantity;
  }
  await repo.addUnits({ client, brand, units: unitRows });

  // Factory charge = Σ (qty × unit cost) across the priced lines.
  const factoryTotal = lines.reduce(
    (sum, l) => sum.plus(money(l.unit_cost || 0).times(l.quantity || 0)),
    money(0),
  );
  if (factoryTotal.gt(0)) {
    const rate = await resolveFxRate({ brand, cur, supplied: fx_rate_used });
    await repo.addCostComponent({
      client,
      brand,
      c: {
        run_id: run.run_id,
        cost_type: "factory_unit_cost",
        amount: toCurrencyString(factoryTotal),
        currency: cur,
        fx_rate_used: rate.toString(),
        amount_ngn: toCurrencyString(factoryTotal.times(rate)),
        applies_to_units: unitRows.length,
        description: `Factory charge — ${lines.length} product line${lines.length === 1 ? "" : "s"}`,
        source_type: "manual",
        recorded_by: user ? user.user_id : null,
        incurred_at: incurred_at || null,
      },
    });
  }
  return unitRows.length;
}

/** Add products to an existing run (post-open restock / scope change). */
async function addProducts({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const run = await repo.getRunBare({ client, brand, id });
    if (!run) throw new NotFoundError("Production run");
    const cur = String(
      input.currency || run.funding_currency || "NGN",
    ).toUpperCase();
    const added = await addRunLines({
      client,
      brand,
      user,
      run,
      lines: input.lines,
      cur,
      fx_rate_used: input.fx_rate_used,
      incurred_at: input.incurred_at,
    });
    // units_planned tracks what we intend to make, so it grows with the run.
    await repo.setRunStatus({
      client,
      brand,
      id,
      status: run.status,
      fields: { units_planned: (run.units_planned || 0) + added },
    });
    await recomputeLandedCost({ client, brand, id, reason: "new_cost" });
    await A(
      brand,
      user,
      "production.products.add",
      "production_run",
      id,
      { lines: input.lines.length, units: added },
      request_id,
    );
    events.emit("run.cost_added", { brand, run_id: id });
    return repo.getRun({ client, brand, id });
  });
}
async function advanceRun({ brand, user, request_id, id, status }) {
  const visible = await canSeeCost(user);
  return transaction(async (client) => {
    const before = await repo.getRunBare({ client, brand, id });
    if (!before) throw new NotFoundError("Production run");
    const run = await repo.setRunStatus({ client, brand, id, status });
    // Re-snapshot landed cost on milestone state changes — the per-unit basis
    // shifts as the unit count firms up (planned → produced → received).
    await recomputeLandedCost({ client, brand, id, reason: "state_change" });
    await A(
      brand,
      user,
      "production.run.advance",
      "production_run",
      id,
      { from: before.status, to: status },
      request_id,
    );
    events.emit("run.advanced", { brand, run_id: id, status });
    return redactRun(run, visible);
  });
}
async function addCostComponent({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const run = await repo.getRunBare({ client, brand, id });
    if (!run) throw new NotFoundError("Production run");
    // Never default the rate to 1 for a foreign currency — that would book a
    // ¥5,000 factory invoice as ₦5,000 and quietly wreck the cost basis.
    // resolveFxRate uses the operator's rate if given, else the system rate,
    // else refuses the write.
    const rate = await resolveFxRate({
      brand,
      cur: input.currency,
      supplied: input.fx_rate_used,
    });
    const amount_ngn =
      input.amount_ngn === undefined || input.amount_ngn === null
        ? toCurrencyString(money(input.amount).times(rate))
        : input.amount_ngn;
    const c = await repo.addCostComponent({
      client,
      brand,
      c: {
        ...input,
        run_id: id,
        fx_rate_used: rate.toString(),
        amount_ngn,
        recorded_by: user ? user.user_id : null,
      },
    });
    // The fn_production_run_recompute_totals trigger rolls this into the run.
    // With fresh roll-up totals visible in-tx, snapshot the landed cost so the
    // per-unit cost basis (pricing/COGS) tracks every cost added.
    await recomputeLandedCost({ client, brand, id, reason: "new_cost" });
    await A(
      brand,
      user,
      "production.cost.add",
      "cost_component",
      c.component_id,
      { run_id: id, cost_type: c.cost_type },
      request_id,
    );
    events.emit("run.cost_added", { brand, run_id: id });
    return c;
  });
}
async function addUnit({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const run = await repo.getRunBare({ client, brand, id });
    if (!run) throw new NotFoundError("Production run");
    // Count the unit rows directly — the run's `units` projection is grouped
    // by (variant, status), so its length is a group count, not a unit count.
    const seq = (await repo.countUnits({ client, brand, run_id: id })) + 1;
    const unit_code = `${run.run_number}-${String(seq).padStart(3, "0")}`;
    const skus = input.variant_id
      ? await repo.variantSkus({
          client,
          brand,
          variant_ids: [input.variant_id],
        })
      : {};
    const unit = await repo.addUnit({
      client,
      brand,
      unit: {
        unit_code,
        run_id: id,
        variant_id: input.variant_id,
        sku_snapshot: input.variant_id ? skus[input.variant_id] : null,
        status: input.status,
      },
    });
    await A(
      brand,
      user,
      "production.unit.add",
      "production_run_unit",
      unit.unit_id,
      { run_id: id },
      request_id,
    );
    return unit;
  });
}
/**
 * Receive finished goods from a run into stock (production_in movement) and
 * bump the run's received count. Connects production → Stock SSOT.
 */
async function receiveProduction({ brand, user, request_id, id, input }) {
  const run = await repo.getRunBare({ brand, id });
  if (!run) throw new NotFoundError("Production run");
  if (!input.variant_id || !input.location_id || !input.quantity)
    throw new AppError(
      "INVALID_RECEIPT",
      "variant_id, location_id and quantity are required",
      422,
    );
  const outstanding = (run.units_planned || 0) - (run.units_received || 0);
  if (outstanding > 0 && Math.abs(input.quantity) > outstanding)
    throw new AppError(
      "OVER_RECEIPT",
      `This run has ${outstanding} unit${outstanding === 1 ? "" : "s"} outstanding — you cannot receive ${Math.abs(input.quantity)}.`,
      422,
    );
  await stockService.recordMovement({
    brand,
    user: user || { user_id: null },
    request_id,
    input: {
      variant_id: input.variant_id,
      location_id: input.location_id,
      quantity: Math.abs(input.quantity),
      movement_type: "production_in",
      reference_type: "production_run",
      reference_id: id,
      unit_cost_ngn: input.unit_cost_ngn ?? run.per_unit_cost_ngn ?? null,
    },
  });
  const updated = await repo.bumpUnitsReceived({
    brand,
    id,
    qty: Math.abs(input.quantity),
  });
  events.emit("run.received", { brand, run_id: id, quantity: input.quantity });
  await A(
    brand,
    user,
    "production.run.receive",
    "production_run",
    id,
    { variant_id: input.variant_id, quantity: Math.abs(input.quantity) },
    request_id,
  );
  return redactRun(updated, await canSeeCost(user));
}

// ── Rework events (F-7b) ──────────────────────────────────
/**
 * Record a QC rework on a unit. When extra cost is incurred it appends a
 * 'wastage' cost_component (so it rolls into the run's landed cost and the
 * snapshot refreshes), links it to the rework row, and reflects the outcome on
 * the unit (scrapped → rejected, otherwise → reworked).
 */
async function recordRework({ brand, user, request_id, runId, unitId, input }) {
  return transaction(async (client) => {
    const unit = await repo.getUnit({ client, brand, id: unitId });
    if (!unit) throw new NotFoundError("Production unit");
    if (unit.run_id !== runId)
      throw new AppError(
        "UNIT_RUN_MISMATCH",
        "Unit does not belong to this run",
        422,
      );

    const extra = money(input.extra_cost_ngn || 0);
    let cost_component_id = null;
    if (extra.gt(0)) {
      const c = await repo.addCostComponent({
        client,
        brand,
        c: {
          run_id: runId,
          cost_type: "wastage",
          amount: toCurrencyString(extra),
          currency: "NGN",
          fx_rate_used: 1,
          amount_ngn: toCurrencyString(extra),
          incurred_at: input.incurred_at || null,
        },
      });
      cost_component_id = c.component_id;
      // The wastage rolled into the run via the trigger — re-snapshot landed cost.
      await recomputeLandedCost({
        client,
        brand,
        id: runId,
        reason: "new_cost",
      });
    }

    const rework = await repo.insertRework({
      client,
      brand,
      r: {
        unit_id: unitId,
        run_id: runId,
        reason: input.reason,
        qc_finding: input.qc_finding,
        extra_cost_ngn: toCurrencyString(extra),
        cost_component_id,
        delay_days: input.delay_days,
        rework_completed_at: input.rework_completed_at,
        outcome: input.outcome,
        recorded_by: user ? user.user_id : null,
        notes: input.notes,
      },
    });

    const newStatus = input.outcome === "scrapped" ? "rejected" : "reworked";
    await repo.setUnitStatus({ client, brand, id: unitId, status: newStatus });

    await A(
      brand,
      user,
      "production.rework.record",
      "rework_event",
      rework.rework_id,
      { run_id: runId, unit_id: unitId, outcome: input.outcome || null },
      request_id,
    );
    events.emit("run.reworked", { brand, run_id: runId, unit_id: unitId });
    return rework;
  });
}

function listRework({ brand, runId, unitId }) {
  return repo.listRework({ brand, run_id: runId, unit_id: unitId });
}

// Service jobs are owned by the standalone Service Jobs module
// (src/modules/service_jobs). The deposit_met → service-job connection now
// lives in service-jobs.subscribers.

module.exports = {
  listRuns,
  getRun,
  openRun,
  advanceRun,
  addProducts,
  fxRate,
  canSeeCost,
  redactRun,
  addCostComponent,
  addUnit,
  receiveProduction,
  recomputeLandedCost,
  refreshLandedCost,
  getLandedCost,
  recordRework,
  listRework,
};
