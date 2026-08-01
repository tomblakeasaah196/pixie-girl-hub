/**
 * Sales-order lifecycle — the single source of truth for order status.
 *
 * The order walks a 7-state happy path (styling business, no manufacturing):
 *
 *   pending_payment → partially_paid → paid → assigned
 *     → order_ready → dispatched → completed
 *
 * plus the cancellation / refund side-states. Not every order visits every
 * state — a ready-made product skips `assigned`, a walk-in skips `dispatched`.
 * Transitions are driven automatically (payment, stylist assignment, QC pass,
 * delivery events) and can always be overridden manually from the order drawer.
 *
 * Anything that needs "which statuses mean the money has actually landed"
 * (revenue rollups, coupon eligibility, CRM lifetime value, VIP tiers) must
 * import REVENUE_STATES / REVENUE_STATES_SQL from here rather than re-hardcode
 * the list — that drift is exactly what left the old fulfilment states
 * uncounted. `partially_paid` is deliberately excluded: a deposit is cash held
 * as a liability, not earned revenue, so it never inflates the sales figures.
 */

"use strict";

// Canonical happy-path order (used for UI ordering + "can this move forward").
const ORDER_STATUSES = [
  "pending_payment",
  "partially_paid",
  "paid",
  "assigned",
  "order_ready",
  "dispatched",
  "completed",
];

// Side-states outside the linear flow.
const SIDE_STATES = ["draft", "cancellation_requested", "cancelled", "refunded", "failed"];

// Fully-settled states — an order can only reach any of these once it was paid
// in full, so all of them count toward revenue. `partially_paid` is NOT here.
const REVENUE_STATES = ["paid", "assigned", "order_ready", "dispatched", "completed"];

// SQL tuple form for inline `status IN (...)` predicates in repos.
const REVENUE_STATES_SQL = `('paid','assigned','order_ready','dispatched','completed')`;

// Terminal states — no further automatic transitions.
const TERMINAL_STATES = ["completed", "cancelled", "refunded", "failed"];

module.exports = {
  ORDER_STATUSES,
  SIDE_STATES,
  REVENUE_STATES,
  REVENUE_STATES_SQL,
  TERMINAL_STATES,
};
