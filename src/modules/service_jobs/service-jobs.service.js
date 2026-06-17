/**
 * Faitlyn Service Job Tracker (V2.2 §6.24) — business logic.
 *
 * Service types + the job lifecycle (pending → in_progress → completed), split
 * out of Production into its own module. System connections:
 *   - sales `order.deposit_met` → createForOrder opens a job (subscriber).
 *   - a job insert fires the DB trigger that raises a staff task.
 *   - `service_jobs.created` is consumed by the Stylist programme to open a
 *     routing assignment; on completion the cost can settle.
 */

"use strict";

const repo = require("./service-jobs.repo");
const events = require("./service-jobs.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { money } = require("../../utils/money");
const { NotFoundError, AppError } = require("../../utils/errors");
const { BRANDS } = require("../../config/brands");
const { logger } = require("../../config/logger");

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

const JOB_STATUS = [
  "pending",
  "in_progress",
  "on_hold",
  "completed",
  "rejected",
  "cancelled",
];

// ── Service types ──────────────────────────────────────────
function listServiceTypes({ brand, is_active }) {
  return repo.listServiceTypes({ brand, is_active });
}
async function createServiceType({ brand, user, request_id, input }) {
  const st = await repo.createServiceType({ brand, st: input });
  await A(
    brand,
    user,
    "service_jobs.type.create",
    "service_type",
    st.service_type_id,
    { service_key: st.service_key },
    request_id,
  );
  return st;
}
async function updateServiceType({ brand, user, request_id, id, patch }) {
  const before = await repo.findServiceType({ brand, id });
  if (!before) throw new NotFoundError("Service type");
  const updated = await repo.updateServiceType({ brand, id, patch });
  await A(
    brand,
    user,
    "service_jobs.type.update",
    "service_type",
    id,
    updated,
    request_id,
  );
  return updated;
}

// ── Jobs ───────────────────────────────────────────────────
function listJobs(args) {
  return repo.listServiceJobs(args);
}
async function getJob({ brand, id }) {
  const job = await repo.getServiceJob({ brand, id });
  if (!job) throw new NotFoundError("Service job");
  return job;
}
async function createJob({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const job_number = await repo.nextNumber({
      client,
      brand,
      type: "service_job",
    });
    const job = await repo.createServiceJob({
      client,
      brand,
      job: { ...input, job_number, created_by: user.user_id },
    });
    await A(
      brand,
      user,
      "service_jobs.create",
      "service_job",
      job.job_id,
      { job_number },
      request_id,
    );
    events.emit("created", { brand, job_id: job.job_id });
    return job;
  });
}
async function updateJob({ brand, user, request_id, id, patch }) {
  return transaction(async (client) => {
    const before = await repo.getServiceJob({ client, brand, id });
    if (!before) throw new NotFoundError("Service job");
    const job = await repo.updateServiceJob({ client, brand, id, patch });
    await A(
      brand,
      user,
      "service_jobs.update",
      "service_job",
      id,
      job,
      request_id,
    );
    return job;
  });
}

/**
 * Advance the job status machine. Stamps lifecycle timestamps and emits
 * `advanced` (and `completed` on the terminal transition).
 */
async function advanceJob({
  brand,
  user,
  request_id,
  id,
  status,
  actual_cost_ngn,
}) {
  if (!JOB_STATUS.includes(status))
    throw new AppError("BAD_STATUS", `Unknown status ${status}`, 422);
  return transaction(async (client) => {
    const before = await repo.getServiceJob({ client, brand, id });
    if (!before) throw new NotFoundError("Service job");
    const fields = {};
    if (actual_cost_ngn !== undefined && actual_cost_ngn !== null)
      fields.actual_cost_ngn = actual_cost_ngn;
    if (status === "in_progress" && !before.started_at)
      fields.started_at = new Date().toISOString();
    if (status === "completed") fields.completed_at = new Date().toISOString();
    if (status === "cancelled") fields.cancelled_at = new Date().toISOString();
    const job = await repo.setServiceJobStatus({
      client,
      brand,
      id,
      status,
      fields,
    });
    await A(
      brand,
      user,
      "service_jobs.advance",
      "service_job",
      id,
      { from: before.status, to: status },
      request_id,
    );
    events.emit("advanced", { brand, job_id: id, status });
    // GAP-5: deduct stock for the wig consumed when service job completes
    if (status === "completed" && job.hair_variant_id) {
      try {
        const stockService = require("../stock/stock.service");
        const stockRepo = require("../stock/stock.repo");
        const loc = await stockRepo.getDefaultLocation({ client, brand });
        if (loc) {
          await stockService.deductForSale({
            client,
            brand,
            variant_id: job.hair_variant_id,
            location_id: loc.location_id,
            quantity: 1,
            reference_id: id,
            sales_channel: "service_job",
            unit_cost_ngn: job.actual_cost_ngn || null,
            user_id: user.user_id,
          });
        }
      } catch (err) {
        logger.warn({ err, job_id: id }, "service job stock deduction skipped");
      }
    }
    if (status === "completed") events.emit("completed", { brand, job_id: id });
    return job;
  });
}

