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
const icRepo = require("../intercompany/intercompany.repo");
const events = require("./service-jobs.events");
const ai = require("./service-jobs.ai");
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
    // Without this, audit()'s own fallback is String(user_id) — a raw UUID —
    // which is exactly what showed up in the job Activity tab and the
    // stylist scorecard's rework history (both read shared.audit_log
    // directly). req.user always carries display_name from authMiddleware.
    user_name: user ? user.display_name || user.email : "system",
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
//
// `own` scope: restrict to jobs the caller is currently assigned to OR was
// ever assigned to (kept visible via the wig custody ledger so a stylist
// keeps history on their scorecard after Ops reassigns a job away).
//
// `mine`: the "My Jobs" cockpit opts in to the SAME caller-narrowed filter
// regardless of permission scope. Without this a team/all-scope caller (Ops
// manager, CEO) gets the WHOLE brand's jobs back on that tab, and the frontend
// then mislabels every job that isn't personally theirs as "reassigned away
// from me". Own-scope callers are narrowed by the repo either way, so `mine`
// only changes behaviour for the broader scopes.
function listJobs(args) {
  const { scope, user, mine, ...rest } = args;
  if ((mine || scope === "own") && user) {
    return repo.listServiceJobs({ ...rest, own_user_id: user.user_id });
  }
  return repo.listServiceJobs(rest);
}

/**
 * Look up one job with permission-scope enforcement. An `own`-scoped caller
 * (e.g. a stylist) is allowed to open a job they are or ever were assigned to
 * — otherwise we throw NO_LONGER_ASSIGNED with the current owner's name so the
 * frontend can show "This job was reassigned to X → Back to my jobs" instead
 * of a bare 403.
 */
