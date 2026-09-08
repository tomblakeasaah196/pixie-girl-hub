/**
 * Order readiness — is the WHOLE order ready, or just one item of it?
 *
 * An order can carry several styling items: `service_jobs.createForOrder` opens
 * one job per hair (a 3-product order, or a single line of qty 3, becomes three
 * independently-assignable jobs). Every customer-facing "your order is ready"
 * effect must therefore wait for the LAST job, never the first.
 *
 * Origin (owner directive): a client who ordered three wigs was emailed "Order
 * Ready" the moment wig #1 passed QC, the order jumped to `order_ready`, and
 * Logistics queued a parcel that was one-third packed. Three separate code
 * paths each made the same "any one job = done" assumption; this module is the
 * one predicate all of them now ask.
 *
 * The rule, in one line:
 *
 *   the order is ready ⇔ it has at least one studio job AND none of them are
 *   still outstanding.
 *
 * Two deliberate decisions encoded here:
 *
 *   1. An order with NO studio jobs is not governed by this gate. A plain wig
 *      sale never opens a job (`createForOrder` returns null for a non-styling
 *      order), so `total === 0` must never mean "hold forever" — those orders
 *      keep whatever fulfilment path they already had.
 *   2. A cancelled or rejected job does NOT hold the order. One written-off wig
 *      would otherwise strand the parcel permanently, with no way out but a
 *      manual status override.
 */

"use strict";

const { ex } = require("../../config/database");
const { t } = require("../../config/brands");

/**
 * Studio work that is finished — the wig has left the stylist for good and is
 * accounted for by Logistics/Sales. QC pass lands a job on `completed`; the
 * three hand-off states ahead of it are reached by the Stylist Studio's own
 * lifecycle moves (000068) and are equally "done" from the order's side.
 */
const JOB_DONE = Object.freeze([
  "qc_passed",
  "ready_for_dispatch",
  "handed_to_sales",
  "completed",
]);

/** Studio work that will never be delivered — closed out, so it can't block. */
const JOB_VOID = Object.freeze(["cancelled", "rejected"]);

/** Neither done nor void: the wig is still somewhere in the Studio. */
const JOB_SETTLED = Object.freeze([...JOB_DONE, ...JOB_VOID]);

/**
 * SQL tuple forms for inline `status IN (...)` predicates, following the same
 * pattern as REVENUE_STATES_SQL in order-status.js. Built from the frozen
 * literals above — never from caller input — so there is nothing to inject.
 */
const sqlTuple = (states) => `(${states.map((s) => `'${s}'`).join(",")})`;
const JOB_DONE_SQL = sqlTuple(JOB_DONE);
const JOB_SETTLED_SQL = sqlTuple(JOB_SETTLED);

/**
 * Studio progress for one order: how many hairs are still outstanding, out of
 * how many were opened.
 *
 * Runs on the caller's transaction client when given one, so a QC pass can ask
 * "including the job I just completed, is anything left?" and see its own
 * uncommitted write. That is the whole reason the gate is correct under
 * concurrency: two stylists passing QC in parallel each hold a row lock on
 * their own job, and whichever transaction commits second sees the other's
 * `completed` and releases the order exactly once.
 */
async function studioProgress({ client = null, brand, order_id }) {
  if (!order_id) return { total: 0, outstanding: 0, done: 0, ready: false };
  const { rows } = await ex(client)(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status <> ALL($2::text[]))::int AS outstanding,
            count(*) FILTER (WHERE status = ANY($3::text[]))::int AS done
       FROM ${t(brand, "service_jobs")}
      WHERE sales_order_id = $1`,
    [order_id, JOB_SETTLED, JOB_DONE],
  );
  const r = rows[0] || { total: 0, outstanding: 0, done: 0 };
  return {
    total: r.total,
    outstanding: r.outstanding,
    done: r.done,
    ready: r.total > 0 && r.outstanding === 0,
  };
}

/**
 * The gate itself: may this order's "ready" effects fire now?
 *
 * `false` for an order whose studio work is unfinished AND for an order with no
 * studio jobs at all — callers that need the second case to pass (a plain
 * product sale) should be reading `studioProgress().total` and deciding for
 * themselves, which is exactly what the QC path does: it only ever asks this
 * question about an order that demonstrably has jobs, because it is being
 * called from one of them.
 */
async function allStudioJobsDone({ client = null, brand, order_id }) {
  const { ready } = await studioProgress({ client, brand, order_id });
  return ready;
}

/** "2 of 3 items ready" — one place that phrases it, for UI and audit alike. */
function progressLabel({ total, done }) {
  if (!total) return null;
  return `${done} of ${total} items ready`;
}

module.exports = {
  JOB_DONE,
  JOB_VOID,
  JOB_SETTLED,
  JOB_DONE_SQL,
  JOB_SETTLED_SQL,
  studioProgress,
  allStudioJobsDone,
  progressLabel,
};
