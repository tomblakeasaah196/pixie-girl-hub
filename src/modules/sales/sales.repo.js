/**
 * Sales (V2.2 §6.2) — repository.
 * sales_orders.amount_paid_ngn is recomputed by a TRIGGER from
 * sales_order_payments; status history is appended by a TRIGGER. We only
 * insert rows + flip status.
 */

"use strict";

const { query } = require("../../config/database");

const { VALID } = require("../../config/brands");
const t = (b, tbl) => {
  if (!VALID.has(b)) throw new Error(`Invalid brand: ${b}`);
  return `${b}.${tbl}`;
};
const ex = (c) => (c ? c.query.bind(c) : query);

const ORDER = [
  "order_number",
  "contact_id",
  "sales_channel",
  "order_type",
  "is_custom_order",
  "sales_campaign_id",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "status",
  "subtotal_ngn",
  "discount_amount_ngn",
  "tax_amount_ngn",
  "shipping_fee_ngn",
  "total_ngn",
  "coupon_code",
  "client_idempotency_key",
  "payment_model",
  "required_deposit_pct",
  "required_deposit_ngn",
];
const LINE = [
  "order_id",
  "product_id",
  "variant_id",
  "product_name_snapshot",
  "variant_label_snapshot",
  "sku_snapshot",
  "quantity",
  "unit_price_ngn",
  "unit_cost_ngn",
  "line_discount_ngn",
  "tax_rate",
  "tax_amount_ngn",
  "line_total_ngn",
  "display_order",
  "notes",
];
const DISC = [
  "order_id",
  "source",
  "source_reference",
  "sales_campaign_id",
  "applied_to_line_id",
  "amount_ngn",
  "discount_type",
];
const PAY = [
  "payment_number",
  "order_id",
  "method",
  "provider",
  "provider_reference",
  "amount_ngn",
  "paid_currency",
  "paid_amount",
  "fx_rate_used",
  "fee_ngn",
  "payment_path",
  "client_idempotency_key",
  "status",
  "captured_at",
];

function ins(cols, src, extra = {}) {
  const f = [],
    ph = [],
    p = [];
  let i = 1;
  for (const c of cols) {
    if (src[c] === undefined) continue;
    f.push(c);
    ph.push(`$${i++}`);
    p.push(src[c]);
  }
  for (const [c, v] of Object.entries(extra)) {
    f.push(c);
    ph.push(`$${i++}`);
    p.push(v);
  }
  return { f, ph, p };
}

async function nextNumber({ client, brand, type }) {
  const { rows } = await ex(client)(
    `SELECT ${t(brand, "fn_next_document_number")}($1) AS n`,
    [type],
  );
  return rows[0].n;
}

// Variant pricing/snapshot context for a line
async function variantContext({ client, brand, variant_id }) {
  const { rows } = await ex(client)(
    `SELECT pv.variant_id, pv.sku, pv.variant_name, pv.price_storefront_ngn, pv.price_pos_ngn,
            pv.price_wholesale_ngn, pv.price_partner_ngn, pv.cost_price_ngn, pv.min_price_ngn,
            p.product_id, p.name AS product_name, p.taxable, p.vat_rate AS product_vat
       FROM ${t(brand, "product_variants")} pv
       JOIN ${t(brand, "products")} p ON p.product_id = pv.product_id
      WHERE pv.variant_id = $1`,
    [variant_id],
  );
  return rows[0] || null;
}

