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
  "contact_person",
  "contact_phone",
  "payment_terms_notes",
  "preferred_pickup_location",
  "internal_rating",
  "internal_notes",
  "settlement_mode",
];
const COURIER_JSONB = new Set(["rate_card"]);
async function createCourier({ client, brand, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "couriers")}
       (courier_key, display_name, description, integration_type, api_endpoint, webhook_secret,
        serves_local, serves_nationwide, serves_international, service_countries, rate_card,
        supports_pod, pod_fee_pct, default_packaging, display_order,
        contact_person, contact_phone, payment_terms_notes, preferred_pickup_location, internal_rating, internal_notes,
        settlement_mode)
     VALUES ($1,$2,$3,COALESCE($4,'manual'),$5,$6,COALESCE($7,true),COALESCE($8,false),COALESCE($9,false),
             COALESCE($10,'{NG}')::text[],COALESCE($11,'{}')::jsonb,COALESCE($12,false),$13,$14,COALESCE($15,0),
             $16,$17,$18,$19,$20,$21,COALESCE($22,'invoice')) RETURNING *`,
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
      row.contact_person || null,
      row.contact_phone || null,
      row.payment_terms_notes || null,
      row.preferred_pickup_location || null,
      row.internal_rating ?? null,
      row.internal_notes || null,
      row.settlement_mode || null,
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
  // A cancelled delivery does not count as "already has a delivery" — otherwise
  // a premature/cancelled row would block the real delivery from being created
  // when the order is (finally) paid. Only a live delivery guards the create.
  const { rows } = await ex(client)(
    `SELECT delivery_id FROM ${t(brand, "deliveries")}
      WHERE order_id = $1 AND status <> 'cancelled' LIMIT 1`,
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

// ── readiness ────────────────────────────────────────────
// Whether a delivery can actually be dispatched right now. Both gates must
// clear: the sales order must be packed/queued for courier, AND any styling
// job on it must be out of the studio. Deliveries are auto-created the moment
// an order is PAID (see logistics.subscribers), so without this the queue is
// full of rows nobody can act on — a wig still on a stylist's table looks
// identical to one sitting in a box by the door.
//
// Expects `d` (deliveries), `so` (sales_orders) and `sj` (latest service job)
// in scope. Non-order deliveries (stock transfers, supplier returns) have no
// fulfilment spine to wait on, so they are ready by definition.
const READINESS_SQL = `
  CASE
    WHEN d.order_id IS NULL THEN 'ready'
    WHEN so.status IN ('cancelled','refunded','failed','cancellation_requested')
      THEN 'order_blocked'
    WHEN sj.job_id IS NOT NULL
     AND sj.status NOT IN ('ready_for_dispatch','handed_to_sales','completed')
      THEN 'awaiting_studio'
    WHEN so.status IN ('order_ready','dispatched','completed') THEN 'ready'
    ELSE 'awaiting_fulfilment'
  END`;

// ── deliveries ───────────────────────────────────────────
async function createDelivery({ client, brand, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "deliveries")}
       (delivery_number, order_id, delivery_type, reference_type, reference_id, courier_id, courier_tracking_ref, courier_tracking_url,
        from_location_id, recipient_contact_id, recipient_name_snapshot, recipient_phone_snapshot, recipient_whatsapp_snapshot,
        delivery_address_snapshot, delivery_instructions, courier_fee_ngn, is_pay_on_delivery, pod_amount_expected_ngn,
        weight_g, package_count, declared_value_ngn, public_tracking_token, created_by,
        driver_name, driver_phone, scheduled_pickup_at)
     VALUES ($1,$2,COALESCE($3,'sales_order'),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,COALESCE($16,0),COALESCE($17,false),$18,$19,COALESCE($20,1),$21,$22,$23,
             $24,$25,$26)
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
      row.driver_name || null,
      row.driver_phone || null,
      row.scheduled_pickup_at || null,
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
    `SELECT d.*,
            so.order_number,
            so.status     AS order_status,
            so.shipping_fee_ngn AS order_shipping_fee_ngn,
            sj.job_id     AS service_job_id,
            sj.job_number AS service_job_number,
            sj.status     AS service_job_status,
            ${READINESS_SQL} AS readiness,
            cc.display_name  AS completed_by_name,
            csp.job_title    AS completed_by_job_title,
            COALESCE(so.shipping_fee_ngn, 0) - d.courier_fee_ngn AS delivery_margin_ngn
       FROM ${t(brand, "deliveries")} d
       LEFT JOIN ${t(brand, "sales_orders")} so ON so.order_id = d.order_id
       LEFT JOIN shared.users cu           ON cu.user_id    = d.completed_by
       LEFT JOIN shared.staff_profiles csp ON csp.profile_id = cu.staff_profile_id
       LEFT JOIN shared.contacts cc        ON cc.contact_id  = csp.contact_id
       LEFT JOIN LATERAL (
         SELECT job_id, job_number, status
           FROM ${t(brand, "service_jobs")} sjx
          WHERE sjx.sales_order_id = d.order_id
          ORDER BY sjx.created_at DESC
          LIMIT 1
       ) sj ON true
      WHERE d.delivery_id = $1`,
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
  // Resolve `changed_by` into a human name — the timeline is the audit record
  // staff actually read, and a bare UUID (or nothing) makes it useless for
  // answering "who followed this up".
  const { rows: history } = await ex(client)(
    `SELECT h.*,
            c.display_name AS actor_name,
            sp.job_title   AS actor_job_title
       FROM ${t(brand, "delivery_state_history")} h
       LEFT JOIN shared.users u           ON u.user_id     = h.changed_by
       LEFT JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
       LEFT JOIN shared.contacts c        ON c.contact_id  = sp.contact_id
      WHERE h.delivery_id = $1
      ORDER BY h.changed_at`,
    [id],
  );
  const { rows: proofs } = await ex(client)(
    `SELECT * FROM ${t(brand, "delivery_proofs")} WHERE delivery_id = $1 ORDER BY confirmed_at`,
    [id],
  );
  const costs = await listDeliveryCosts({ client, brand, delivery_id: id });
  return { ...rows[0], items, attempts, history, proofs, costs };
}
/** Minimal order + customer-contact read for the delivered-confirmation email. */
async function getOrderForEmail({ client, brand, order_id }) {
  const { rows } = await ex(client)(
    `SELECT so.order_id, so.order_number, c.display_name AS contact_name, c.email AS contact_email
       FROM ${t(brand, "sales_orders")} so
       LEFT JOIN shared.contacts c ON c.contact_id = so.contact_id
      WHERE so.order_id = $1`,
    [order_id],
  );
  return rows[0] || null;
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
    where.push(`d.status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.courier_id) {
    where.push(`d.courier_id = $${i++}`);
    params.push(filters.courier_id);
  }
  if (filters.order_id) {
    where.push(`d.order_id = $${i++}`);
    params.push(filters.order_id);
  }
  if (filters.is_pay_on_delivery !== undefined) {
    where.push(`d.is_pay_on_delivery = $${i++}`);
    params.push(filters.is_pay_on_delivery);
  }
  if (filters.status_in && filters.status_in.length) {
    where.push(`d.status = ANY($${i++})`);
    params.push(filters.status_in);
  }
  // Readiness banding for the Queue tab. 'ready' is the actionable set; the
  // rest are visible but not dispatchable yet.
  if (filters.readiness) {
    where.push(`${READINESS_SQL} = $${i++}`);
    params.push(filters.readiness);
  }
  if (filters.has_delivery_loss !== undefined) {
    where.push(`d.has_delivery_loss = $${i++}`);
    params.push(filters.has_delivery_loss);
  }
  // Completed deliveries nobody has costed yet — the silent-profit trap.
  if (filters.cost_missing) {
    where.push(`d.status = 'delivered' AND d.cost_recorded_at IS NULL`);
  }
  if (filters.completed_by) {
    where.push(`d.completed_by = $${i++}`);
    params.push(filters.completed_by);
  }
  if (filters.delivered_from) {
    where.push(`d.delivered_at >= $${i++}`);
    params.push(filters.delivered_from);
  }
  if (filters.delivered_to) {
    where.push(`d.delivered_at <= $${i++}`);
    params.push(filters.delivered_to);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  // The order + latest-service-job joins are needed by the COUNT too, because
  // readiness is derived from them.
  const JOINS = `
       LEFT JOIN ${t(brand, "sales_orders")} so ON so.order_id = d.order_id
       LEFT JOIN LATERAL (
         SELECT job_id, job_number, status
           FROM ${t(brand, "service_jobs")} sjx
          WHERE sjx.sales_order_id = d.order_id
          ORDER BY sjx.created_at DESC
          LIMIT 1
       ) sj ON true`;
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "deliveries")} d ${JOINS} ${w}`,
    params,
  );
  // Join the originating order + customer so the delivery queue can show the
  // order number, the customer name, the customer-billed delivery fee
  // (order.shipping_fee_ngn) and the fulfilment type (order.order_type —
  // 'dispatch' = delivery, 'collection'/'walk_in' = pickup).
  const { rows } = await run(
    `SELECT d.*,
            so.order_number,
            so.order_type,
            so.shipping_fee_ngn AS order_shipping_fee_ngn,
            so.status           AS order_status,
            ct.display_name     AS customer_name,
            sj.job_id           AS service_job_id,
            sj.job_number       AS service_job_number,
            sj.status           AS service_job_status,
            ${READINESS_SQL}    AS readiness,
            -- Completion attribution: who marked it delivered, and when.
            cc.display_name     AS completed_by_name,
            csp.job_title       AS completed_by_job_title,
            -- Per-delivery P&L. Revenue is what the customer was billed for
            -- shipping; cost is what we actually paid out.
            COALESCE(so.shipping_fee_ngn, 0) - d.courier_fee_ngn AS delivery_margin_ngn
       -- sj carries the styling status for the order (if any) so dispatchers
       -- can see whether the wig is still in the studio and pre-arrange the
       -- courier.
       FROM ${t(brand, "deliveries")} d
       ${JOINS}
       LEFT JOIN shared.contacts ct ON ct.contact_id = so.contact_id
       LEFT JOIN shared.users cu           ON cu.user_id    = d.completed_by
       LEFT JOIN shared.staff_profiles csp ON csp.profile_id = cu.staff_profile_id
       LEFT JOIN shared.contacts cc        ON cc.contact_id  = csp.contact_id
       ${w}
      ORDER BY d.created_at DESC LIMIT $${i++} OFFSET $${i++}`,
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
// ── delivery costs ───────────────────────────────────────
// What we actually paid out on a delivery. Several rows per delivery is the
// normal case once an attempt fails — a redelivery leg is real money and must
// not overwrite the outbound figure.
async function listDeliveryCosts({ client, brand, delivery_id }) {
  const { rows } = await ex(client)(
    `SELECT dc.*,
            co.display_name AS courier_name,
            c.display_name  AS recorded_by_name
       FROM ${t(brand, "delivery_costs")} dc
       LEFT JOIN ${t(brand, "couriers")} co ON co.courier_id = dc.courier_id
       LEFT JOIN shared.users u           ON u.user_id     = dc.recorded_by
       LEFT JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
       LEFT JOIN shared.contacts c        ON c.contact_id  = sp.contact_id
      WHERE dc.delivery_id = $1
      ORDER BY dc.incurred_at`,
    [delivery_id],
  );
  return rows;
}
async function addDeliveryCost({ client, brand, cost }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "delivery_costs")}
       (delivery_id, cost_type, amount_ngn, courier_id, incurred_at, settlement_mode,
        receipt_document_id, notes, recorded_by)
     VALUES ($1,COALESCE($2,'outbound'),$3,$4,COALESCE($5,now()),COALESCE($6,'invoice'),$7,$8,$9)
     RETURNING *`,
    [
      cost.delivery_id,
      cost.cost_type || null,
      cost.amount_ngn,
      cost.courier_id || null,
      cost.incurred_at || null,
      cost.settlement_mode || null,
      cost.receipt_document_id || null,
      cost.notes || null,
      cost.recorded_by || null,
    ],
  );
  return rows[0];
}
async function getDeliveryCost({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "delivery_costs")} WHERE cost_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function deleteDeliveryCost({ client, brand, id }) {
  await ex(client)(
    `DELETE FROM ${t(brand, "delivery_costs")} WHERE cost_id = $1`,
    [id],
  );
}
/**
 * Recompute `courier_fee_ngn` (the maintained total), the loss figures and the
 * cost-recorded stamp from the delivery's cost rows. Single source of truth
 * for the money on a delivery — every write path funnels through here rather
 * than doing its own arithmetic.
 *
 * Loss = actual cost − what the customer was billed for shipping, floored at
 * zero. A waived fee is still a loss in cash terms, but `fee_waiver_reason`
 * lets reporting separate "we chose this" from "this overran".
 */
