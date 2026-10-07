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
 *
 * TWO DIFFERENT MONEY QUESTIONS — do not mix them
 * ────────────────────────────────────────────────
 * 1. "What did we SELL?" (gross order value) is a lifecycle question and uses
 *    REVENUE_STATES over `sales_orders.total_ngn`. Label it ORDER VALUE, never
 *    revenue: an order's total is what the customer agreed to pay, not money
 *    the business received, and a part-paid order advances through
 *    assigned/order_ready/dispatched/completed with a balance still open.
 * 2. "What did we COLLECT?" (cash in) is NOT a lifecycle question at all. It is
 *    the sum of the captured/authorised rows in `sales_order_payments` whose
 *    money landed in the window — see dashboards.repo.salesKpis
 *    (`cash_collected_mtd`). No status list can answer it, because the payment
 *    rows are the source of truth that `amount_paid_ngn` is itself recomputed
 *    from (fn_sales_order_recompute_paid).
 * 3. "Who still OWES us?" is a money question too — `balance_due_ngn > 0` on an
 *    order that is not in COLLECTION_EXCLUDED_STATES (below).
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

// SQL tuple form for inline `status IN (...)` predicates in repos. Derived from
// the arrays above so a list and its SQL form can never drift apart. The values
// are module-owned literals (never user input), which is what makes the
// interpolation safe — the same rule `t(brand, table)` applies to schema names.
const sqlTuple = (states) => `(${states.map((s) => `'${s}'`).join(",")})`;

const REVENUE_STATES_SQL = sqlTuple(REVENUE_STATES);

// ── Payment-row statuses that ARE money in ─────────────────
// `sales_order_payments.status` is its own lifecycle (pending → authorised →
// captured, plus failed / refunded / partially_refunded / disputed). These two
// are the statuses the DB trigger `fn_sales_order_recompute_paid` sums into
// `sales_orders.amount_paid_ngn` (migration 000393), so they are the ONLY set
// that reconciles with what an order shows as paid — and therefore the set any
// "cash collected" figure must use. A pending or failed row never arrived; a
// refunded row went back.
const SETTLED_PAYMENT_STATUSES = ["captured", "authorised"];
const SETTLED_PAYMENT_STATUSES_SQL = sqlTuple(SETTLED_PAYMENT_STATUSES);

// ── Collections ────────────────────────────────────────────
// "Which active customers owe us money?" is a MONEY question (balance_due_ngn),
// and these are the lifecycle states that are not live collection work: a draft
// was never placed, a cancellation/refund/failure flow has stopped the order,
// and a cancelled order's balance is history — it stays on the row (never
// zeroed) but it is not a receivable, so it must not sit in the collection
// queue. Every collections query (Sales → Orders → Outstanding Balance /
// Partially Paid, the collections summary, the sales report export) excludes
// exactly this set — import it rather than re-typing the list.
const COLLECTION_EXCLUDED_STATES = SIDE_STATES;
const COLLECTION_EXCLUDED_STATES_SQL = sqlTuple(COLLECTION_EXCLUDED_STATES);

// Terminal states — no further automatic transitions.
const TERMINAL_STATES = ["completed", "cancelled", "refunded", "failed"];

module.exports = {
  ORDER_STATUSES,
  SIDE_STATES,
  REVENUE_STATES,
  REVENUE_STATES_SQL,
  SETTLED_PAYMENT_STATUSES,
  SETTLED_PAYMENT_STATUSES_SQL,
  COLLECTION_EXCLUDED_STATES,
  COLLECTION_EXCLUDED_STATES_SQL,
  TERMINAL_STATES,
};
