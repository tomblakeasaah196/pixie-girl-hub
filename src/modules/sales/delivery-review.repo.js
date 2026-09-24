/**
 * Delivery-fee review (PR 3, Care & Accessories) — repository.
 *
 * Persistence for the manual delivery-fee lifecycle on a retail-containing
 * online order: `{{brand}}.delivery_fee_reviews` (one open row per order, the
 * lifecycle) + `{{brand}}.delivery_fee_review_events` (the step-by-step audit
 * trail), plus the durable `sales_orders.needs_delivery_review` flag that the
 * dispatch-block trigger reads.
 *
 * WHY NOT THE EXISTING `fee_pending` MARKER
 *   `sales.repo.setDeliveryFee` writes `shipping_fee_ngn`/`total_ngn` and
 *   clears a `"fee_pending":true` token buried in `sales_orders.internal_notes`
 *   — a TEXT column holding JSON, read back by the order list with
 *   `internal_notes LIKE '%"fee_pending":true%'`. That is a display filter, not
 *   a state machine: it cannot say "a fee was proposed but the customer has not
 *   accepted it", it is written by exactly one caller, and any code that
 *   rewrites internal_notes silently drops an order out of the queue. The
 *   durable column + review table here are the real state; the text marker is
 *   left alone so the existing Delivery Pending view keeps working unchanged.
 *
 * Parameterised SQL only; callers own transactions.
 */

"use strict";

const { ex } = require("../../config/database");
const { t } = require("../../config/brands");

// Statuses that still hold the order in the queue (and keep the dispatch block
// raised). Anything outside this set is settled history.
const OPEN_STATUSES = [
  "pending_review",
  "awaiting_customer",
];
const SETTLED_STATUSES = [
  "accepted",
  "declined",
  "credited",
  "confirmed",
  "cancelled",
];

/** The order's currently open review, or null. */
async function findOpenByOrder({ client, brand, order_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "delivery_fee_reviews")}
      WHERE order_id = $1::uuid
        AND status::text = ANY($2::text[])
      ORDER BY created_at DESC
      LIMIT 1`,
    [order_id, OPEN_STATUSES],
  );
  return rows[0] || null;
}

/** Every review on an order, newest first (settled ones are history). */
async function listByOrder({ client, brand, order_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "delivery_fee_reviews")}
      WHERE order_id = $1::uuid
      ORDER BY created_at DESC`,
    [order_id],
  );
  return rows;
}

async function getById({ client, brand, review_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "delivery_fee_reviews")} WHERE review_id = $1::uuid`,
    [review_id],
  );
  return rows[0] || null;
}

async function insertReview({ client, brand, review }) {
  const { rows } = await ex(client)(
    // Explicit casts on the money parameters are load-bearing, not decoration:
    // with an untyped placeholder, `COALESCE($4, 0)` resolves the pair to
    // INTEGER (the literal's type) before the INSERT ever coerces to the
    // numeric column, so a fee of "0.00" is rejected with 22P02. Casting at the
    // parameter removes the ambiguity for both PostgreSQL and PGlite.
    `INSERT INTO ${t(brand, "delivery_fee_reviews")}
       (order_id, business, status, initial_fee_ngn, calculation_basis, opened_by)
     VALUES ($1::uuid, $2::text,
             COALESCE($3::text, 'pending_review'),
             COALESCE($4::numeric(14,2), 0::numeric(14,2)),
             NULLIF($5::text, ''),
             NULLIF($6::text, '')::uuid)
     RETURNING *`,
    [
      review.order_id,
      brand,
      review.status || null,
      review.initial_fee_ngn ?? 0,
      review.calculation_basis || null,
      review.opened_by || null,
    ],
  );
  return rows[0];
}

/**
 * Patch a review row. Only the columns named in PATCHABLE may be written, so a
 * caller can never smuggle `status` past the service's lifecycle checks by
 * passing an unexpected key.
 */
const PATCHABLE = new Set([
  "status",
  "proposed_fee_ngn",
  "agreed_fee_ngn",
  "difference_ngn",
  "direction",
  "calculation_basis",
  "customer_consent_at",
  "customer_consent_channel",
  "customer_consent_reference",
  "customer_declined_at",
  "topup_payment_id",
  "refund_payment_id",
  "topup_verified_at",
  "refund_verified_at",
  "invoice_synced_at",
  "payment_link_synced_at",
  "ledger_posted_at",
  "customer_notified_at",
  "settled_at",
  "settled_by",
]);

// Column → SQL cast for the patchable set. Enum and boolean columns need an
// explicit cast: with a bare placeholder PostgreSQL resolves the parameter from
// the assignment target, but PGlite (and any driver that sends text) can infer
// the wrong type and reject a value that is perfectly legal on the real server.
const PATCH_CAST = {
  status: "text",
  direction: "text",
  calculation_basis: "text",
  proposed_fee_ngn: "numeric(14,2)",
  agreed_fee_ngn: "numeric(14,2)",
  difference_ngn: "numeric(14,2)",
  customer_consent_at: "timestamptz",
  customer_consent_channel: "text",
  customer_consent_reference: "text",
  customer_declined_at: "timestamptz",
  topup_payment_id: "uuid",
  refund_payment_id: "uuid",
  topup_verified_at: "timestamptz",
  refund_verified_at: "timestamptz",
  invoice_synced_at: "timestamptz",
  payment_link_synced_at: "timestamptz",
  ledger_posted_at: "timestamptz",
  customer_notified_at: "timestamptz",
  settled_at: "timestamptz",
  settled_by: "uuid",
};

async function updateReview({ client, brand, review_id, patch }) {
  const keys = Object.keys(patch || {}).filter((k) => PATCHABLE.has(k));
  if (!keys.length) return getById({ client, brand, review_id });
  const sets = [];
  const params = [review_id];
  let i = 2;
  for (const k of keys) {
    const cast = PATCH_CAST[k];
    sets.push(cast ? `${k} = $${i++}::${cast}` : `${k} = $${i++}`);
    params.push(patch[k]);
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "delivery_fee_reviews")}
        SET ${sets.join(", ")}, updated_at = now()
      WHERE review_id = $1::uuid
      RETURNING *`,
    params,
  );
  return rows[0] || null;
}