async function recomputeDeliveryCostTotals({ client, brand, id, user_id }) {
  const { rows } = await ex(client)(
    `WITH totals AS (
       SELECT COALESCE(SUM(amount_ngn), 0) AS total,
              COUNT(*)                     AS n,
              MAX(created_at)              AS last_recorded
         FROM ${t(brand, "delivery_costs")}
        WHERE delivery_id = $1
     )
     UPDATE ${t(brand, "deliveries")} d
        SET courier_fee_ngn   = totals.total,
            delivery_loss_ngn = GREATEST(
              totals.total - COALESCE(so.shipping_fee_ngn, 0), 0),
            has_delivery_loss =
              (totals.total - COALESCE(so.shipping_fee_ngn, 0)) > 0,
            cost_recorded_at  = CASE WHEN totals.n > 0
                                     THEN COALESCE(d.cost_recorded_at, now())
                                     ELSE NULL END,
            cost_recorded_by  = CASE WHEN totals.n > 0
                                     THEN COALESCE(d.cost_recorded_by, $2)
                                     ELSE NULL END
       FROM totals
       LEFT JOIN ${t(brand, "sales_orders")} so
              ON so.order_id = (SELECT order_id FROM ${t(brand, "deliveries")}
                                 WHERE delivery_id = $1)
      WHERE d.delivery_id = $1
      RETURNING d.*`,
    [id, user_id || null],
  );
  return rows[0] || null;
}
/**
 * Delivery P&L roll-up for a period. Returns headline totals plus a per-courier
 * breakdown — the number that actually matters is not any single delivery's
 * loss but which courier and which destination lose money consistently, which
 * is a rate-card question rather than a data-entry one.
 */
