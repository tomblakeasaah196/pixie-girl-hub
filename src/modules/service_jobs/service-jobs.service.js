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
    // GAP-5: deduct stock for the wig consumed when service job completes —
    // unless the Stylist Studio assign flow already pulled it (custody OUT),
    // which would otherwise double-deduct.
    const alreadyOut = await repo.hasCustodyEvent({
      client,
      brand,
      job_id: id,
      event: "out",
    });
    if (status === "completed" && job.hair_variant_id && !alreadyOut) {
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
 * Open a styling job when a deposit clears — but ONLY when the order actually
 * contains styling work (a styled product or a service line). A plain wig sale
 * no longer opens a job. When a styled product drives the line, the job inherits
 * its production DNA (service type, recipe, SOP, turnaround) and the styling is
 * treated as already paid (internal cost only). No-ops if a job already exists
 * or the brand runs no styling services. Best-effort from the subscriber.
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
    // Only open a job when a line needs styling work.
    const line = await repo.firstStudioLine({
      client,
      brand,
      order_id: order.order_id,
    });
    if (!line) return null; // plain product order — nothing to style
    const st = await repo.getDefaultServiceType({ client, brand });
    // Inherit production DNA from the styled product when present.
    const dna = line.styled_id
      ? await repo.getStyledDNA({ client, brand, styled_id: line.styled_id })
      : null;
    const service_type_id =
      (dna && dna.default_service_type_id) || (st && st.service_type_id);
    if (!service_type_id) return null; // brand runs no styling services (e.g. PXG)
    // Pricing: styled = already paid (use the styled add-on as the internal
    // figure); service line = the line's own price; else the service-type cost.
    const agreed = dna
      ? (dna.style_addon_price_ngn ?? (st ? st.standard_cost_ngn : 0))
      : (line.unit_price_ngn ?? (st ? st.standard_cost_ngn : 0));
    // Turnaround → expected completion + SLA clock.
    const turnaround =
      (dna && dna.standard_turnaround_days) ||
      (st && st.standard_turnaround_days) ||
      null;
    const expected = turnaround
      ? new Date(Date.now() + turnaround * 86400000).toISOString()
      : null;
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
        service_type_id,
        hair_variant_id:
          line.variant_id || (dna && dna.base_variant_id) || null,
        sales_order_id: order.order_id,
        sales_order_line_id: line.line_id,
        customer_contact_id: order.contact_id,
        status: "pending",
        recipe_id: (dna && dna.default_recipe_id) || null,
        specification:
          dna && dna.sop_steps ? { sop_steps: dna.sop_steps } : null,
        expected_completion_at: expected,
        agreed_cost_ngn: agreed,
      },
    });
    // Stamp the columns createServiceJob doesn't take (styled provenance, the
    // reserved base wig, and the promised-delivery SLA).
    const stamp = {};
    if (line.styled_id) stamp.styled_id = line.styled_id;
    if (line.variant_id) stamp.reserved_variant_id = line.variant_id;
    if (expected) stamp.sla_due_at = expected;
    if (Object.keys(stamp).length)
      await repo.setServiceJobStatus({
        client,
        brand,
        id: job.job_id,
        status: "pending",
        fields: stamp,
      });
    await A(
      brand,
      null,
      "service_jobs.from_order",
      "service_job",
      job.job_id,
      { order_id: order.order_id, line_kind: line.line_kind },
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

// ════════════════════════════════════════════════════════════
// Stylist Studio (PR2) — operational lifecycle + accountability
// ════════════════════════════════════════════════════════════

// Best-effort in-app + push notification (channels handled by the service).
async function notifyUser({
  brand,
  user_id,
  type,
  title,
  body,
  job_id,
  priority,
}) {
  if (!user_id) return;
  try {
    const notifications = require("../../services/notifications.service");
    await notifications.notify({
      user_id,
      business: brand,
      type,
      title,
      body,
      priority: priority || "normal",
      reference_type: "service_job",
      reference_id: job_id,
      action_url: `/stylist-studio/jobs/${job_id}`,
    });
  } catch (err) {
    logger.warn({ err, job_id, user_id }, "studio notification skipped");
  }
}

// Pull the base wig out of stock (best-effort — never blocks the assignment;
// a physical wig may exist outside tracked stock).
async function deductBaseWig({ client, brand, job, user_id, channel }) {
  const variant_id = job.reserved_variant_id || job.hair_variant_id;
  if (!variant_id) return;
  try {
    const stockService = require("../stock/stock.service");
    const stockRepo = require("../stock/stock.repo");
    const loc = await stockRepo.getDefaultLocation({ client, brand });
    if (!loc) return;
    await stockService.deductForSale({
      client,
      brand,
      variant_id,
      location_id: loc.location_id,
      quantity: 1,
      reference_id: job.job_id,
      sales_channel: channel || "service_job",
      unit_cost_ngn: null,
      user_id,
    });
  } catch (err) {
    logger.warn(
      { err, job_id: job.job_id },
      "studio base-wig deduction skipped",
    );
  }
}

/**
 * Assign an in-house stylist (staff). Reserves + deducts the base wig, writes a
 * custody OUT row (so the wig is now accounted for in the stylist's hands), and
 * notifies them. The DB trigger separately raises a task on their Workspace.
 */
async function assignStylist({
  brand,
  user,
  request_id,
  id,
  assigned_staff_user_id,
}) {
  return transaction(async (client) => {
    const before = await repo.getServiceJob({ client, brand, id });
    if (!before) throw new NotFoundError("Service job");
    const fields = {
      assigned_staff_user_id,
      assigned_at: new Date().toISOString(),
    };
    if (!before.reserved_variant_id && before.hair_variant_id)
      fields.reserved_variant_id = before.hair_variant_id;
    const job = await repo.setServiceJobStatus({
      client,
      brand,
      id,
      status: "assigned",
      fields,
    });
    const alreadyOut = await repo.hasCustodyEvent({
      client,
      brand,
      job_id: id,
      event: "out",
    });
    if (!alreadyOut) {
      await deductBaseWig({
        client,
        brand,
        job,
        user_id: user.user_id,
        channel: "service_job",
      });
      await repo.addCustody({
        client,
        brand,
        c: {
          job_id: id,
          event: "out",
          quantity: 1,
          stylist_user_id: assigned_staff_user_id,
          created_by: user.user_id,
          reason: "assigned to stylist",
        },
      });
    }
    await A(
      brand,
      user,
      "service_jobs.assign",
      "service_job",
      id,
      { assigned_staff_user_id },
      request_id,
    );
    events.emit("assigned", { brand, job_id: id });
    await notifyUser({
      brand,
      user_id: assigned_staff_user_id,
      type: "service_job_assigned",
      title: "New styling job assigned",
      body: `Job ${job.job_number} is ready for you to start.`,
      job_id: id,
      priority: "high",
    });
    return job;
  });
}

/** Stylist starts work — opens a time session and moves to in_progress. */
async function startWork({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const before = await repo.getServiceJob({ client, brand, id });
    if (!before) throw new NotFoundError("Service job");
    const open = await repo.getOpenTimeSession({ client, brand, job_id: id });
    if (!open)
      await repo.openTimeSession({
        client,
        brand,
        job_id: id,
        stylist_user_id: before.assigned_staff_user_id,
      });
    const fields = {};
    if (!before.started_at) fields.started_at = new Date().toISOString();
    const job = await repo.setServiceJobStatus({
      client,
      brand,
      id,
      status: "in_progress",
      fields,
    });
    await A(
      brand,
      user,
      "service_jobs.start",
      "service_job",
      id,
      {},
      request_id,
    );
    events.emit("advanced", { brand, job_id: id, status: "in_progress" });
    return job;
  });
}