async function createOrder({ client, brand, order }) {
  const { f, ph, p } = ins(ORDER, order);
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "sales_orders")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function insertLine({ client, brand, line }) {
  const { f, ph, p } = ins(LINE, line);
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "sales_order_lines")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function insertDiscount({ client, brand, disc }) {
  const { f, ph, p } = ins(DISC, disc);
  await ex(client)(
    `INSERT INTO ${t(brand, "sales_order_discounts")} (${f.join(",")}) VALUES (${ph.join(",")})`,
    p,
  );
}
async function findByIdempotencyKey({ client, brand, key }) {
  if (!key) return null;
  const { rows } = await ex(client)(
    `SELECT order_id FROM ${t(brand, "sales_orders")}
      WHERE client_idempotency_key = $1 LIMIT 1`,
    [key],
  );
  return rows[0] ? rows[0].order_id : null;
}
async function findById({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "sales_orders")} WHERE order_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { rows: lines } = await ex(client)(
    `SELECT * FROM ${t(brand, "sales_order_lines")} WHERE order_id = $1 ORDER BY display_order`,
    [id],
  );
  return { ...rows[0], lines };
}
async function listOrders({
  client,
  brand,
  filters = {},
  page = 1,
  page_size = 25,
  offset = 0,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (filters.status) {
    where.push(`status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.contact_id) {
    where.push(`contact_id = $${i++}`);
    params.push(filters.contact_id);
  }
  if (filters.sales_channel) {
    where.push(`sales_channel = $${i++}`);
    params.push(filters.sales_channel);
  }
  if (filters.sales_campaign_id) {
    where.push(`sales_campaign_id = $${i++}`);
    params.push(filters.sales_campaign_id);
  }
  if (filters.q) {
    where.push(`order_number ILIKE $${i++}`);
    params.push(`%${filters.q}%`);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "sales_orders")} ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "sales_orders")} ${w} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, page_size, offset],
  );
  return {
    data: rows,
    meta: {
      page,
      page_size,
      total: c[0].total,
      has_more: offset + rows.length < c[0].total,
    },
  };
}
async function setStatus({ client, brand, id, status }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "sales_orders")} SET status = $2 WHERE order_id = $1 RETURNING *`,
    [id, status],
  );
  return rows[0] || null;
}

/**
 * Deposit-triggered (V2.2 §6.2): stamp the moment accumulated payments first
 * crossed the required deposit and move the order into production.
 */
async function markDepositMet({ client, brand, id }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "sales_orders")}
        SET status = 'in_production', deposit_met_at = now()
      WHERE order_id = $1 AND deposit_met_at IS NULL
      RETURNING *`,
    [id],
  );
  return rows[0] || null;
}

/**
 * Layaway orders eligible for auto-cancel: payment_model='layaway', still
 * awaiting payment, no payment crossed the abandonment window.
 * `days` comes from business_config.installment_settings.
 */
async function listAbandonableLayaway({ brand, days }) {
  // "No payment for the window": measure from the latest payment if any,
  // otherwise from order creation.
  const { rows } = await query(
    `SELECT so.order_id, so.order_number, so.contact_id,
            so.total_ngn, so.amount_paid_ngn
       FROM ${t(brand, "sales_orders")} so
      WHERE so.payment_model = 'layaway'
        AND so.status = 'pending_payment'
        AND COALESCE(
              (SELECT max(p.captured_at)
                 FROM ${t(brand, "sales_order_payments")} p
                WHERE p.order_id = so.order_id),
              so.created_at
            ) < now() - ($1 || ' days')::interval`,
    [String(days)],
  );
  return rows;
}

/**
 * Layaway orders with an outstanding balance that are due a reminder:
 * never reminded, or last reminded longer ago than the cadence.
 */
async function listLayawayDueForReminder({ brand, cadenceDays }) {
  const { rows } = await query(
    `SELECT order_id, order_number, contact_id, total_ngn, amount_paid_ngn,
            balance_due_ngn, public_tracking_token
       FROM ${t(brand, "sales_orders")}
      WHERE payment_model = 'layaway'
        AND status = 'pending_payment'
        AND amount_paid_ngn < total_ngn
        AND (
          last_reminder_sent_at IS NULL
          OR last_reminder_sent_at < now() - ($1 || ' days')::interval
        )`,
    [String(cadenceDays)],
  );
  return rows;
}

async function markReminderSent({ brand, id }) {
  await query(
    `UPDATE ${t(brand, "sales_orders")}
        SET last_reminder_sent_at = now()
      WHERE order_id = $1`,
    [id],
  );
}
/**
 * Atomically CLAIM a layaway reminder send (H-6). Stamps last_reminder_sent_at
 * only if the order is still due (re-checking the cadence inside the UPDATE),
 * and RETURNs the row only to the winner. Concurrent sweep runs therefore send
 * at most one reminder per cadence window — closing the SELECT-then-UPDATE race.
 */
async function claimReminderSend({ brand, id, cadenceDays }) {
  const { rows } = await query(
    `UPDATE ${t(brand, "sales_orders")}
        SET last_reminder_sent_at = now()
      WHERE order_id = $1
        AND payment_model = 'layaway'
        AND status = 'pending_payment'
        AND amount_paid_ngn < total_ngn
        AND (
          last_reminder_sent_at IS NULL
          OR last_reminder_sent_at < now() - ($2 || ' days')::interval
        )
      RETURNING order_id`,
    [id, String(cadenceDays)],
  );
  return rows.length > 0;
}
const HEADER_COLS = [
  "order_type",
  "shipping_fee_ngn",
  "utm_source",
  "utm_medium",
  "utm_campaign",
];
async function updateOrderHeader({ client, brand, id, patch }) {
  const f = [],
    p = [];
  let i = 1;
  for (const c of HEADER_COLS) {
    if (patch[c] === undefined) continue;
    f.push(`${c} = $${i++}`);
    p.push(patch[c]);
  }
  if (!f.length) {
    const { rows } = await ex(client)(
      `SELECT * FROM ${t(brand, "sales_orders")} WHERE order_id = $1`,
      [id],
    );
    return rows[0] || null;
  }
  p.push(id);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "sales_orders")} SET ${f.join(",")} WHERE order_id = $${i} RETURNING *`,
    p,
  );
  return rows[0] || null;
}
async function listDiscounts({ client, brand, order_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "sales_order_discounts")} WHERE order_id = $1 ORDER BY applied_at`,
    [order_id],
  );
  return rows;
}
async function addPayment({ client, brand, payment }) {
  const { f, ph, p } = ins(PAY, payment);
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "sales_order_payments")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function listPayments({ client, brand, order_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "sales_order_payments")} WHERE order_id = $1 ORDER BY created_at`,
    [order_id],
  );
  return rows;
}
/**
 * Idempotency check (H-4): has a gateway payment with this provider_reference
 * already been recorded on this order? Used by the webhook confirm handler so a
 * re-delivered charge.success never double-records the payment.
 */
