/**
 * AI Insights (V2.2 §6.30) — repository.
 *
 * SHARED tier-1 insight tables (one per category). Each shares the same
 * lifecycle shape (severity, status open→acknowledged/resolved/dismissed,
 * suppression_key UNIQUE while open). `raiseInsight` is the ingest hook
 * (ON CONFLICT DO NOTHING on the open-suppression index) so a detector sweep
 * never duplicates an open alert. Detector read-queries pull from the live
 * spine (invoices, intercompany, workflow_instances, service_jobs).
 */

"use strict";

const { query, ex } = require("../../config/database");
const { t } = require("../../config/brands");

// category → shared table (hardcoded; never interpolate user input)
const TABLE = {
  stock: "shared.ai_insight_stock_alerts",
  margin: "shared.ai_insight_margin_breaches",
  invoice: "shared.ai_insight_invoice_alerts",
  intercompany: "shared.ai_insight_intercompany_alerts",
  attendance: "shared.ai_insight_attendance_anomalies",
  approval: "shared.ai_insight_approval_queue_alerts",
  service_match: "shared.ai_insight_service_match",
};
function tableFor(category) {
  const tbl = TABLE[category];
  if (!tbl) throw new Error(`Unknown insight category: ${category}`);
  return tbl;
}
const OPEN_STATES = {
  service_match: "('open','investigating')",
  default: "('open')",
};