async function assignStaff({
  brand,
  user,
  request_id,
  id,
  assigned_staff_user_id,
}) {
  const before = await repo.getServiceJob({ brand, id });
  if (!before) throw new NotFoundError("Service job");
  const job = await repo.updateServiceJob({
    brand,
    id,
    patch: { assigned_staff_user_id },
  });
  await A(
    brand,
    user,
    "service_jobs.assign_staff",
    "service_job",
    id,
    { assigned_staff_user_id },
    request_id,
  );
  events.emit("assigned", { brand, job_id: id });
  return job;
}

async function recordOutcome({ brand, user, request_id, id, input }) {
  const before = await repo.getServiceJob({ brand, id });
  if (!before) throw new NotFoundError("Service job");
  const fields = {};
  if (input.quality_rating !== undefined)
    fields.quality_rating = input.quality_rating;
  if (input.quality_notes !== undefined)
    fields.quality_notes = input.quality_notes;
  if (input.customer_rating !== undefined)
    fields.customer_rating = input.customer_rating;
  if (input.customer_feedback !== undefined)
    fields.customer_feedback = input.customer_feedback;
  const job = await repo.setServiceJobStatus({
    brand,
    id,
    status: before.status,
    fields,
  });
  await A(
    brand,
    user,
    "service_jobs.outcome",
    "service_job",
    id,
    fields,
    request_id,
  );
  return job;
}

/**
 * Open a styling job for a deposit-triggered (custom) order once the deposit
 * clears. No-ops if the brand runs no service types or a job already exists.
 * Called best-effort by the order.deposit_met subscriber.
 */
async function createForOrder({ brand, order }) {
  if (!order) return null;
  return transaction(async (client) => {
    if (
      await repo.serviceJobExistsForOrder({
        client,
        brand,
        order_id: order.order_id,
      })
    )
      return null;
    const st = await repo.getDefaultServiceType({ client, brand });
    if (!st) return null; // brand runs no styling services (e.g. PXG)
    const firstLine = (order.lines || [])[0] || {};
    const job_number = await repo.nextNumber({
      client,
      brand,
      type: "service_job",
    });
    const job = await repo.createServiceJob({
      client,
      brand,
      job: {
        job_number,
        service_type_id: st.service_type_id,
        hair_variant_id: firstLine.variant_id || null,
        sales_order_id: order.order_id,
        customer_contact_id: order.contact_id,
        status: "pending",
        agreed_cost_ngn: st.standard_cost_ngn,
      },
    });
    await A(
      brand,
      null,
      "service_jobs.from_order",
      "service_job",
      job.job_id,
      { order_id: order.order_id },
      null,
    );
    events.emit("created", {
      brand,
      job_id: job.job_id,
      order_id: order.order_id,
    });
    return job;
  });
}

// ── Chemical recipes (F-7c) ────────────────────────────────
function listRecipes({ brand, is_active }) {
  return repo.listRecipes({ brand, is_active });
}
async function getRecipe({ brand, id }) {
  const r = await repo.getRecipe({ brand, id });
  if (!r) throw new NotFoundError("Chemical recipe");
  return r;
}
async function createRecipe({ brand, user, request_id, input }) {
  const r = await repo.createRecipe({
    brand,
    r: input,
    user_id: user ? user.user_id : null,
  });
  await A(
    brand,
    user,
    "service_jobs.recipe.create",
    "chemical_recipe",
    r.recipe_id,
    { recipe_key: r.recipe_key },
    request_id,
  );
  return r;
}
async function updateRecipe({ brand, user, request_id, id, patch }) {
  const before = await repo.getRecipe({ brand, id });
  if (!before) throw new NotFoundError("Chemical recipe");
  const r = await repo.updateRecipe({ brand, id, patch });
  await A(
    brand,
    user,
    "service_jobs.recipe.update",
    "chemical_recipe",
    id,
    patch,
    request_id,
  );
  return r;
}

