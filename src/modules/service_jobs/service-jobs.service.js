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
const sharedTasksRepo = require("../../shared/tasks/tasks.repo");
const grantsRepo = require("../../shared/access/grants.repo");
const events = require("./service-jobs.events");
const ai = require("./service-jobs.ai");
const orderReadiness = require("../sales/order-readiness");
const { audit } = require("../../middleware/audit");
const { transaction, withSavepoint } = require("../../config/database");
const { captureError } = require("../kaizen/errors/errors.capture");
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

/**
 * Run a best-effort side-step inside the caller's transaction: isolate it in a
 * SAVEPOINT, and on failure log it, report it to Kaizen, and carry on.
 *
 * The SAVEPOINT is the whole point. Every one of these steps calls into stock
 * (and through it, costing + the GL), which RAISEs on a real business condition
 * — `stock_reserved_le_on_hand` when a wig isn't on hand, a missing GL account,
 * a locked period. Without the savepoint that RAISE aborts the entire
 * transaction, so the swallow here bought nothing: the next statement on the
 * connection died with 25P02 ("Something interrupted that step") and the true
 * cause never left this log line. See withSavepoint() in config/database.js.
 *
 * @param {{ client: any, step: string, brand?: string, job_id?: string }} where
 * @param {() => Promise<any>} fn
 */
async function bestEffort({ client, step, brand, job_id }, fn) {
  try {
    return await withSavepoint(client, fn);
  } catch (err) {
    logger.warn({ err, brand, job_id }, `${step} skipped`);
    // These used to be log-only, which is why the Errors console stayed empty
    // while staff were being told to "try again". A skipped step is a real
    // backend fault worth a row — it just isn't worth failing the request over.
    captureError(err, null, {
      source: "backend",
      severity: "warning",
      context: { module: "service_jobs", component: step },
    });
    return null;
  }
}

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
      r: {
        job_id,
        ref_type: "video_link",
        url: link,
        created_by,
        is_locked: true,
      },
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
    // Completing a job deducts NOTHING. This was a third writer of the same
    // draw (after markPaid and the old assign-time deduction), guarded by yet
    // another pair of heuristics — "no custody OUT" and "the sale hasn't drawn
    // yet" — both of which a deposit-triggered order could satisfy while the
    // balance was still outstanding, taking a second unit for one wig.
    //
    // The sale is the single writer now: an order-linked job's wig is drawn by
    // markPaid, and an unlinked job (sample, rework, shoot) never moves stock
    // at all — the assign screen says so, and stock is corrected through the
    // Adjustments queue if such a job did consume a tracked unit.
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
 * The Unbilled queue — every job that owes a sale, at every stage.
 *
 * §6.30 already flags this, but only once a job is `completed`: the
 * `no_sale_linked` insight and the "No Sale (risk)" tile both fire after the
 * styling is finished and the hair has gone back to the customer. That is the
 * worst moment to learn nobody raised an invoice, and it is why FLH-JOB-0035
 * sat completed with an unbilled styling fee.
 *
 * This is the live version. It also splits the count by WHY, so a wig styled
 * for a shoot stops padding the same number as a customer job nobody billed —
 * the reason the old tile was safe to ignore.
 */
async function listUnbilledJobs({ brand, kind }) {
  const [jobs, counts] = await Promise.all([
    repo.listUnbilledJobs({ brand, kind: kind === "all" ? null : kind }),
    repo.unbilledJobCounts({ brand }),
  ]);
  return { data: jobs, counts };
}

/**
 * Ask Sales to raise the sale this job is owed.
 *
 * Notifies everyone who can actually create a sale for the brand (resolved
 * from the permission, not a hard-coded role name — brands rename roles), and
 * deeplinks them to Quick Sale pre-filled from the job. Stamps the request on
 * the job so the button becomes "Sales notified 2h ago" instead of letting
 * three people ask three times.
 */