// ── Lifecycle read/write (generic over the category table) ──
async function list({
  category,
  business,
  status = "open",
  severity,
  page = 1,
  page_size = 50,
}) {
  const tbl = tableFor(category);
  const where = [];
  const params = [];
  let i = 1;
  // intercompany has no business column (cross-brand)
  if (business && category !== "intercompany") {
    where.push(`business = $${i++}`);
    params.push(business);
  }
  if (status) {
    where.push(`status = $${i++}`);
    params.push(status);
  }
  if (severity) {
    where.push(`severity = $${i++}`);
    params.push(severity);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const offset = (page - 1) * page_size;
  const { rows } = await query(
    `SELECT * FROM ${tbl} ${w} ORDER BY detected_at DESC LIMIT $${i++} OFFSET $${i}`,
    [...params, page_size, offset],
  );
  return rows;
}
async function getOne({ category, id }) {
  const tbl = tableFor(category);
  const { rows } = await query(`SELECT * FROM ${tbl} WHERE insight_id = $1`, [
    id,
  ]);
  return rows[0] || null;
}
async function setStatus({ category, id, status, fields = {} }) {
  const tbl = tableFor(category);
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = $${i++}`);
    params.push(v);
  }
  const { rows } = await query(
    `UPDATE ${tbl} SET ${sets.join(", ")} WHERE insight_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}
async function openCounts({ business }) {
  const out = {};
  for (const [cat, tbl] of Object.entries(TABLE)) {
    const openStates = OPEN_STATES[cat] || OPEN_STATES.default;
    const where = [`status IN ${openStates}`];
    const params = [];
    if (business && cat !== "intercompany") {
      where.push(`business = $1`);
      params.push(business);
    }
    const { rows } = await query(
      `SELECT count(*)::int AS c, count(*) FILTER (WHERE severity IN ('high','critical'))::int AS urgent
         FROM ${tbl} WHERE ${where.join(" AND ")}`,
      params,
    );
    out[cat] = { open: rows[0].c, urgent: rows[0].urgent };
  }
  return out;
}

// ── Ingest hook (idempotent on the open-suppression index) ──
async function raiseStock({ client, r }) {
  await ex(client)(
    `INSERT INTO shared.ai_insight_stock_alerts
       (business, product_id, variant_id, stock_location_id, current_stock,
        reorder_point, daily_velocity, projected_days_left, severity, suppression_key)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,0),$8,$9,$10)
     ON CONFLICT DO NOTHING`,
    [
      r.business,
      r.product_id,
      r.variant_id || null,
      r.stock_location_id || null,
      r.current_stock,
      r.reorder_point,
      r.daily_velocity,
      r.projected_days_left || null,
      r.severity,
      r.suppression_key,
    ],
  );
}
async function raiseMargin({ client, r }) {
  await ex(client)(
    `INSERT INTO shared.ai_insight_margin_breaches
       (business, breach_type, product_id, variant_id, channel, current_cost_ngn,
        current_price_ngn, current_margin_pct, floor_margin_pct, severity, suppression_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
    [
      r.business,
      r.breach_type,
      r.product_id || null,
      r.variant_id || null,
      r.channel || null,
      r.current_cost_ngn || null,
      r.current_price_ngn || null,
      r.current_margin_pct || null,
      r.floor_margin_pct || null,
      r.severity,
      r.suppression_key,
    ],
  );
}
async function raiseInvoice({ client, r }) {
  await ex(client)(
    `INSERT INTO shared.ai_insight_invoice_alerts
       (business, alert_type, invoice_id, customer_contact_id, amount_ngn,
        days_overdue, severity, suppression_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
    [
      r.business,
      r.alert_type,
      r.invoice_id || null,
      r.customer_contact_id || null,
      r.amount_ngn || null,
      r.days_overdue || null,
      r.severity,
      r.suppression_key,
    ],
  );
}
async function raiseIntercompany({ client, r }) {
  await ex(client)(
    `INSERT INTO shared.ai_insight_intercompany_alerts
       (ic_transaction_id, recon_id, alert_type, seller_brand, buyer_brand,
        amount_ngn, age_days, severity, suppression_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
    [
      r.ic_transaction_id || null,
      r.recon_id || null,
      r.alert_type,
      r.seller_brand || null,
      r.buyer_brand || null,
      r.amount_ngn || null,
      r.age_days || null,
      r.severity,
      r.suppression_key,
    ],
  );
}
async function raiseAttendance({ client, r }) {
  await ex(client)(
    `INSERT INTO shared.ai_insight_attendance_anomalies
       (business, staff_profile_id, anomaly_type, clock_event_id, anomaly_date,
        distance_from_geofence_m, severity, suppression_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
    [
      r.business,
      r.staff_profile_id,
      r.anomaly_type,
      r.clock_event_id || null,
      r.anomaly_date,
      r.distance_from_geofence_m || null,
      r.severity,
      r.suppression_key,
    ],
  );
}
async function raiseApproval({ client, r }) {
  await ex(client)(
    `INSERT INTO shared.ai_insight_approval_queue_alerts
       (business, approver_user_id, alert_type, pending_count, oldest_age_hours,
        workflow_instance_id, severity, suppression_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
    [
      r.business,
      r.approver_user_id || null,
      r.alert_type,
      r.pending_count,
      r.oldest_age_hours,
      r.workflow_instance_id || null,
      r.severity,
      r.suppression_key,
    ],
  );
}
async function raiseServiceMatch({ client, r }) {
  await ex(client)(
    `INSERT INTO shared.ai_insight_service_match
       (business, service_job_id, service_job_number, completed_by_stylist_id,
        completed_by_user_id, alert_type, job_completed_at, expected_amount_ngn,
        found_amount_ngn, variance_ngn, severity, suppression_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING`,
    [
      r.business,
      r.service_job_id,
      r.service_job_number || null,
      r.completed_by_stylist_id || null,
      r.completed_by_user_id || null,
      r.alert_type,
      r.job_completed_at,
      r.expected_amount_ngn || null,
      r.found_amount_ngn || null,
      r.variance_ngn || null,
      r.severity,
      r.suppression_key,
    ],
  );
}

// ── Detector source reads (the live spine) ─────────────────
async function overdueInvoices({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT invoice_id, contact_id AS customer_contact_id, balance_due_ngn AS net_due_ngn,
            (CURRENT_DATE - due_date) AS days_overdue
       FROM ${t(brand, "invoices")}
      WHERE status IN ('sent','viewed','partially_paid')
        AND due_date < CURRENT_DATE
      ORDER BY due_date ASC LIMIT $1`,
    [limit],
  );
  return rows;
}
async function staleIntercompany({ within_days = 7, limit = 500 }) {
  const { rows } = await query(
    `SELECT ic_transaction_id, seller_brand, buyer_brand, amount_ngn,
            (CURRENT_DATE - created_at::date) AS age_days
       FROM shared.intercompany_transactions
      WHERE status IN ('recorded','pending','matched')
        AND created_at < now() - ($1 || ' days')::interval
      ORDER BY created_at ASC LIMIT $2`,
    [within_days, limit],
  );
  return rows;
}
async function staleApprovals({ within_hours = 48 }) {
  const { rows } = await query(
    `SELECT business, count(*)::int AS pending_count,
            (EXTRACT(EPOCH FROM (now() - min(stage_entered_at))) / 3600)::int AS oldest_age_hours
       FROM shared.workflow_instances
      WHERE status = 'pending' AND stage_entered_at < now() - ($1 || ' hours')::interval
      GROUP BY business`,
    [within_hours],
  );
  return rows;
}
async function unlinkedServiceJobs({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT job_id, job_number, assigned_stylist_id, assigned_staff_user_id,
            completed_at, agreed_cost_ngn, actual_cost_ngn
       FROM ${t(brand, "service_jobs")}
      WHERE status = 'completed' AND sales_order_id IS NULL
        AND is_intercompany = false
      ORDER BY completed_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}
// Flow-1 books integrity: a cross-entity styling job (FLH styling PXG's hair)
// must carry its matched inter-company transaction (the FLH styling invoice).
// Flags intercompany jobs with no link, or whose linked txn is void — once the
// job is completed, or has been open long enough that the invoice is overdue.
async function intercompanyJobsMissingMatch({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT j.job_id, j.job_number, j.assigned_stylist_id, j.assigned_staff_user_id,
            j.completed_at, j.agreed_cost_ngn, j.actual_cost_ngn, j.status
       FROM ${t(brand, "service_jobs")} j
       LEFT JOIN shared.intercompany_transactions ic
              ON ic.ic_transaction_id = j.intercompany_transaction_id
      WHERE j.is_intercompany = true
        AND j.status NOT IN ('cancelled', 'rejected')
        AND (j.status = 'completed' OR j.created_at < now() - interval '2 days')
        AND (j.intercompany_transaction_id IS NULL
             OR ic.status IN ('rejected', 'cancelled', 'reversed', 'disputed'))
      ORDER BY j.created_at DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

module.exports = {
  TABLE,
  list,
  getOne,
  setStatus,
  openCounts,
  raiseStock,
  raiseMargin,
  raiseInvoice,
  raiseIntercompany,
  raiseAttendance,
  raiseApproval,
  raiseServiceMatch,
  overdueInvoices,
  staleIntercompany,
  staleApprovals,
  unlinkedServiceJobs,
  intercompanyJobsMissingMatch,
};