/** Pause the running clock (status stays in_progress). */
async function pauseWork({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const before = await repo.getServiceJob({ client, brand, id });
    if (!before) throw new NotFoundError("Service job");
    const open = await repo.getOpenTimeSession({ client, brand, job_id: id });
    if (open)
      await repo.closeTimeSession({ client, brand, log_id: open.log_id });
    await A(
      brand,
      user,
      "service_jobs.pause",
      "service_job",
      id,
      {},
      request_id,
    );
    return repo.getServiceJob({ client, brand, id });
  });
}

/** Resume work — opens a fresh time session if none is running. */
async function resumeWork({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const before = await repo.getServiceJob({ client, brand, id });
    if (!before) throw new NotFoundError("Service job");
    const open = await repo.getOpenTimeSession({ client, brand, job_id: id });
    if (!open)
      await repo.openTimeSession({
        client,
        brand,
        job_id: id,
        stylist_user_id: before.assigned_staff_user_id,
      });
    await A(
      brand,
      user,
      "service_jobs.resume",
      "service_job",
      id,
      {},
      request_id,
    );
    return repo.getServiceJob({ client, brand, id });
  });
}

/**
 * Log a material used on the job. Discrete items deduct exact stock now;
 * chemicals are a checklist line (stock trued-up by monthly reconciliation).
 */