async function requestSaleForJob({ brand, user, request_id, id }) {
  const job = await repo.getServiceJob({ brand, id });
  if (!job) throw new NotFoundError("Service job");
  if (job.sales_order_id) {
    throw new AppError(
      "ALREADY_LINKED",
      "This job already has a sale behind it",
      409,
      { user_message: "This job already has a sale linked to it." },
    );
  }
  if (job.revenue_kind === "internal") {
    throw new AppError(
      "INTERNAL_JOB",
      "An internal job is not owed a sale",
      409,
      {
        user_message:
          "This job is marked internal, so no sale is owed. Change how it's classified if that's wrong.",
      },
    );
  }
  const updated = await repo.markSaleRequested({
    brand,
    id,
    user_id: user.user_id,
  });
  // Prefill what we already know so whoever picks this up isn't retyping the
  // job back into a form. The job id rides along so completing the sale can
  // link back to it rather than creating a second, disconnected record.
  const params = [["from_job", id]];
  if (job.customer_contact_id)
    params.push(["contact", job.customer_contact_id]);
  if (job.hair_variant_id) params.push(["variant", job.hair_variant_id]);
  // Own-hair work sells a styling SERVICE, not a wig — the form opens with no
  // product line so nobody accidentally bills the customer for their own hair.
  if (job.revenue_kind === "customer_own_hair")
    params.push(["service_only", "1"]);
  const action_url = `/sales/quick-sale?${params
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&")}`;

  const recipients = await grantsRepo.listUsersWithPermission({
    business: brand,
    module: "sales",
    action: "create",
  });
  const amount = job.agreed_cost_ngn || job.actual_cost_ngn || null;
  await Promise.all(
    recipients
      // Don't notify the person who just pressed the button.
      .filter((r) => r.user_id !== user.user_id)
      .map((r) =>
        notifyUser({
          brand,
          user_id: r.user_id,
          type: "service_job_sale_needed",
          title: "Styling job needs a sale raised",
          body: `${job.job_number}${job.customer_name ? ` for ${job.customer_name}` : ""} has no sale${amount ? ` — agreed ${amount}` : ""}.`,
          job_id: id,
          priority: "high",
          action_url,
        }),
      ),
  );
  await A(
    brand,
    user,
    "service_jobs.request_sale",
    "service_job",
    id,
    { notified: recipients.length, revenue_kind: job.revenue_kind || null },
    request_id,
  );
  events.emit("sale_requested", { brand, job_id: id });
  return { ...updated, notified: recipients.length, action_url };
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
  const spec = {};
  if (dna && dna.sop_steps) spec.sop_steps = dna.sop_steps;
  if (order.specific_instructions && String(order.specific_instructions).trim()) {
    spec.order_specific_instructions = String(order.specific_instructions).trim().slice(0, 2000);
    spec.order_specific_instructions_at = new Date().toISOString();
  }
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
      specification: Object.keys(spec).length ? spec : null,
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
  action_url,
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
      // opens the job drawer directly. Callers can override when the useful
      // destination is elsewhere — "raise the sale" wants Quick Sale, not the
      // job the reader already knows about.
      action_url: action_url || `/service-jobs?tab=board&job=${job_id}`,
    });
  } catch (err) {
    logger.warn({ err, job_id, user_id }, "studio notification skipped");
  }
}

/**
 * THE SALE OWNS THE STOCK DRAW. Assigning a stylist never deducts.
 *
 * There used to be two paths that wrote a 'sale' movement for one physical
 * wig — markPaid on the order, and the Studio on assignment — with a guard on
 * the Studio side only ("has the sale drawn yet?"). That guard asked a
 * question whose answer changes over time, so on a deposit-triggered order
 * (job opens at deposit, balance paid later) it answered "no", the Studio
 * deducted, and markPaid deducted the same unit again: −2 for one wig. An
 * unlinked job had no order to ask about at all and always deducted.
 *
 * The rule now: `markPaid` is the single writer of the 'sale' movement.
 * Assignment moves the wig into stylist custody and holds it against being
 * sold twice, which is the guarantee that actually matters while the balance
 * is outstanding.
 *
 * Holding it: every order reserves its lines at placement, so an order-linked
 * job's unit is already held and this is a no-op. It only reserves when that
 * hold is missing (legacy orders placed before reservation-at-placement), so
 * the unit can never be sold out from under a stylist who physically has it.
 * Unlinked jobs have no order to reserve against and, by decision, never
 * touch stock — the assign screen warns the assigner in so many words.
 */