async function deliveryReconciliation({ client, brand, from, to }) {
  const run = ex(client);
  const params = [from, to];
  const period = `d.status = 'delivered' AND d.delivered_at >= $1 AND d.delivered_at <= $2`;
  const { rows: totals } = await run(
    `SELECT COUNT(*)::int                                        AS deliveries,
            COALESCE(SUM(so.shipping_fee_ngn), 0)                AS revenue_ngn,
            COALESCE(SUM(d.courier_fee_ngn), 0)                  AS cost_ngn,
            COALESCE(SUM(so.shipping_fee_ngn), 0)
              - COALESCE(SUM(d.courier_fee_ngn), 0)              AS margin_ngn,
            COALESCE(SUM(d.delivery_loss_ngn), 0)                AS loss_ngn,
            COUNT(*) FILTER (WHERE d.has_delivery_loss)::int     AS loss_count,
            COUNT(*) FILTER (WHERE d.fee_waiver_reason IS NOT NULL)::int
                                                                 AS waived_count,
            COUNT(*) FILTER (WHERE d.cost_recorded_at IS NULL)::int
                                                                 AS cost_missing_count
       FROM ${t(brand, "deliveries")} d
       LEFT JOIN ${t(brand, "sales_orders")} so ON so.order_id = d.order_id
      WHERE ${period}`,
    params,
  );
  const { rows: by_courier } = await run(
    `SELECT d.courier_id,
            co.display_name                                      AS courier_name,
            co.settlement_mode,
            COUNT(*)::int                                        AS deliveries,
            COALESCE(SUM(so.shipping_fee_ngn), 0)                AS revenue_ngn,
            COALESCE(SUM(d.courier_fee_ngn), 0)                  AS cost_ngn,
            COALESCE(SUM(so.shipping_fee_ngn), 0)
              - COALESCE(SUM(d.courier_fee_ngn), 0)              AS margin_ngn,
            COALESCE(SUM(d.delivery_loss_ngn), 0)                AS loss_ngn,
            COUNT(*) FILTER (WHERE d.has_delivery_loss)::int     AS loss_count
       FROM ${t(brand, "deliveries")} d
       LEFT JOIN ${t(brand, "sales_orders")} so ON so.order_id = d.order_id
       LEFT JOIN ${t(brand, "couriers")} co ON co.courier_id = d.courier_id
      WHERE ${period}
      GROUP BY d.courier_id, co.display_name, co.settlement_mode
      ORDER BY loss_ngn DESC, deliveries DESC`,
    params,
  );
  // Destination state, read out of the address snapshot. This is where a wrong
  // rate card shows up — a zone charged flat but costing by distance.
  const { rows: by_destination } = await run(
    `SELECT COALESCE(NULLIF(d.delivery_address_snapshot->>'state', ''), 'Unknown')
                                                                 AS destination,
            COUNT(*)::int                                        AS deliveries,
            COALESCE(SUM(so.shipping_fee_ngn), 0)                AS revenue_ngn,
            COALESCE(SUM(d.courier_fee_ngn), 0)                  AS cost_ngn,
            COALESCE(SUM(so.shipping_fee_ngn), 0)
              - COALESCE(SUM(d.courier_fee_ngn), 0)              AS margin_ngn,
            COALESCE(SUM(d.delivery_loss_ngn), 0)                AS loss_ngn
       FROM ${t(brand, "deliveries")} d
       LEFT JOIN ${t(brand, "sales_orders")} so ON so.order_id = d.order_id
      WHERE ${period}
      GROUP BY 1
      ORDER BY loss_ngn DESC, deliveries DESC`,
    params,
  );
  return { totals: totals[0], by_courier, by_destination };
}

