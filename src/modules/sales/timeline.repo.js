/**
 * Order timeline repository (F-5 / PD §6.23.6). Operates on the shared
 * order_timeline_events + timeline_event_codes tables. sales_order_id is a soft
 * FK into the brand schema.
 */

"use strict";

const { query } = require("../../config/database");

const ex = (c) => (c ? c.query.bind(c) : query);

async function getCode(code) {
  const { rows } = await query(
    `SELECT * FROM shared.timeline_event_codes WHERE code = $1 AND is_active = true`,
    [code],
  );
  return rows[0] || null;
}

async function exists({ client, brand, sales_order_id, event_code }) {
  const { rows } = await ex(client)(
    `SELECT 1 FROM shared.order_timeline_events
      WHERE business = $1 AND sales_order_id = $2 AND event_code = $3 LIMIT 1`,
    [brand, sales_order_id, event_code],
  );
  return rows.length > 0;
}

async function insert({ client, brand, event }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.order_timeline_events
       (business, sales_order_id, event_code, label, source_module,
        customer_payload, internal_payload, is_customer_visible, recorded_by, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10, now()))
     RETURNING *`,
    [
      brand,
      event.sales_order_id,
      event.event_code,
      event.label,
      event.source_module,
      event.customer_payload ? JSON.stringify(event.customer_payload) : null,
      event.internal_payload ? JSON.stringify(event.internal_payload) : null,
      event.is_customer_visible,
      event.recorded_by || null,
      event.occurred_at || null,
    ],
  );
  return rows[0];
}

async function listForOrder({ brand, sales_order_id, customer_only }) {
  const where = ["business = $1", "sales_order_id = $2"];
  if (customer_only) where.push("is_customer_visible = true");
  const cols = customer_only
    ? "event_id, event_code, label, customer_payload, occurred_at"
    : "*";
  const { rows } = await query(
    `SELECT ${cols} FROM shared.order_timeline_events
      WHERE ${where.join(" AND ")} ORDER BY occurred_at ASC, recorded_at ASC`,
    [brand, sales_order_id],
  );
  return rows;
}

module.exports = { getCode, exists, insert, listForOrder };