/**
 * Is the wig this job needs actually accounted for? Assignment is a CUSTODY
 * event, not a stock event — the physical wig moves from the business to the
 * stylist, and `wig_custody_ledger` records that. Quantity does not change.
 *
 * Which is why this no longer writes anything. It used to try to `reserve` the
 * wig here, and that call could only ever execute in one situation: the sale
 * had neither drawn the unit nor held it. For a healthy order both guards
 * return early, so the reserve was dead code on good data — and on bad data it
 * RAISEd `stock_reserved_le_on_hand`, aborted the transaction and surfaced as
 * "Something interrupted that step. Please try again."
 *
 * The situation it fired in is real, though, and worth refusing rather than
 * papering over: an out-of-stock line is sold as a PRE-ORDER (no reservation),
 * and `markPaid` deliberately will not fail a payment over missing stock
 * (savepointed, flags `stock_shortfall`, proceeds). So an order can be fully
 * paid with zero stock ever moved — and the hair does not exist. You cannot
 * hand a stylist a wig that isn't there, and no acknowledgement tick conjures
 * one; the only real fix is to receive the stock. Hence a block with a
 * Reception deeplink instead of an override.
 *
 * Returns null when the wig is accounted for (or no wig is involved), else a
 * reason object the caller turns into a refusal.
 */
async function wigAccountabilityProblem({ client, brand, job }) {
  const variant_id = job.reserved_variant_id || job.hair_variant_id;
  // No tracked variant at all — the customer brought their own hair, or the
  // job names it in free text. Our stock is not involved and never was.
  if (!variant_id) return null;

  const stockRepo = require("../stock/stock.repo");
  const loc = await stockRepo.getDefaultLocation({ client, brand });
  // No stock location configured — this brand isn't tracking stock, so there
  // is nothing to check against and nothing to be wrong about.
  if (!loc) return null;

  if (job.sales_order_id) {
    // Drawn by the sale (order paid) → the unit left the shelf for THIS order.
    // That is the wig now going out to the stylist. This is the normal path.
    if (
      await repo.orderAlreadyDrewWig({
        client,
        brand,
        sales_order_id: job.sales_order_id,
        variant_id,
      })
    )
      return null;
    // Held by the order's own reservation at placement → the unit is on the
    // shelf with this order's name on it. Also fine.
    const held = await stockRepo.outstandingReservationForOrder({
      client,
      brand,
      variant_id,
      location_id: loc.location_id,
      reference_id: job.sales_order_id,
    });
    if (held > 0) return null;
    // Neither. The sale never took a unit and never held one, which means the
    // hair was not in stock when it sold.
    return {
      code: "WIG_NOT_IN_STOCK",
      variant_id,
      user_message:
        "This hair isn't in stock — the sale never drew it, so there's nothing to hand the stylist. If the hair has physically arrived, receive it in Stock → Reception first.",
    };
  }

  // Unlinked job on one of OUR variants. No sale has drawn it, so the unit
  // should still be sitting on the shelf; assignment is only safe if it is.
  const level = await stockRepo.lockLevel({
    client,
    brand,
    variant_id,
    location_id: loc.location_id,
  });
  if (level && Number(level.on_hand) > 0) return null;
  return {
    code: "WIG_NOT_IN_STOCK",
    variant_id,
    user_message:
      "This hair isn't in stock, so there's nothing to hand the stylist. If it has physically arrived, receive it in Stock → Reception first.",
  };
}

// A stylist studio job assigned with no promised date still needs a clock so
// it surfaces on the stylist's My Day and counts on the SLA scorecards. When
// the assigner doesn't set (or override) a deadline, default it to 48h out.
const DEFAULT_STUDIO_TURNAROUND_MS = 48 * 60 * 60 * 1000;

/**
 * Put back what THIS job took out, on unassign.
 *
 * Since the sale owns the draw, a job assigned today takes nothing out and
 * this is a clean no-op. It exists for LEGACY jobs assigned before that rule,
 * which do carry a Studio 'sale' movement — and it decides from that job's own
 * movement ledger rather than from the state of the sale.
 *
 * The old version asked `orderAlreadyDrewWig` here too. On a job assigned
 * before payment and unassigned after it, that returned true and skipped the
 * restock — even though the Studio really had deducted — and the unit was
 * gone for good. Asking "what does this job still have out?" can't drift.
 */