async function logMaterial({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const job = await repo.getServiceJob({ client, brand, id });
    if (!job) throw new NotFoundError("Service job");
    const m = await repo.addMaterial({
      client,
      brand,
      m: {
        job_id: id,
        kind: input.kind,
        variant_id: input.variant_id,
        quantity: input.quantity,
        chemical_name: input.chemical_name,
        usage_note: input.usage_note,
        logged_by: user.user_id,
      },
    });
    if (input.kind === "discrete" && input.variant_id) {
      try {
        const stockService = require("../stock/stock.service");
        const stockRepo = require("../stock/stock.repo");
        const loc = await stockRepo.getDefaultLocation({ client, brand });
        if (loc) {
          const mv = await stockService.deductForSale({
            client,
            brand,
            variant_id: input.variant_id,
            location_id: loc.location_id,
            quantity: input.quantity,
            reference_id: id,
            sales_channel: "service_job_material",
            unit_cost_ngn: null,
            user_id: user.user_id,
          });
          await repo.markMaterialDeducted({
            client,
            brand,
            material_id: m.material_id,
            movement_id: mv && mv.movement_id,
          });
        }
      } catch (err) {
        logger.warn({ err, job_id: id }, "studio material deduction skipped");
      }
    }
    await A(
      brand,
      user,
      "service_jobs.material.log",
      "service_job_material",
      m.material_id,
      { kind: input.kind },
      request_id,
    );
    return repo.listMaterials({ brand, job_id: id });
  });
}
function listMaterials({ brand, id }) {
  return repo.listMaterials({ brand, job_id: id });
}

/** Add a style-brief reference (image / audio / video link / text / creative freedom). */
async function addReference({ brand, user, request_id, id, input }) {
  const job = await repo.getServiceJob({ brand, id });
  if (!job) throw new NotFoundError("Service job");
  const r = await repo.addReference({
    brand,
    r: { ...input, job_id: id, created_by: user.user_id },
  });
  await A(
    brand,
    user,
    "service_jobs.reference.add",
    "service_job_reference",
    r.reference_id,
    { ref_type: input.ref_type },
    request_id,
  );
  return repo.listReferences({ brand, job_id: id });
}
function listReferences({ brand, id }) {
  return repo.listReferences({ brand, job_id: id });
}
async function removeReference({ brand, user, request_id, id, reference_id }) {
  const ok = await repo.deleteReference({ brand, job_id: id, reference_id });
  if (!ok) throw new NotFoundError("Reference");
  await A(
    brand,
    user,
    "service_jobs.reference.remove",
    "service_job_reference",
    reference_id,
    {},
    request_id,
  );
  return repo.listReferences({ brand, job_id: id });
}
function listTimeLogs({ brand, id }) {
  return repo.listTimeLogs({ brand, job_id: id });
}