async function paymentExistsByProviderRef({
  client,
  brand,
  order_id,
  provider_reference,
}) {
  if (!provider_reference) return false;
  const { rows } = await ex(client)(
    `SELECT 1 FROM ${t(brand, "sales_order_payments")}
      WHERE order_id = $1 AND provider_reference = $2 LIMIT 1`,
    [order_id, provider_reference],
  );
  return rows.length > 0;
}

// ── Quotations (+ lines) ─────────────────────────────────
const QUOTE_COLS = [
  "quotation_number",
  "deal_id",
  "contact_id",
  "status",
  "subtotal_ngn",
  "discount_amount_ngn",
  "tax_amount_ngn",
  "shipping_fee_ngn",
  "total_ngn",
  "valid_until",
  "payment_terms",
  "notes",
  "internal_notes",
  "delivery_type",
  "coupon_code",
];
const QLINE_COLS = [
  "quotation_id",
  "product_id",
  "variant_id",
  "product_name_snapshot",
  "variant_label_snapshot",
  "sku_snapshot",
  "quantity",
  "unit_price_ngn",
  "line_discount_ngn",
  "tax_rate",
  "line_total_ngn",
  "display_order",
  "notes",
];
async function createQuotation({ client, brand, quote, user_id }) {
  const { f, ph, p } = ins(QUOTE_COLS, quote, { created_by: user_id });
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "quotations")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function insertQuotationLine({ client, brand, line }) {
  const { f, ph, p } = ins(QLINE_COLS, line);
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "quotation_lines")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function findQuotationById({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "quotations")} WHERE quotation_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { rows: lines } = await ex(client)(
    `SELECT * FROM ${t(brand, "quotation_lines")} WHERE quotation_id = $1 ORDER BY display_order`,
    [id],
  );
  return { ...rows[0], lines };
}
async function listQuotations({
  client,
  brand,
  filters = {},
  page = 1,
  page_size = 25,
  offset = 0,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (filters.status) {
    where.push(`status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.contact_id) {
    where.push(`contact_id = $${i++}`);
    params.push(filters.contact_id);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "quotations")} ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "quotations")} ${w} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, page_size, offset],
  );
  return {
    data: rows,
    meta: {
      page,
      page_size,
      total: c[0].total,
      has_more: offset + rows.length < c[0].total,
    },
  };
}
async function setQuotationStatus({ client, brand, id, status, extra = {} }) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "quotations")} SET ${sets.join(", ")} WHERE quotation_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── Cancellation requests ────────────────────────────────
async function createCancellation({ client, brand, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "cancellation_requests")}
       (request_number, order_id, requested_by_contact_id, requested_by_user_id, reason, reason_category,
        within_free_window, order_total_ngn, is_custom_order, applicable_fee_pct, fee_amount_ngn, refund_amount_ngn)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      row.request_number,
      row.order_id,
      row.requested_by_contact_id || null,
      row.requested_by_user_id || null,
      row.reason,
      row.reason_category || null,
      row.within_free_window,
      row.order_total_ngn,
      row.is_custom_order,
      row.applicable_fee_pct,
      row.fee_amount_ngn,
      row.refund_amount_ngn,
    ],
  );
  return rows[0];
}
async function findCancellationById({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "cancellation_requests")} WHERE request_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function listCancellations({
  client,
  brand,
  filters = {},
  page = 1,
  page_size = 25,
  offset = 0,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (filters.status) {
    where.push(`status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.order_id) {
    where.push(`order_id = $${i++}`);
    params.push(filters.order_id);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "cancellation_requests")} ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "cancellation_requests")} ${w} ORDER BY requested_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, page_size, offset],
  );
  return {
    data: rows,
    meta: {
      page,
      page_size,
      total: c[0].total,
      has_more: offset + rows.length < c[0].total,
    },
  };
}
async function setCancellationStatus({
  client,
  brand,
  id,
  status,
  reviewer,
  notes,
}) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "cancellation_requests")}
        SET status = $2, reviewed_by = $3, reviewed_at = now(), review_notes = $4,
            refund_executed_at = CASE WHEN $2 = 'refunded' THEN now() ELSE refund_executed_at END
      WHERE request_id = $1 RETURNING *`,
    [id, status, reviewer || null, notes || null],
  );
  return rows[0] || null;
}

module.exports = {
  updateOrderHeader,
  listDiscounts,
  nextNumber,
  variantContext,
  createOrder,
  findByIdempotencyKey,
  insertLine,
  insertDiscount,
  findById,
  listOrders,
  setStatus,
  markDepositMet,
  listAbandonableLayaway,
  listLayawayDueForReminder,
  markReminderSent,
  addPayment,
  listPayments,
  paymentExistsByProviderRef,
  claimReminderSend,
  createQuotation,
  insertQuotationLine,
  findQuotationById,
  listQuotations,
  setQuotationStatus,
  createCancellation,
  findCancellationById,
  listCancellations,
  setCancellationStatus,
};
