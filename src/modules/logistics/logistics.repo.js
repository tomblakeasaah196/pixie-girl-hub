/**
 * Logistics & Delivery (V2.2 §6.10) — repository.
 * Per-brand tables: couriers, deliveries, delivery_items, delivery_attempts,
 * delivery_state_history, delivery_proofs, courier_webhook_events,
 * pay_on_delivery_collections. Numbers via fn_next_document_number().
 * Fulfillment tracking only — stock movements happen on the order spine.
 */

"use strict";

const { query } = require("../../config/database");

const { t } = require("../../config/brands");
const ex = (client) => (client ? client.query.bind(client) : query);

function buildUpdate(cols, src, start = 1) {
  const f = [];
  const p = [];
  let i = start;
  for (const col of cols) {
    if (src[col] === undefined) continue;
    f.push(`${col} = $${i++}`);
    p.push(src[col]);
  }
  return { f, p, next: i };
}
async function nextNumber({ client, brand, type }) {
  const { rows } = await ex(client)(
    `SELECT ${t(brand, "fn_next_document_number")}($1) AS num`,
    [type],
  );
  return rows[0].num;
}

// ── couriers ─────────────────────────────────────────────
const COURIER_COLS = [
  "display_name",
  "description",
  "integration_type",
  "api_endpoint",
  "webhook_secret",
  "serves_local",
  "serves_nationwide",
  "serves_international",
  "service_countries",
  "rate_card",
  "supports_pod",
  "pod_fee_pct",
  "default_packaging",
  "is_active",
  "display_order",
];
const COURIER_JSONB = new Set(["rate_card"]);
async function createCourier({ client, brand, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "couriers")}
       (courier_key, display_name, description, integration_type, api_endpoint, webhook_secret,
        serves_local, serves_nationwide, serves_international, service_countries, rate_card,
        supports_pod, pod_fee_pct, default_packaging, display_order)
     VALUES ($1,$2,$3,COALESCE($4,'manual'),$5,$6,COALESCE($7,true),COALESCE($8,false),COALESCE($9,false),
             COALESCE($10,'{NG}'),COALESCE($11,'{}')::jsonb,COALESCE($12,false),$13,$14,COALESCE($15,0)) RETURNING *`,
    [
      row.courier_key,
      row.display_name,
      row.description || null,
      row.integration_type,
      row.api_endpoint || null,
      row.webhook_secret || null,
      row.serves_local,
      row.serves_nationwide,
      row.serves_international,
      row.service_countries || null,
      row.rate_card ? JSON.stringify(row.rate_card) : null,
      row.supports_pod,
      row.pod_fee_pct ?? null,
      row.default_packaging || null,
      row.display_order ?? null,
    ],
  );
  return rows[0];
}
async function getCourier({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "couriers")} WHERE courier_id = $1`,
    [id],
  );
  return rows[0] || null;
}
/** First active courier — used as the default for auto-created deliveries. */
async function getDefaultCourier({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "couriers")} WHERE is_active = true
      ORDER BY display_order, display_name LIMIT 1`,
  );
  return rows[0] || null;
}
/** Idempotency: is there already a delivery for this order? */
async function findDeliveryByOrder({ client, brand, order_id }) {
  const { rows } = await ex(client)(
    `SELECT delivery_id FROM ${t(brand, "deliveries")} WHERE order_id = $1 LIMIT 1`,
    [order_id],
  );
  return rows[0] || null;
}
async function listCouriers({ client, brand, is_active }) {
  const where = [];
  const params = [];
  let i = 1;
  if (is_active !== undefined) {
    where.push(`is_active = $${i++}`);
    params.push(is_active);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "couriers")} ${w} ORDER BY display_order, display_name`,
    params,
  );
  return rows;
}
async function updateCourier({ client, brand, id, patch }) {
  const f = [];
  const p = [];
  let i = 1;
  for (const col of COURIER_COLS) {
    if (patch[col] === undefined) continue;
    if (COURIER_JSONB.has(col)) {
      f.push(`${col} = $${i++}::jsonb`);
      p.push(JSON.stringify(patch[col]));
    } else {
      f.push(`${col} = $${i++}`);
      p.push(patch[col]);
    }
  }
  if (f.length === 0) return getCourier({ client, brand, id });
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "couriers")} SET ${f.join(", ")} WHERE courier_id = $${i} RETURNING *`,
    [...p, id],
  );
  return rows[0] || null;
}

// ── deliveries ───────────────────────────────────────────
async function createDelivery({ client, brand, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "deliveries")}
       (delivery_number, order_id, delivery_type, reference_type, reference_id, courier_id, courier_tracking_ref, courier_tracking_url,
        from_location_id, recipient_contact_id, recipient_name_snapshot, recipient_phone_snapshot, recipient_whatsapp_snapshot,
        delivery_address_snapshot, delivery_instructions, courier_fee_ngn, is_pay_on_delivery, pod_amount_expected_ngn,
        weight_g, package_count, declared_value_ngn, public_tracking_token, created_by)
     VALUES ($1,$2,COALESCE($3,'sales_order'),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,COALESCE($16,0),COALESCE($17,false),$18,$19,COALESCE($20,1),$21,$22,$23)
     RETURNING *`,
    [
      row.delivery_number,
      row.order_id || null,
      row.delivery_type,
      row.reference_type || null,
      row.reference_id || null,
      row.courier_id,
      row.courier_tracking_ref || null,
      row.courier_tracking_url || null,
      row.from_location_id || null,
      row.recipient_contact_id || null,
      row.recipient_name_snapshot || null,
      row.recipient_phone_snapshot || null,
      row.recipient_whatsapp_snapshot || null,
      JSON.stringify(row.delivery_address_snapshot || {}),
      row.delivery_instructions || null,
      row.courier_fee_ngn,
      row.is_pay_on_delivery,
      row.pod_amount_expected_ngn ?? null,
      row.weight_g ?? null,
      row.package_count,
      row.declared_value_ngn ?? null,
      row.public_tracking_token || null,
      row.created_by || null,
    ],
  );
  return rows[0];
}
async function addDeliveryItem({ client, brand, item }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "delivery_items")} (delivery_id, source_type, source_id, variant_id, description, quantity, weight_g, stock_movement_id, display_order, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,0),$10) RETURNING *`,
    [
      item.delivery_id,
      item.source_type || null,
      item.source_id || null,
      item.variant_id || null,
      item.description,
      item.quantity,
      item.weight_g ?? null,
      item.stock_movement_id || null,
      item.display_order,
      item.notes || null,
    ],
  );
  return rows[0];
}
async function getDelivery({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "deliveries")} WHERE delivery_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { rows: items } = await ex(client)(
    `SELECT * FROM ${t(brand, "delivery_items")} WHERE delivery_id = $1 ORDER BY display_order`,
    [id],
  );
  const { rows: attempts } = await ex(client)(
    `SELECT * FROM ${t(brand, "delivery_attempts")} WHERE delivery_id = $1 ORDER BY attempt_number`,
    [id],
  );
  const { rows: history } = await ex(client)(
    `SELECT * FROM ${t(brand, "delivery_state_history")} WHERE delivery_id = $1 ORDER BY changed_at`,
    [id],
  );
  const { rows: proofs } = await ex(client)(
    `SELECT * FROM ${t(brand, "delivery_proofs")} WHERE delivery_id = $1 ORDER BY confirmed_at`,
    [id],
  );
  return { ...rows[0], items, attempts, history, proofs };
}
async function getDeliveryByToken({ client, brand, token }) {
  const { rows } = await ex(client)(
    `SELECT delivery_id, delivery_number, status, courier_id, courier_tracking_ref, courier_tracking_url,
            expected_delivery_at, delivered_at, recipient_name_snapshot
       FROM ${t(brand, "deliveries")} WHERE public_tracking_token = $1`,
    [token],
  );
  if (!rows[0]) return null;
  const { rows: history } = await ex(client)(
    `SELECT to_status, changed_at, notes FROM ${t(brand, "delivery_state_history")} WHERE delivery_id = $1 ORDER BY changed_at`,
    [rows[0].delivery_id],
  );
  return { ...rows[0], history };
}
async function listDeliveries({
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
  if (filters.courier_id) {
    where.push(`courier_id = $${i++}`);
    params.push(filters.courier_id);
  }
  if (filters.order_id) {
    where.push(`order_id = $${i++}`);
    params.push(filters.order_id);
  }
  if (filters.is_pay_on_delivery !== undefined) {
    where.push(`is_pay_on_delivery = $${i++}`);
    params.push(filters.is_pay_on_delivery);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "deliveries")} ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "deliveries")} ${w} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
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
async function setDeliveryStatus({ client, brand, id, status, extra = {} }) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "deliveries")} SET ${sets.join(", ")} WHERE delivery_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}
async function updateDelivery({ client, brand, id, patch }) {
  const cols = [
    "courier_tracking_ref",
    "courier_tracking_url",
    "expected_delivery_at",
    "delivery_instructions",
    "courier_fee_ngn",
    "weight_g",
    "package_count",
    "notes",
  ];
  const { f, p, next } = buildUpdate(cols, patch);
  if (f.length === 0) return getDelivery({ client, brand, id });
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "deliveries")} SET ${f.join(", ")} WHERE delivery_id = $${next} RETURNING *`,
    [...p, id],
  );
  return rows[0] || null;
}
async function incrementAttemptCount({ client, brand, id }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "deliveries")} SET attempt_count = attempt_count + 1 WHERE delivery_id = $1 RETURNING attempt_count`,
    [id],
  );
  return rows[0] ? rows[0].attempt_count : null;
}
async function addStateHistory({ client, brand, h }) {
  await ex(client)(
    `INSERT INTO ${t(brand, "delivery_state_history")} (delivery_id, from_status, to_status, changed_by_source, changed_by, webhook_event_id, notes)
     VALUES ($1,$2,$3,COALESCE($4,'user'),$5,$6,$7)`,
    [
      h.delivery_id,
      h.from_status || null,
      h.to_status,
      h.changed_by_source,
      h.changed_by || null,
      h.webhook_event_id || null,
      h.notes || null,
    ],
  );
}

// ── attempts + proofs ────────────────────────────────────
async function addAttempt({ client, brand, attempt }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "delivery_attempts")}
       (delivery_id, attempt_number, attempted_at, outcome, outcome_notes, rider_name, rider_phone, reported_lat, reported_lng, webhook_event_id, recorded_by)
     VALUES ($1,$2,COALESCE($3, now()),$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      attempt.delivery_id,
      attempt.attempt_number,
      attempt.attempted_at || null,
      attempt.outcome,
      attempt.outcome_notes || null,
      attempt.rider_name || null,
      attempt.rider_phone || null,
      attempt.reported_lat ?? null,
      attempt.reported_lng ?? null,
      attempt.webhook_event_id || null,
      attempt.recorded_by || null,
    ],
  );
  return rows[0];
}
async function addProof({ client, brand, proof }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "delivery_proofs")}
       (delivery_id, delivery_attempt_id, proof_type, document_id, recipient_name, recipient_id_type, recipient_id_last4, otp_code_used, captured_by, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      proof.delivery_id,
      proof.delivery_attempt_id || null,
      proof.proof_type,
      proof.document_id || null,
      proof.recipient_name || null,
      proof.recipient_id_type || null,
      proof.recipient_id_last4 || null,
      proof.otp_code_used || null,
      proof.captured_by || null,
      proof.notes || null,
    ],
  );
  return rows[0];
}

// ── courier webhook events ───────────────────────────────
async function addWebhookEvent({ client, brand, event }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "courier_webhook_events")}
       (shared_webhook_id, courier_id, delivery_id, external_event_type, external_event_id, mapped_to_status, payload, signature_valid, processed, processed_at, processing_error)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,COALESCE($8,false),COALESCE($9,false),$10,$11) RETURNING *`,
    [
      event.shared_webhook_id || null,
      event.courier_id,
      event.delivery_id || null,
      event.external_event_type,
      event.external_event_id || null,
      event.mapped_to_status || null,
      JSON.stringify(event.payload || {}),
      event.signature_valid,
      event.processed,
      event.processed_at || null,
      event.processing_error || null,
    ],
  );
  return rows[0];
}
async function listWebhookEvents({ client, brand, delivery_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "courier_webhook_events")} WHERE delivery_id = $1 ORDER BY received_at`,
    [delivery_id],
  );
  return rows;
}

// ── pay_on_delivery_collections ──────────────────────────
async function createPodCollection({ client, brand, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "pay_on_delivery_collections")}
       (collection_number, delivery_id, courier_id, expected_amount_ngn, courier_fee_ngn, notes)
     VALUES ($1,$2,$3,$4,COALESCE($5,0),$6) RETURNING *`,
    [
      row.collection_number,
      row.delivery_id,
      row.courier_id,
      row.expected_amount_ngn,
      row.courier_fee_ngn,
      row.notes || null,
    ],
  );
  return rows[0];
}
async function getPodCollection({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "pay_on_delivery_collections")} WHERE collection_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function listPodCollections({
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
  if (filters.courier_id) {
    where.push(`courier_id = $${i++}`);
    params.push(filters.courier_id);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "pay_on_delivery_collections")} ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "pay_on_delivery_collections")} ${w} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
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
async function setPodStatus({ client, brand, id, status, extra = {} }) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "pay_on_delivery_collections")} SET ${sets.join(", ")} WHERE collection_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

module.exports = {
  nextNumber,
  createCourier,
  getCourier,
  getDefaultCourier,
  findDeliveryByOrder,
  listCouriers,
  updateCourier,
  createDelivery,
  addDeliveryItem,
  getDelivery,
  getDeliveryByToken,
  listDeliveries,
  setDeliveryStatus,
  updateDelivery,
  incrementAttemptCount,
  addStateHistory,
  addAttempt,
  addProof,
  addWebhookEvent,
  listWebhookEvents,
  createPodCollection,
  getPodCollection,
  listPodCollections,
  setPodStatus,
};