/** Stylist marks done and returns the wig to Ops for QC. Custody RETURN. */
async function returnForQc({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const before = await repo.getServiceJob({ client, brand, id });
    if (!before) throw new NotFoundError("Service job");
    const open = await repo.getOpenTimeSession({ client, brand, job_id: id });
    if (open)
      await repo.closeTimeSession({ client, brand, log_id: open.log_id });
    const job = await repo.setServiceJobStatus({
      client,
      brand,
      id,
      status: "returned_for_qc",
      fields: { returned_at: new Date().toISOString() },
    });
    await repo.addCustody({
      client,
      brand,
      c: {
        job_id: id,
        event: "return",
        quantity: 1,
        stylist_user_id: before.assigned_staff_user_id,
        created_by: user.user_id,
        reason: "returned for QC",
      },
    });
    await A(
      brand,
      user,
      "service_jobs.return",
      "service_job",
      id,
      {},
      request_id,
    );
    events.emit("advanced", { brand, job_id: id, status: "returned_for_qc" });
    await notifyUser({
      brand,
      user_id: before.created_by,
      type: "service_job_returned",
      title: "Wig returned for QC",
      body: `Job ${before.job_number} is back from the stylist and ready to check.`,
      job_id: id,
      priority: "high",
    });
    return job;
  });
}

/** Ops QC: pass → qc_passed; rework → back to a stylist (same or reassigned). */
async function recordQc({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const before = await repo.getServiceJob({ client, brand, id });
    if (!before) throw new NotFoundError("Service job");
    const fields = { qc_by: user.user_id, qc_at: new Date().toISOString() };
    if (input.quality_rating !== undefined)
      fields.quality_rating = input.quality_rating;
    if (input.quality_notes !== undefined)
      fields.quality_notes = input.quality_notes;
    let status;
    if (input.result === "pass") {
      status = "qc_passed";
    } else {
      status = "rework";
      fields.rework_count = (before.rework_count || 0) + 1;
      if (input.reassign_to) fields.assigned_staff_user_id = input.reassign_to;
    }
    const job = await repo.setServiceJobStatus({
      client,
      brand,
      id,
      status,
      fields,
    });
    if (status === "rework") {
      const stylist = input.reassign_to || before.assigned_staff_user_id;
      // The wig goes back out to the stylist — keep the custody balance honest.
      await repo.addCustody({
        client,
        brand,
        c: {
          job_id: id,
          event: "out",
          quantity: 1,
          stylist_user_id: stylist,
          created_by: user.user_id,
          reason: "rework",
        },
      });
      await notifyUser({
        brand,
        user_id: stylist,
        type: "service_job_rework",
        title: "Job needs rework",
        body: `Job ${before.job_number}: ${input.quality_notes || "see QC notes"}.`,
        job_id: id,
        priority: "high",
      });
    }
    await A(
      brand,
      user,
      "service_jobs.qc",
      "service_job",
      id,
      { result: input.result },
      request_id,
    );
    events.emit("advanced", { brand, job_id: id, status });
    return job;
  });
}

/** Ops marks the wig ready to ship — custody DISPATCHED + readiness stamp. */
async function dispatch({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const before = await repo.getServiceJob({ client, brand, id });
    if (!before) throw new NotFoundError("Service job");
    const job = await repo.setServiceJobStatus({
      client,
      brand,
      id,
      status: "ready_for_dispatch",
      fields: { ready_at: new Date().toISOString() },
    });
    await repo.addCustody({
      client,
      brand,
      c: {
        job_id: id,
        event: "dispatched",
        quantity: 1,
        created_by: user.user_id,
        reason: "ready for dispatch",
      },
    });
    await A(
      brand,
      user,
      "service_jobs.dispatch",
      "service_job",
      id,
      {},
      request_id,
    );
    events.emit("ready_for_dispatch", { brand, job_id: id });
    return job;
  }).then(async (job) => {
    // Post-commit, best-effort: hand the finished wig to Logistics. Reuses the
    // idempotent order→delivery creator, which no-ops for non-dispatch orders
    // (e.g. an own-wig pickup), so only real shipments are made. The returned
    // delivery id is stamped on the job so the SLA (promised vs actual) tracks.
    try {
      if (job.sales_order_id) {
        const salesRepo = require("../sales/sales.repo");
        const logistics = require("../logistics/logistics.service");
        const order = await salesRepo.findById({
          brand,
          id: job.sales_order_id,
        });
        const delivery = order
          ? await logistics.createForOrder({ brand, order })
          : null;
        if (delivery && delivery.delivery_id) {
          await repo.setServiceJobStatus({
            brand,
            id,
            status: "ready_for_dispatch",
            fields: { shipment_id: delivery.delivery_id },
          });
          job.shipment_id = delivery.delivery_id;
        }
      }
    } catch (err) {
      logger.warn(
        { err, job_id: id },
        "studio dispatch → logistics handoff skipped",
      );
    }
    return job;
  });
}