async function restockBaseWig({ client, brand, job, user_id }) {
  const variant_id = job.reserved_variant_id || job.hair_variant_id;
  if (!variant_id) return;
  const drawn = await repo.studioDrawBalanceForJob({
    client,
    brand,
    job_id: job.job_id,
  });
  if (drawn <= 0) return; // nothing of this job's own is out — nothing to undo
  // Savepointed for the same reason as the hold above. Nothing writes on this
  // client after the call site in unassignStaff, so an abort here wouldn't even
  // have raised 25P02 — Postgres would have quietly turned the COMMIT into a
  // ROLLBACK and returned 200 with the unassign silently discarded.
  await bestEffort(
    { client, brand, job_id: job.job_id, step: "studio base-wig restock" },
    async () => {
      const stockService = require("../stock/stock.service");
      const stockRepo = require("../stock/stock.repo");
      const loc = await stockRepo.getDefaultLocation({ client, brand });
      if (!loc) return;
      await stockService.receiveStock({
        client,
        brand,
        variant_id,
        location_id: loc.location_id,
        quantity: 1,
        reference_id: job.job_id,
        reference_type: "service_job",
        unit_cost_ngn: null,
        user_id,
      });
    },
  );
}

/**
 * Assign an in-house stylist (staff). Reserves + deducts the base wig, writes a
 * custody OUT row (so the wig is now accounted for in the stylist's hands), and
 * notifies them. The DB trigger separately raises a task on their Workspace.
 *
 * The deadline is set here, at the assigning level: `expected_completion_at`
 * (explicit assigner value) wins, else the job's existing promised date is
 * kept, else it defaults to +48h. Stamping it in the same UPDATE that sets the
 * assignee means the BEFORE trigger writes it onto the freshly-raised task's
 * due date; on a reassignment (task already exists) we sync it below.
 */
async function assignStylist({
  brand,
  user,
  request_id,
  id,
  assigned_staff_user_id,
  expected_completion_at,
  acknowledge_unlinked,
}) {
  const outcome = await transaction(async (client) => {
    const before = await repo.getServiceJob({ client, brand, id });
    if (!before) throw new NotFoundError("Service job");
    // A job with no sales order behind it is allowed out — samples, rework,
    // shoots are real work — but it moves no stock and nothing downstream
    // will ever reconcile it against a sale. The assigner has to say, in one
    // deliberate click, that they know that. The UI shows the warning; this
    // is the server-side half, so the acknowledgement can't be skipped by
    // calling the API directly.
    if (!before.sales_order_id && acknowledge_unlinked !== true) {
      throw new AppError(
        "UNLINKED_JOB_NOT_ACKNOWLEDGED",
        "Assigning a job with no sales order requires explicit acknowledgement",
        409,
        {
          user_message:
            "This job has no sale behind it. Stock will not move — acknowledge the warning to assign it anyway.",
          metadata: { job_id: id, requires_acknowledgement: true },
        },
      );
    }
    // You cannot hand a stylist a wig that isn't there. Checked BEFORE any of
    // the assignment is written — including the tag code, which is meant to go
    // on a physical wig and shouldn't be allocated for one that doesn't exist.
    // No override: if the hair has genuinely arrived, the fix is to receive it
    // into stock, which the deeplink takes you to. See
    // wigAccountabilityProblem() for why this replaced a stock write.
    const problem = await wigAccountabilityProblem({
      client,
      brand,
      job: before,
    });
    if (problem) {
      throw new AppError(
        problem.code,
        "The wig for this job is not accounted for in stock",
        409,
        {
          user_message: problem.user_message,
          metadata: {
            job_id: id,
            variant_id: problem.variant_id,
            // The frontend turns this into the "Receive it in Stock →
            // Reception" button on the refusal, so the block is a door rather
            // than a dead end.
            // Tab id is `receive` (StockPage) — the tab LABEL is "Goods
            // Reception", but useUrlTab keys off the id, and a wrong id
            // silently lands on Overview instead.
            resolve_action: {
              label: "Receive stock",
              url: `/stock?tab=receive&variant=${problem.variant_id}`,
            },
          },
        },
      );
    }
    const deadline =
      expected_completion_at ||
      before.expected_completion_at ||
      new Date(Date.now() + DEFAULT_STUDIO_TURNAROUND_MS).toISOString();
    const fields = {
      assigned_staff_user_id,
      assigned_at: new Date().toISOString(),
      expected_completion_at: deadline,
    };
    // Keep the promised-delivery SLA clock in step: stamp it on first set, and
    // move it when the assigner explicitly re-sets the deadline.
    if (!before.sla_due_at || expected_completion_at)
      fields.sla_due_at = deadline;
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
    // The create-task trigger only fires on FIRST assignment (task_id was
    // NULL). When the job already carries a task, a reassignment must move it
    // to the new stylist and re-stamp its due date — done post-commit below.
    const priorTaskId = before.task_id;
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
      {
        assigned_staff_user_id,
        // Who waved through a no-sale assignment is worth keeping.
        ...(before.sales_order_id ? {} : { unlinked_acknowledged: true }),
      },
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
    return { job, isNewTag, priorTaskId, deadline };
  });

  const { job, isNewTag, priorTaskId, deadline } = outcome;
  // Reassignment: the create-task trigger left the existing task untouched, so
  // move it onto the new stylist and re-stamp its due date here (best-effort,
  // post-commit — a failed sync must never undo a committed assignment).
  if (priorTaskId) {
    try {
      await sharedTasksRepo.updateTask({
        brand,
        id: priorTaskId,
        patch: { assigned_to: assigned_staff_user_id, due_at: deadline },
      });
    } catch (err) {
      logger.warn(
        { err, brand, job_id: id, task_id: priorTaskId },
        "service_jobs: failed to sync task on reassignment",
      );
    }
  }
  return { ...job, is_new_tag: isNewTag };
}

