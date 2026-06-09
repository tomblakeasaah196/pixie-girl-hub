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
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError, AppError } = require("../../utils/errors");

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
function listRuns(args) {
  return repo.listRuns(args);
}
async function getRun({ brand, id }) {
  const run = await repo.getRun({ brand, id });
  if (!run) throw new NotFoundError("Production run");
  return run;
}
async function openRun({ brand, user, request_id, input }) {
  return transaction(async (client) => {
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
        units_planned: input.units_planned || 0,
      },
    });
    await A(
      brand,
      user,
      "production.run.open",
      "production_run",
      run.run_id,
      { run_number },
      request_id,
    );
    events.emit("run.opened", { brand, run_id: run.run_id });
    return run;
  });
}
async function advanceRun({ brand, user, request_id, id, status }) {
  return transaction(async (client) => {
    const before = await repo.getRun({ client, brand, id });
    if (!before) throw new NotFoundError("Production run");
    const run = await repo.setRunStatus({ client, brand, id, status });
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
    return run;
  });
}
async function addCostComponent({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const run = await repo.getRun({ client, brand, id });
    if (!run) throw new NotFoundError("Production run");
    const amount_ngn =
      input.amount_ngn === undefined || input.amount_ngn === null
        ? Number(input.amount) * Number(input.fx_rate_used || 1)
        : input.amount_ngn;
    const c = await repo.addCostComponent({
      client,
      brand,
      c: { ...input, run_id: id, amount_ngn },
    });
    // The fn_production_run_recompute_totals trigger rolls this into the run.
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
    const run = await repo.getRun({ client, brand, id });
    if (!run) throw new NotFoundError("Production run");
    const seq = (run.units || []).length + 1;
    const unit_code = `${run.run_number}-${String(seq).padStart(3, "0")}`;
    const unit = await repo.addUnit({
      client,
      brand,
      unit: {
        unit_code,
        run_id: id,
        variant_id: input.variant_id,
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
  const run = await repo.getRun({ brand, id });
  if (!run) throw new NotFoundError("Production run");
  if (!input.variant_id || !input.location_id || !input.quantity)
    throw new AppError(
      "INVALID_RECEIPT",
      "variant_id, location_id and quantity are required",
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
  return updated;
}

// ── Service jobs ───────────────────────────────────────────
function listServiceJobs(args) {
  return repo.listServiceJobs(args);
}
async function getServiceJob({ brand, id }) {
  const job = await repo.getServiceJob({ brand, id });
  if (!job) throw new NotFoundError("Service job");
  return job;
}
async function createServiceJob({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const job_number = await repo.nextNumber({
      client,
      brand,
      type: "service_job",
    });
    const job = await repo.createServiceJob({
      client,
      brand,
      job: { ...input, job_number },
    });
    await A(
      brand,
      user,
      "production.service_job.create",
      "service_job",
      job.job_id,
      { job_number },
      request_id,
    );
    events.emit("service_job.created", { brand, job_id: job.job_id });
    return job;
  });
}
async function advanceServiceJob({
  brand,
  user,
  request_id,
  id,
  status,
  actual_cost_ngn,
}) {
  return transaction(async (client) => {
    const before = await repo.getServiceJob({ client, brand, id });
    if (!before) throw new NotFoundError("Service job");
    const fields = {};
    if (actual_cost_ngn !== null) fields.actual_cost_ngn = actual_cost_ngn;
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
      "production.service_job.advance",
      "service_job",
      id,
      { from: before.status, to: status },
      request_id,
    );
    events.emit("service_job.advanced", { brand, job_id: id, status });
    return job;
  });
}

/**
 * G-1: open a styling service job for a deposit-triggered (custom) order once
 * the deposit clears. No-ops if the brand has no service types configured
 * (e.g. PXG) or a job already exists for the order.
 */
async function createServiceJobForOrder({ brand, order }) {
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
    if (!st) return null; // brand runs no styling services
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
      "production.service_job.from_order",
      "service_job",
      job.job_id,
      { order_id: order.order_id },
      null,
    );
    events.emit("service_job.created", {
      brand,
      job_id: job.job_id,
      order_id: order.order_id,
    });
    return job;
  });
}

module.exports = {
  listRuns,
  getRun,
  openRun,
  advanceRun,
  addCostComponent,
  addUnit,
  receiveProduction,
  listServiceJobs,
  getServiceJob,
  createServiceJob,
  advanceServiceJob,
  createServiceJobForOrder,
};