/** Append one step to the review's audit trail. */
async function addEvent({ client, brand, event }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "delivery_fee_review_events")}
       (review_id, order_id, event_type, from_status, to_status,
        amount_ngn, note, actor_user_id, actor_name)
     VALUES ($1::uuid, $2::uuid, $3::text,
             NULLIF($4::text, ''), NULLIF($5::text, ''),
             $6::numeric(14,2), NULLIF($7::text, ''),
             NULLIF($8::text, '')::uuid, NULLIF($9::text, ''))
     RETURNING *`,
    [
      event.review_id,
      event.order_id,
      event.event_type,
      event.from_status || null,
      event.to_status || null,
      event.amount_ngn ?? null,
      event.note || null,
      event.actor_user_id || null,
      event.actor_name || null,
    ],
  );
  return rows[0];
}

async function listEvents({ client, brand, review_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "delivery_fee_review_events")}
      WHERE review_id = $1::uuid
      ORDER BY created_at ASC`,
    [review_id],
  );
  return rows;
}

/**
 * The staff queue: orders whose delivery fee a human still has to price.
 *
 * Driven by the durable `needs_delivery_review` flag joined to the open review
 * row — never by the `internal_notes` LIKE filter. Restricted to orders that
 * actually contain a retail line, so a wig-only or FLH order can never appear
 * here even if something else managed to raise the flag.
 */
async function listQueue({ client, brand, status, page = 1, page_size = 25 }) {
  const params = [];
  let i = 1;
  const where = [`so.needs_delivery_review = true`];
  if (status && status !== "all") {
    where.push(`r.status::text = $${i++}::text`);
    params.push(status);
  } else {
    where.push(`r.status::text = ANY($${i++}::text[])`);
    params.push(OPEN_STATUSES);
  }
  const offset = Math.max(0, (Number(page) - 1) * Number(page_size));
  const { rows } = await ex(client)(
    `SELECT r.review_id, r.order_id, r.status, r.initial_fee_ngn,
            r.proposed_fee_ngn, r.agreed_fee_ngn, r.difference_ngn, r.direction,
            r.customer_consent_at, r.customer_consent_channel,
            r.settled_at, r.created_at,
            so.order_number, so.status AS order_status, so.order_type,
            so.sales_channel, so.subtotal_ngn, so.shipping_fee_ngn,
            so.total_ngn, so.amount_paid_ngn, so.balance_due_ngn,
            so.delivery_address_snapshot,
            c.display_name AS customer_name, c.primary_phone AS customer_phone,
            c.email AS customer_email,
            (SELECT count(*)::int FROM ${t(brand, "sales_order_lines")} l
              WHERE l.order_id = so.order_id
                AND l.variant_id IN (
                  SELECT pv.variant_id FROM ${t(brand, "product_variants")} pv
                    JOIN ${t(brand, "products")} p ON p.product_id = pv.product_id
                   WHERE p.catalogue_role = 'retail')) AS retail_line_count,
            (SELECT jsonb_agg(jsonb_build_object(
                       'name', l.product_name_snapshot,
                       'variant', l.variant_label_snapshot,
                       'sku', l.sku_snapshot,
                       'qty', l.quantity) ORDER BY l.display_order)
               FROM ${t(brand, "sales_order_lines")} l
              WHERE l.order_id = so.order_id) AS lines
       FROM ${t(brand, "sales_orders")} so
       JOIN ${t(brand, "delivery_fee_reviews")} r ON r.order_id = so.order_id
       LEFT JOIN shared.contacts c ON c.contact_id = so.contact_id
      WHERE ${where.join(" AND ")}
      ORDER BY r.created_at ASC
      LIMIT $${i++}::int OFFSET $${i++}::int`,
    [...params, Number(page_size), offset],
  );
  const { rows: c } = await ex(client)(
    `SELECT count(*)::int AS total
       FROM ${t(brand, "sales_orders")} so
       JOIN ${t(brand, "delivery_fee_reviews")} r ON r.order_id = so.order_id
      WHERE ${where.join(" AND ")}`,
    params,
  );
  return { data: rows, meta: { page: Number(page), page_size: Number(page_size), total: c[0] ? c[0].total : 0 } };
}

/** Raise or clear the durable flag directly (the review trigger also maintains
 *  it; this is for the paths that open a review outside an INSERT). */
async function setOrderReviewFlag({ client, brand, order_id, needs }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "sales_orders")}
        SET needs_delivery_review = $2::boolean,
            delivery_review_settled_at = CASE WHEN $2::boolean THEN NULL ELSE now() END,
            updated_at = now()
      WHERE order_id = $1::uuid
      RETURNING order_id, needs_delivery_review, delivery_review_settled_at`,
    [order_id, needs === true],
  );
  return rows[0] || null;
}

module.exports = {
  OPEN_STATUSES,
  SETTLED_STATUSES,
  findOpenByOrder,
  listByOrder,
  getById,
  insertReview,
  updateReview,
  addEvent,
  listEvents,
  listQueue,
  setOrderReviewFlag,
};