/** Unsettled costs for a courier — the input to a settlement run. */
async function listUnsettledCosts({ client, brand, courier_id, to }) {
  const where = ["dc.settled_at IS NULL"];
  const params = [];
  let i = 1;
  if (courier_id) {
    where.push(`dc.courier_id = $${i++}`);
    params.push(courier_id);
  }
  if (to) {
    where.push(`dc.incurred_at <= $${i++}`);
    params.push(to);
  }
  const { rows } = await ex(client)(
    `SELECT dc.*,
            co.display_name AS courier_name,
            co.settlement_mode,
            d.delivery_number
       FROM ${t(brand, "delivery_costs")} dc
       LEFT JOIN ${t(brand, "couriers")} co ON co.courier_id = dc.courier_id
       LEFT JOIN ${t(brand, "deliveries")} d ON d.delivery_id = dc.delivery_id
      WHERE ${where.join(" AND ")}
      ORDER BY dc.courier_id, dc.incurred_at`,
    params,
  );
  return rows;
}

/** Mark a batch of costs settled against an expense or a cash request. */
async function markCostsSettled({ client, brand, cost_ids, link }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "delivery_costs")}
        SET expense_id      = COALESCE($2, expense_id),
            expense_line_id = COALESCE($3, expense_line_id),
            cash_request_id = COALESCE($4, cash_request_id),
            settled_at      = now()
      WHERE cost_id = ANY($1) AND settled_at IS NULL
      RETURNING *`,
    [
      cost_ids,
      link.expense_id || null,
      link.expense_line_id || null,
      link.cash_request_id || null,
    ],
  );
  return rows;
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
  getOrderForEmail,
  listDeliveries,
  listDeliveryCosts,
  addDeliveryCost,
  getDeliveryCost,
  deleteDeliveryCost,
  recomputeDeliveryCostTotals,
  deliveryReconciliation,
  listUnsettledCosts,
  markCostsSettled,
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