// ── Service-job chemical consumption (F-7d) ────────────────
async function recordChemicalConsumption({
  brand,
  user,
  request_id,
  id,
  input,
}) {
  const job = await repo.getServiceJob({ brand, id });
  if (!job) throw new NotFoundError("Service job");
  const jc = await repo.addJobChemical({
    brand,
    jc: { ...input, job_id: id, recorded_by: user ? user.user_id : null },
  });
  await A(
    brand,
    user,
    "service_jobs.chemical.record",
    "service_job_chemical",
    jc.consumption_id,
    { job_id: id, chemical_name: jc.chemical_name, qty_used: jc.qty_used },
    request_id,
  );
  events.emit("chemical_recorded", { brand, job_id: id });
  return jc;
}
function listChemicalConsumption({ brand, id }) {
  return repo.listJobChemicals({ brand, job_id: id });
}

// ── Monthly chemical reconciliation (F-7e) ─────────────────
const VARIANCE_TOLERANCE_PCT = 0.1; // 10% gap vs purchased flags for review

/**
 * Reconcile a fiscal period: system-derived consumption (service_job_chemicals)
 * vs the admin-recorded purchased/disposed quantities (preserved across reruns).
 * A negative variance (used more than bought+disposed) or a large gap is flagged
 * as the §6.30 anti-pocketing signal. Idempotent per (period, chemical, unit).
 */
async function reconcileChemicals({
  brand,
  user,
  request_id,
  fiscal_period_id,
}) {
  const period = await repo.getFiscalPeriod({ brand, id: fiscal_period_id });
  if (!period) throw new NotFoundError("Fiscal period");

  const [consumed, existing] = await Promise.all([
    repo.consumedByChemical({
      brand,
      starts_on: period.starts_on,
      ends_on: period.ends_on,
    }),
    repo.existingReconciliationMap({ brand, fiscal_period_id }),
  ]);
  const priorByKey = new Map(
    existing.map((e) => [
      `${e.chemical_name}__${e.unit}`,
      { qty_purchased: e.qty_purchased, qty_disposed: e.qty_disposed },
    ]),
  );

  const results = await transaction(async (client) => {
    const out = [];
    for (const c of consumed) {
      const prior = priorByKey.get(`${c.chemical_name}__${c.unit}`) || {
        qty_purchased: 0,
        qty_disposed: 0,
      };
      const purchased = money(prior.qty_purchased || 0);
      const disposed = money(prior.qty_disposed || 0);
      const consumedQty = money(c.qty_consumed || 0);
      const variance = purchased.minus(consumedQty).minus(disposed);

      let status = "normal";
      if (variance.lt(0)) status = "flagged";
      else if (
        purchased.gt(0) &&
        variance.abs().div(purchased).gt(VARIANCE_TOLERANCE_PCT)
      )
        status = "flagged";

      const rec = await repo.upsertReconciliation({
        client,
        brand,
        rec: {
          fiscal_period_id,
          chemical_name: c.chemical_name,
          unit: c.unit,
          qty_purchased: purchased.toFixed(3),
          qty_consumed: consumedQty.toFixed(3),
          qty_disposed: disposed.toFixed(3),
          variance_value_ngn: null,
          variance_status: status,
        },
      });
      out.push(rec);
    }
    return out;
  });

  const flagged = results.filter((r) => r.variance_status === "flagged").length;
  await A(
    brand,
    user,
    "service_jobs.chemical.reconcile",
    "fiscal_period",
    fiscal_period_id,
    { chemicals: results.length, flagged },
    request_id,
  );
  if (flagged > 0)
    events.emit("chemical_variance_flagged", {
      brand,
      fiscal_period_id,
      flagged,
    });
  return {
    period_id: fiscal_period_id,
    reconciled: results.length,
    flagged,
    results,
  };
}

function listReconciliations({ brand, fiscal_period_id, variance_status }) {
  return repo.listReconciliations({ brand, fiscal_period_id, variance_status });
}

/**
 * Cron entry: reconcile every brand's periods that ended in the last `days`
 * and aren't locked. Idempotent, so re-running is safe.
 */
async function runMonthlyChemicalReconciliation({ days = 40 } = {}) {
  let total = 0;
  for (const brand of BRANDS) {
    let periods = [];
    try {
      periods = await repo.periodsEndedWithin({ brand, days });
    } catch {
      continue;
    }
    for (const p of periods) {
      try {
        const r = await reconcileChemicals({
          brand,
          user: { user_id: null },
          request_id: null,
          fiscal_period_id: p.period_id,
        });
        total += r.reconciled;
      } catch {
        // isolate per-period failures
      }
    }
  }
  return { reconciled: total };
}

module.exports = {
  listServiceTypes,
  createServiceType,
  updateServiceType,
  listJobs,
  getJob,
  createJob,
  updateJob,
  advanceJob,
  assignStaff,
  recordOutcome,
  createForOrder,
  listRecipes,
  getRecipe,
  createRecipe,
  updateRecipe,
  recordChemicalConsumption,
  listChemicalConsumption,
  reconcileChemicals,
  listReconciliations,
  runMonthlyChemicalReconciliation,
};