async function getJob({ brand, id, scope, user }) {
  const job = await repo.getServiceJob({ brand, id });
  if (!job) throw new NotFoundError("Service job");
  if (scope === "own" && user) {
    const isOwner = await repo.userHasJobAccess({
      brand,
      job_id: id,
      user_id: user.user_id,
    });
    if (!isOwner) {
      const currentAssignee = await repo.getJobAssigneeName({ brand, id });
      throw new AppError(
        "NO_LONGER_ASSIGNED",
        `Job ${job.job_number} is no longer assigned to this user`,
        403,
        {
          user_message: currentAssignee
            ? `You no longer have access to this job — it has been reassigned to ${currentAssignee}.`
            : "You no longer have access to this job.",
          metadata: {
            reassigned: {
              to_name: currentAssignee,
              job_number: job.job_number,
            },
          },
        },
      );
    }
  }
  return job;
}
async function createJob({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    // brief is not a service_jobs column — it becomes locked reference rows
    // (the customer's original request), so peel it off before the insert.
    const { brief, ...jobInput } = input;
    const job_number = await repo.nextNumber({
      client,
      brand,
      type: "service_job",
    });
    const job = await repo.createServiceJob({
      client,
      brand,
      job: { ...jobInput, job_number, created_by: user.user_id },
    });
    await addLockedBrief({ client, brand, job_id: job.job_id, brief, user });
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

/**
 * Write the customer's style brief as locked reference rows at job open — a
 * text note and/or an inspiration link. Locked (is_locked = true) so the
 * original request can't later be overwritten or deleted; supplementary
 * stylist/QC notes are added separately (unlocked) via addReference.
 * Shared by manual creation (typed brief) and order auto-open (line notes).
 */
async function addLockedBrief({ client, brand, job_id, brief, user }) {
  if (!brief) return;
  const created_by = user ? user.user_id : null;
  const note = typeof brief.body === "string" ? brief.body.trim() : "";
  const link = typeof brief.url === "string" ? brief.url.trim() : "";
  if (note)
    await repo.addReference({
      client,
      brand,
      r: { job_id, ref_type: "text", body: note, created_by, is_locked: true },
    });
  if (link)
    await repo.addReference({
      client,
      brand,
      r: { job_id, ref_type: "video_link", url: link, created_by, is_locked: true },
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
    // unless the Stylist Studio assign flow already pulled it (custody OUT), OR
    // the originating sales order already drew this wig at payment (styled
    // products sold as an order deduct in markPaid). Either case, deducting here
    // would remove a second unit for one physical wig.
    const alreadyOut = await repo.hasCustodyEvent({
      client,
      brand,
      job_id: id,
      event: "out",
    });
    const orderDrewWig = job.hair_variant_id
      ? await repo.orderAlreadyDrewWig({
          client,
          brand,
          sales_order_id: job.sales_order_id,
          variant_id: job.hair_variant_id,
        })
      : false;
    if (
      status === "completed" &&
      job.hair_variant_id &&
      !alreadyOut &&
      !orderDrewWig
    ) {
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
  // Merge the staffer assignment with a move to 'assigned' so the DB task
  // trigger fires, the stylist gets the push notification, and the drawer
  // stops showing "Unassigned" — one call, one status transition.
  const patch = { assigned_staff_user_id };
  if (before.status === "pending") {
    patch.status = "assigned";
    patch.assigned_at = new Date().toISOString();
  }
  const job = await repo.updateServiceJob({ brand, id, patch });
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
  // Advance the linked order into 'assigned' (see assignStylist). Guarded — only
  // moves a paid / partially-paid order forward, never rewinds a later stage.
  if (job.sales_order_id) {
    const salesRepo = require("../sales/sales.repo");
    await salesRepo.advanceStatus({
      brand,
      id: job.sales_order_id,
      to: "assigned",
      from: ["paid", "partially_paid", "assigned"],
    });
  }
  return job;
}

/**
 * List staff who can be picked as the assignee on a service-job drawer.
 * Frontend uses this to populate the stylist chooser; each row carries the
 * live open-jobs count + on-leave-today flag so the picker can balance load
 * and grey out anyone away.
 */
async function listAssignableStylists({ brand }) {
  return repo.listAssignableStylists({ brand });
}

// ── Scorecards (internal Stylist Studio only — NOT the Stylist Partner
// Programme; that's a separate module with its own review system) ──
//
// Scope discipline:
//   * `own`-scope callers (stylists) only ever see their OWN card. The
//     "team scorecards" list is Ops-only; on `own` scope we return just
//     the caller's row so the frontend's "My Scorecard" tile still works
//     without accidentally leaking teammates' numbers.
//   * `own`-scope callers requesting anyone else's user_id get a clean
//     403 — no data leak, no confusing "not found".
function listStylistScorecards({ brand, scope, user }) {
  if (scope === "own" && user) {
    return repo
      .getStylistScorecard({ brand, user_id: user.user_id })
      .then((sc) => (sc ? [sc] : []));
  }
  return repo.listStylistScorecards({ brand });
}
async function getStylistScorecard({ brand, user_id, scope, user }) {
  if (scope === "own" && user && user.user_id !== user_id) {
    throw new AppError(
      "PERMISSION_DENIED",
      "You can only view your own scorecard",
      403,
      { user_message: "You can only view your own scorecard." },
    );
  }
  const scorecard = await repo.getStylistScorecard({ brand, user_id });
  if (!scorecard) throw new NotFoundError("Stylist has no job history");
  return scorecard;
}

async function summarizeJob({ brand, id }) {
  const job = await repo.getServiceJob({ brand, id });
  if (!job) throw new NotFoundError("Service job");
  return ai.summarizeJob(job);
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
    // One service job per HAIR. Every styling line (styled or service) becomes
    // `quantity` jobs — a line of qty 3 opens 3 independently-assignable jobs —
    // so a multi-hair order can be split across several stylists. Idempotent
    // per line: we only ever open the shortfall (want − already-open), so the
    // deposit/paid subscribers and the backfill can all re-run without dupes.
    const lines = await repo.allStudioLines({
      client,
      brand,
      order_id: order.order_id,
    });
    if (!lines.length) return null; // plain product order — nothing to style
    const created = [];
    for (const line of lines) {
      const want = Math.max(1, Number(line.quantity) || 1);
      const have = await repo.countJobsForLine({
        client,
        brand,
        line_id: line.line_id,
      });
      for (let n = have; n < want; n++) {
        const job = await openStudioJobForLine({ client, brand, order, line });
        if (job) created.push(job);
      }
    }
    return created.length ? created : null;
  });
}

// Open one hair's service job from a single order line. Split out of
// createForOrder so the first open and the per-unit fan-out share one path;
// runs inside the caller's transaction. Returns null when the brand runs no
// styling services (e.g. PXG), so the caller simply opens nothing for it.
async function openStudioJobForLine({ client, brand, order, line }) {
  const st = await repo.getDefaultServiceType({ client, brand });
  // Inherit production DNA from the styled product when present.
  const dna = line.styled_id
    ? await repo.getStyledDNA({ client, brand, styled_id: line.styled_id })
    : null;
  // Service type. A styled-product sale IS styling work by definition, so its
  // job opens as Styling — never the arbitrary display_order=1 default (which
  // is Installation: getDefaultServiceType returns the first active type and
  // 'installation' seeds at display_order=1). Genuine service lines
  // (styled_id NULL) keep the brand default, unchanged.
  //
  // Per-style service types (styled_products.default_service_type_id) are
  // intentionally NOT honoured here — every styled sale is Styling. To support
  // per-style types later, prefer dna.default_service_type_id ahead of the
  // styling lookup.
  const stylingType = line.styled_id
    ? await repo.getServiceTypeByKey({ client, brand, key: "styling" })
    : null;
  // The type actually used: Styling for a styled line, else the brand default.
  const serviceType = stylingType || st;
  const service_type_id = serviceType && serviceType.service_type_id;
  if (!service_type_id) return null; // brand runs no styling services (e.g. PXG)
  // Pricing is per hair: the styled add-on and the line unit price are already
  // per-unit figures, so each hair's job takes the same amount (no division).
  const agreed = dna
    ? (dna.style_addon_price_ngn ??
      (serviceType ? serviceType.standard_cost_ngn : 0))
    : (line.unit_price_ngn ??
      (serviceType ? serviceType.standard_cost_ngn : 0));
  // Turnaround → expected completion + SLA clock.
  const turnaround =
    (dna && dna.standard_turnaround_days) ||
    (serviceType && serviceType.standard_turnaround_days) ||
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
      hair_variant_id: line.variant_id || (dna && dna.base_variant_id) || null,
      sales_order_id: order.order_id,
      sales_order_line_id: line.line_id,
      customer_contact_id: order.contact_id,
      status: "pending",
      recipe_id: (dna && dna.default_recipe_id) || null,
      specification: dna && dna.sop_steps ? { sop_steps: dna.sop_steps } : null,
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
  // Carry the customer's request from the order line straight onto the job as a
  // locked brief, so the stylist opens the job already knowing what was asked
  // for (no user — this is a system-opened job).
  if (line.notes && line.notes.trim())
    await addLockedBrief({
      client,
      brand,
      job_id: job.job_id,
      brief: { body: line.notes },
      user: null,
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
      // Admin route is /service-jobs (the "Stylist Studio" nav item); ?job=
      // opens the job drawer directly.
      action_url: `/service-jobs?tab=board&job=${job_id}`,
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
  // Do NOT double-deduct: if this job came from a sales order whose payment
  // already pulled the base wig from stock (markPaid → deductForSale), the sale
  // owns that draw and the Studio only takes custody. Without this guard a
  // styled product sold as an order lost two units for one physical wig.
  if (
    await repo.orderAlreadyDrewWig({
      client,
      brand,
      sales_order_id: job.sales_order_id,
      variant_id,
    })
  )
    return;
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
    // Allocate the physical hand-off tag once, on first assignment — it's
    // written on a tag pinned to the actual hair, so it must stay stable
    // across any later reassignment of the same job. Format: 3-digit counter
    // + 2 letters drawn from the styled product name (falls back to the
    // free-text hair description, then "XX" for a bare custom job).
    const isNewTag = !before.tag_code;
    if (isNewTag) {
      const seq = await repo.nextTagSequence({ client, brand });
      const initials = repo.deriveTagInitials(
        before.styled_product_name || before.hair_description,
      );
      fields.tag_code = `${seq}${initials}`;
    }
    const job = await repo.setServiceJobStatus({
      client,
      brand,
      id,
      status: "assigned",
      fields,
    });
    // Reservation hard-lock: a wig already OUT with a stylist (net balance > 0)
    // cannot be re-released to someone else — it must be returned first. This
    // also correctly re-releases a wig on re-assignment AFTER a return (net 0),
    // where an "any out ever" check would have wrongly skipped the deduction.
    const net = await repo.jobCustodyBalance({ client, brand, job_id: id });
    if (net > 0) {
      throw new AppError(
        "WIG_ALREADY_OUT",
        "This wig is already out with a stylist and must be returned before it can be re-assigned.",
        409,
        // AppError's 4th arg is an options object; a bare string here was
        // silently discarded and the internal message leaked to the client.
        {
          user_message:
            "This wig is already with a stylist — have it returned first.",
        },
      );
    }
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
    // Advance the linked order into 'assigned' — the customer-facing signal
    // that a stylist is now working on it. Guarded so it only moves a paid /
    // partially-paid (deposit-cleared) order forward, never rewinds one already
    // packed/dispatched/completed, and never touches a cancelled order.
    if (job.sales_order_id) {
      const salesRepo = require("../sales/sales.repo");
      await salesRepo.advanceStatus({
        client,
        brand,
        id: job.sales_order_id,
        to: "assigned",
        from: ["paid", "partially_paid", "assigned"],
      });
    }
    await notifyUser({
      brand,
      user_id: assigned_staff_user_id,
      type: "service_job_assigned",
      title: "New styling job assigned",
      body: `Job ${job.job_number} is ready for you to start.`,
      job_id: id,
      priority: "high",
    });
    // is_new_tag tells the drawer whether to show the "copy this onto the
    // tag" confirmation modal — only on the assignment that actually
    // allocated the code, never on a later reassignment of the same job.
    return { ...job, is_new_tag: isNewTag };
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
    const job = await repo.setServiceJobStatus({
      client,
      brand,
      id,
      status: "on_hold",
      fields: {},
    });
    await A(
      brand,
      user,
      "service_jobs.pause",
      "service_job",
      id,
      {},
      request_id,
    );
    return job;
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
    const job = await repo.setServiceJobStatus({
      client,
      brand,
      id,
      status: "in_progress",
      fields: {},
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
    return job;
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

/** Add a supplementary style-brief note (image / audio / video link / text /
 * creative freedom). Always unlocked — the locked customer brief is written
 * only at job open (createJob / createForOrder), never through this endpoint,
 * so is_locked is forced false regardless of input. */
async function addReference({ brand, user, request_id, id, input }) {
  const job = await repo.getServiceJob({ brand, id });
  if (!job) throw new NotFoundError("Service job");
  const r = await repo.addReference({
    brand,
    r: { ...input, job_id: id, created_by: user.user_id, is_locked: false },
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

/**
 * The caller's currently-open time session, or null if no clock is running.
 * Drives the "You're working on Job X — 47m elapsed" strip at the top of
 * the Stylist Studio page for own-scope users, so they can pause without
 * having to hunt for the specific job card.
 */
function getMyCurrentSession({ brand, user }) {
  if (!user) return Promise.resolve(null);
  return repo.getUsersOpenSession({ brand, user_id: user.user_id });
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

/**
 * Ops QC decision.
 *
 * Pass → the styling job is DONE from the stylist's side: status jumps
 * straight to `completed`, `completed_at` is stamped, the wig leaves
 * the studio (custody `dispatched`), and a Logistics delivery is
 * auto-created for the linked order so Sales/Logistics can ship it.
 * This is the single moment that credits a stylist on their scorecard
 * and against HR `styles_completed` targets — no further clicks needed.
 *
 * Fail → status = `rework`, wig goes back out to the (same or reassigned)
 * stylist, rework_count increments, they get a push.
 */
async function recordQc({ brand, user, request_id, id, input }) {
  const nowIso = new Date().toISOString();
  const job = await transaction(async (client) => {
    const before = await repo.getServiceJob({ client, brand, id });
    if (!before) throw new NotFoundError("Service job");
    const fields = { qc_by: user.user_id, qc_at: nowIso };
    if (input.quality_rating !== undefined)
      fields.quality_rating = input.quality_rating;
    if (input.quality_notes !== undefined)
      fields.quality_notes = input.quality_notes;
    let status;
    if (input.result === "pass") {
      status = "completed";
      fields.completed_at = nowIso;
    } else {
      status = "rework";
      fields.rework_count = (before.rework_count || 0) + 1;
      if (input.reassign_to) fields.assigned_staff_user_id = input.reassign_to;
    }
    const updated = await repo.setServiceJobStatus({
      client,
      brand,
      id,
      status,
      fields,
    });
    if (status === "rework") {
      const stylist = input.reassign_to || before.assigned_staff_user_id;
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
    } else {
      // Wig leaves the studio for Logistics/Sales — keep custody balanced.
      await repo.addCustody({
        client,
        brand,
        c: {
          job_id: id,
          event: "dispatched",
          quantity: 1,
          created_by: user.user_id,
          reason: "QC passed → to logistics",
        },
      });
      // Styling is done and the wig is packed → advance the linked order to
      // 'order_ready' (packed, waiting for the courier). Deliberately NOT
      // 'dispatched' — the parcel hasn't left, so the customer is never told it
      // shipped at QC. Guarded so a re-QC can't rewind a later stage.
      if (before.sales_order_id) {
        const salesRepo = require("../sales/sales.repo");
        await salesRepo.advanceStatus({
          client,
          brand,
          id: before.sales_order_id,
          to: "order_ready",
          from: ["paid", "partially_paid", "assigned", "order_ready"],
        });
      }
    }
    await A(
      brand,
      user,
      "service_jobs.qc",
      "service_job",
      id,
      // quality_notes rides along so the job's activity/rework history shows
      // the actual reason at each QC pass, not just pass/fail — the job row
      // itself only ever holds the LATEST quality_notes, overwritten on the
      // next QC call, so this audit trail is the only place a past rework
      // reason survives.
      { result: input.result, quality_notes: input.quality_notes ?? null },
      request_id,
    );
    events.emit("advanced", { brand, job_id: id, status });
    if (status === "completed") events.emit("completed", { brand, job_id: id });
    return updated;
  });

  // Post-commit, best-effort: on QC pass, create the Logistics delivery.
  // Reuses the idempotent order→delivery creator, which no-ops for orders
  // that don't need shipping (e.g. own-wig pickup). Never blocks the QC
  // decision itself — if this fails, Ops can still ship from the order.
  if (job && job.status === "completed" && job.sales_order_id) {
    try {
      const salesRepo = require("../sales/sales.repo");
      const logistics = require("../logistics/logistics.service");
      const orderComms = require("../sales/order-comms");
      const order = await salesRepo.findById({ brand, id: job.sales_order_id });
      // "Order Ready" customer message (gated by Messaging settings; no-op if the
      // CEO toggled it Off). Best-effort — never blocks the logistics handoff.
      if (order) await orderComms.orderReady({ brand, order });
      const delivery = order
        ? await logistics.createForOrder({ brand, order })
        : null;
      if (delivery && delivery.delivery_id) {
        const stamped = await repo.setServiceJobStatus({
          brand,
          id,
          status: "completed",
          fields: { shipment_id: delivery.delivery_id },
        });
        return stamped;
      }
    } catch (err) {
      logger.warn(
        { err, job_id: id },
        "studio QC-pass → logistics handoff skipped",
      );
    }
  }
  return job;
}

/**
 * Flow-1 (Faitlyn styles Pixie's hair): bind this styling job to its matched
 * inter-company transaction — the FLH styling invoice raised to PXG. The IC
 * transaction is recorded + CEO-approved through the intercompany module (which
 * already forces a REAL seller invoice as its `seller_doc`); here we attach it
 * so both sides carry the link and the books-integrity watchdog (AI Insights →
 * no_intercompany_match) is satisfied. Never let a cross-entity styling job
 * exist without its matched invoice (V2.2 §5.1 Flow 1).
 */
async function linkIntercompany({
  brand,
  user,
  request_id,
  id,
  ic_transaction_id,
}) {
  return transaction(async (client) => {
    const job = await repo.getServiceJob({ client, brand, id });
    if (!job) throw new NotFoundError("Service job");
    const ic = await icRepo.findById({ client, id: ic_transaction_id });
    if (!ic) throw new NotFoundError("Intercompany transaction");
    if (ic.flow_type !== "styling")
      throw new AppError(
        "IC_NOT_STYLING",
        "Only a styling inter-company transaction can be linked to a service job",
        422,
      );
    if (ic.seller_brand !== brand)
      throw new AppError(
        "IC_WRONG_SELLER",
        `This job's brand (${brand}) must be the seller on the inter-company transaction`,
        422,
      );
    if (["rejected", "cancelled", "reversed"].includes(ic.status))
      throw new AppError(
        "IC_NOT_ACTIVE",
        `Cannot link a ${ic.status} inter-company transaction`,
        409,
      );

    const linked = await repo.linkIntercompany({
      client,
      brand,
      id,
      ic_transaction_id,
    });
    // Back-reference the job on the IC txn when it isn't already pointed at one,
    // so the intercompany side shows which styling job it settles.
    if (!ic.reference_id) {
      await icRepo.setStatus({
        client,
        id: ic_transaction_id,
        status: ic.status,
        fields: { reference_type: "service_job", reference_id: id },
      });
    }
    await A(
      brand,
      user,
      "service_jobs.intercompany.link",
      "service_job",
      id,
      { ic_transaction_id, ic_number: ic.ic_number },
      request_id,
    );
    events.emit("advanced", { brand, job_id: id, status: linked.status });
    return repo.getServiceJob({ client, brand, id });
  });
}

// ── Wig accountability ─────────────────────────────────────
//
// Studio-wide accountability (all balances, all overdue) is Ops-only —
// stylists shouldn't see their teammates' custody balances. On `own`
// scope we filter down to the caller's row so a stylist can still see
// "you're holding N wigs" if we surface it, but no one else's.
async function getAccountability({ brand, scope, user }) {
  const cfg = await repo.getStudioConfig({ brand });
  const threshold = cfg.missing_wig_threshold_days || 7;
  const [balances, overdue] = await Promise.all([
    repo.custodyBalances({ brand }),
    repo.overdueOutWigs({ brand, threshold_days: threshold }),
  ]);
  if (scope === "own" && user) {
    return {
      threshold_days: threshold,
      balances: balances.filter((b) => b.stylist_user_id === user.user_id),
      overdue: overdue.filter((o) => o.stylist_user_id === user.user_id),
    };
  }
  return { threshold_days: threshold, balances, overdue };
}
function listCustodyLedger({ brand, job_id, stylist_user_id, scope, user }) {
  // `own`-scope: force the stylist filter to the caller — a stylist
  // querying the ledger without a stylist_user_id (or with someone else's)
  // gets only their own custody rows.
  const forcedUserId =
    scope === "own" && user ? user.user_id : stylist_user_id;
  return repo.listCustody({ brand, job_id, stylist_user_id: forcedUserId });
}
function listJobActivity({ brand, id }) {
  return repo.listJobActivity({ brand, job_id: id });
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
  listAssignableStylists,
  listStylistScorecards,
  getStylistScorecard,
  summarizeJob,
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
  getMyCurrentSession,
  linkIntercompany,
  getAccountability,
  listCustodyLedger,
  listJobActivity,
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