/** Hand the finished, packed wig to Sales for shipping. */
async function handToSales({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const before = await repo.getServiceJob({ client, brand, id });
    if (!before) throw new NotFoundError("Service job");
    const job = await repo.setServiceJobStatus({
      client,
      brand,
      id,
      status: "handed_to_sales",
      fields: { handed_at: new Date().toISOString() },
    });
    await A(
      brand,
      user,
      "service_jobs.hand_to_sales",
      "service_job",
      id,
      {},
      request_id,
    );
    events.emit("advanced", { brand, job_id: id, status: "handed_to_sales" });
    return job;
  });
}

// ── Wig accountability ─────────────────────────────────────
async function getAccountability({ brand }) {
  const cfg = await repo.getStudioConfig({ brand });
  const threshold = cfg.missing_wig_threshold_days || 7;
  const [balances, overdue] = await Promise.all([
    repo.custodyBalances({ brand }),
    repo.overdueOutWigs({ brand, threshold_days: threshold }),
  ]);
  return { threshold_days: threshold, balances, overdue };
}
function listCustodyLedger({ brand, job_id, stylist_user_id }) {
  return repo.listCustody({ brand, job_id, stylist_user_id });
}
async function writeOffWig({ brand, user, request_id, id, reason }) {
  return transaction(async (client) => {
    const before = await repo.getServiceJob({ client, brand, id });
    if (!before) throw new NotFoundError("Service job");
    const entry = await repo.addCustody({
      client,
      brand,
      c: {
        job_id: id,
        event: "write_off",
        quantity: 1,
        stylist_user_id: before.assigned_staff_user_id,
        reason,
        created_by: user.user_id,
      },
    });
    await A(
      brand,
      user,
      "service_jobs.write_off",
      "service_job",
      id,
      { reason },
      request_id,
    );
    events.emit("wig_written_off", { brand, job_id: id });
    return entry;
  });
}

/**
 * Cron entry: across every brand, flag wigs that have been OUT with a stylist
 * longer than the brand's missing-wig threshold. Emits `wigs_overdue` so Ops
 * dashboards/notifications can surface "go check on this wig".
 */
async function runMissingWigCheck() {
  let flagged = 0;
  for (const brand of BRANDS) {
    let overdue = [];
    try {
      const cfg = await repo.getStudioConfig({ brand });
      overdue = await repo.overdueOutWigs({
        brand,
        threshold_days: cfg.missing_wig_threshold_days || 7,
      });
    } catch {
      continue;
    }
    if (overdue.length) {
      flagged += overdue.length;
      events.emit("wigs_overdue", { brand, count: overdue.length, overdue });
      // Push a person: notify each overdue job's owner (Ops) so the
      // "go check on this wig" signal doesn't only live on the dashboard.
      const byOwner = new Map();
      for (const w of overdue) {
        if (!w.created_by) continue;
        if (!byOwner.has(w.created_by)) byOwner.set(w.created_by, []);
        byOwner.get(w.created_by).push(w);
      }
      for (const [owner, wigs] of byOwner) {
        const first = wigs[0];
        await notifyUser({
          brand,
          user_id: owner,
          type: "wig_overdue",
          title: `${wigs.length} wig${wigs.length === 1 ? "" : "s"} overdue with a stylist`,
          body:
            wigs.length === 1
              ? `Job ${first.job_number} has been with ${first.stylist_name || "a stylist"} ${first.days_out} days — please check.`
              : `${wigs.length} wigs are past the check-in threshold. Open Wig Accountability to review.`,
          job_id: first.job_id,
          priority: "high",
        });
      }
    }
  }
  return { flagged };
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
  assignStylist,
  startWork,
  pauseWork,
  resumeWork,
  logMaterial,
  listMaterials,
  addReference,
  listReferences,
  removeReference,
  listTimeLogs,
  returnForQc,
  recordQc,
  dispatch,
  handToSales,
  getAccountability,
  listCustodyLedger,
  writeOffWig,
  runMissingWigCheck,
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