/**
 * Revert an assignment back to Unassigned — CEO-only (gated at the route via
 * requireCeo). Only a job still in 'assigned' (not yet started) can be reverted;
 * once work has begun the wind-back involves custody/QC and is out of scope
 * here. Reverses exactly what assignStylist did: clears the assignee + assigned
 * timestamp, drops the job back to 'pending', balances the custody OUT with a
 * matching RETURN (so the wig frees up and Wig Accountability stays correct),
 * and puts the base wig back if the Studio had drawn it. The physical tag_code
 * and the reserved base wig are intentionally kept — the tag is written on the
 * hair and must survive a later re-assignment of the same job.
 */
async function unassignStaff({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const before = await repo.getServiceJob({ client, brand, id });
    if (!before) throw new NotFoundError("Service job");
    if (!before.assigned_staff_user_id) {
      throw new AppError(
        "NOT_ASSIGNED",
        "This job is not assigned to anyone.",
        409,
        {
          user_message: "This job is already unassigned.",
        },
      );
    }
    if (before.status !== "assigned") {
      throw new AppError(
        "INVALID_STATE",
        "Only a job still in 'assigned' (not yet started) can be reverted to unassigned.",
        409,
        {
          user_message:
            "This job has already moved past assignment, so it can't be reverted here.",
        },
      );
    }
    const job = await repo.setServiceJobStatus({
      client,
      brand,
      id,
      status: "pending",
      fields: { assigned_staff_user_id: null, assigned_at: null },
    });
    // Balance the assignment's custody OUT so the wig is no longer "with" the
    // removed stylist — otherwise it reads as still out and can't be reassigned.
    await repo.addCustody({
      client,
      brand,
      c: {
        job_id: id,
        event: "return",
        quantity: 1,
        stylist_user_id: before.assigned_staff_user_id,
        created_by: user.user_id,
        reason: "assignment reverted to unassigned (CEO)",
      },
    });
    await restockBaseWig({ client, brand, job: before, user_id: user.user_id });
    await A(
      brand,
      user,
      "service_jobs.unassign",
      "service_job",
      id,
      { reverted_assignee: before.assigned_staff_user_id },
      request_id,
    );
    events.emit("advanced", { brand, job_id: id, status: "pending" });
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
      // Savepointed: deducting a material that isn't on hand RAISEs, and the
      // plain try/catch here aborted the transaction — taking the material row
      // inserted just above down with it at COMMIT (silently, as a ROLLBACK),
      // so the stylist's logged material vanished and the API still said OK.
      // Now the material is always recorded; only the stock draw is skipped.
      await bestEffort(
        { client, brand, job_id: id, step: "studio material deduction" },
        async () => {
          const stockService = require("../stock/stock.service");
          const stockRepo = require("../stock/stock.repo");
          const loc = await stockRepo.getDefaultLocation({ client, brand });
          if (!loc) return;
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
        },
      );
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
  // Set inside the transaction, read after it commits. Two different flags,
  // because the two post-commit effects want different questions answered:
  //
  //   orderReleased — did THIS pass move the order to order_ready? Gates the
  //     customer message, which must go out exactly once.
  //   orderReady    — is the order's studio work finished at all? Gates the
  //     Logistics delivery, which is an idempotent backstop: it must still run
  //     when the order reached order_ready some other way (a manual early
  //     release from the drawer), but never while hairs are outstanding.
  //
  // `orderProgress` carries the "2 of 3" figures for the audit trail.
  // transaction() makes one attempt and never retries, so closing over these
  // is safe.
  let orderReleased = false;
  let orderReady = false;
  let orderProgress = null;
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
      // This wig leaves the stylist's hands for staging — keep custody
      // balanced. Per-wig and immediate on purpose: the stylist's ledger
      // balance is Σ(out) − Σ(return) − Σ(dispatched), and this hair really has
      // left them, whether or not its order-mates are finished.
      await repo.addCustody({
        client,
        brand,
        c: {
          job_id: id,
          event: "dispatched",
          quantity: 1,
          created_by: user.user_id,
          reason: "QC passed → staged for order",
        },
      });
      // Styling is done on THIS hair — but an order can carry several (a
      // three-product order opens three jobs). The order only becomes
      // 'order_ready' when the LAST of them is done, so a client who ordered
      // three wigs isn't told the order is ready while two are still on a
      // bench. `studioProgress` runs on this transaction's client, so it counts
      // the job we just completed above.
      //
      // Deliberately NOT 'dispatched' — the parcel hasn't left, so the customer
      // is never told it shipped at QC. Guarded so a re-QC can't rewind a later
      // stage.
      if (before.sales_order_id) {
        const salesRepo = require("../sales/sales.repo");
        const progress = await orderReadiness.studioProgress({
          client,
          brand,
          order_id: before.sales_order_id,
        });
        orderReady = progress.ready;
        if (progress.ready) {
          const moved = await salesRepo.advanceStatus({
            client,
            brand,
            id: before.sales_order_id,
            to: "order_ready",
            from: ["paid", "partially_paid", "assigned"],
          });
          // Only a REAL transition releases the customer-facing effects below.
          // 'order_ready' is deliberately absent from the `from` list: an order
          // already sitting there returns null here, so a re-QC after rework —
          // or a hair added by a Change Order after the order went ready —
          // can't send the customer a second "Order Ready".
          orderReleased = Boolean(moved);
        }
        orderProgress = progress;
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
      // reason survives. The studio progress at this moment rides along too, so
      // "why didn't the client get the mail on wig #1?" is answerable from the
      // audit trail alone.
      {
        result: input.result,
        quality_notes: input.quality_notes ?? null,
        ...(orderProgress
          ? {
              order_items_done: orderProgress.done,
              order_items_total: orderProgress.total,
              order_released: orderReleased,
            }
          : {}),
      },
      request_id,
    );
    events.emit("advanced", { brand, job_id: id, status });
    if (status === "completed") events.emit("completed", { brand, job_id: id });
    return updated;
  });

  // Post-commit, best-effort: tell the customer and create the Logistics
  // delivery — but only once the WHOLE order is finished. On a three-wig order
  // the first two passes fall straight through here: no mail, no parcel, no
  // status move. Reuses the idempotent order→delivery creator, which no-ops for
  // orders that don't need shipping (e.g. own-wig pickup) and for one that
  // already has a delivery. Never blocks the QC decision itself — if this
  // fails, Ops can still ship from the order.
  if (orderReady && job && job.status === "completed" && job.sales_order_id) {
    try {
      const salesRepo = require("../sales/sales.repo");
      const logistics = require("../logistics/logistics.service");
      const orderComms = require("../sales/order-comms");
      const order = await salesRepo.findById({ brand, id: job.sales_order_id });
      // "Order Ready" customer message (gated by Messaging settings; no-op if
      // the CEO toggled it Off). Only on the pass that actually released the
      // order: if it was already at order_ready — a re-QC after rework, or a
      // manual early release that already messaged her — she is not told twice.
      if (order && orderReleased) await orderComms.orderReady({ brand, order });
      const delivery = order
        ? await logistics.createForOrder({ brand, order })
        : null;
      if (delivery && delivery.delivery_id) {
        // Every hair on this order travels in that one parcel, so every job on
        // it carries the shipment — not just the one that happened to finish
        // last. Without this the first two wigs of a three-wig order would show
        // no shipment at all on the job screen.
        await repo.setShipmentForOrderJobs({
          brand,
          order_id: job.sales_order_id,
          shipment_id: delivery.delivery_id,
        });
        const stamped = await repo.getServiceJob({ brand, id });
        if (stamped) return stamped;
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
  const forcedUserId = scope === "own" && user ? user.user_id : stylist_user_id;
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
  unassignStaff,
  listUnbilledJobs,
  requestSaleForJob,
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
