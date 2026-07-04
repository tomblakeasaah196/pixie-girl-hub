/**
 * AI Insights (V2.2 §6.30) — repository (unified store).
 *
 * All findings live in ONE table, `shared.ai_insights`, keyed by
 * (module, detector) with a typed `context` JSONB and a drill target. The
 * open→acknowledged/investigating/resolved/dismissed lifecycle and the
 * idempotent `raise` (ON CONFLICT DO NOTHING on the partial-unique
 * open-suppression index) are generic over every module — so a new module
 * ships insights via a registry entry, not new SQL here.
 *
 * `shared.ai_insight_modules` is the AI Control switchboard (per-module
 * insights_enabled / narration_enabled / frequency). The detector runner and
 * the module-page UI slot both gate on it.
 *
 * The detector SOURCE reads (overdue invoices, stale intercompany, approval
 * backlog, service-match) pull from the live spine and are unchanged from the
 * category-table era — only the WRITE side moved to the unified store.
 */

"use strict";

const { query, ex } = require("../../config/database");
const { t } = require("../../config/brands");

// ── Unified ingest hook (idempotent on the open-suppression index) ──
/**
 * Raise one finding. `insight` is the normalised shape every detector emits:
 * { module, detector, business?, severity, title, body?, context?, amount_ngn?,
 *   source_table?, source_id?, drill_route?, suppression_key }.
 * Duplicate open findings for the same (module, business, suppression_key) are
 * silently skipped, so a 30-min sweep never spams.
 */
async function raise({ client, insight: r }) {
  // RETURNING with ON CONFLICT DO NOTHING yields the row ONLY when a new insight
  // was actually inserted (suppressed duplicates return nothing) — so callers
  // can notify/relay only on genuinely new findings.
  const { rows } = await ex(client)(
    `INSERT INTO shared.ai_insights
       (module, detector, business, severity, status, title, body, context,
        amount_ngn, source_table, source_id, drill_route, suppression_key)
     VALUES ($1,$2,$3,$4,'open',$5,$6,COALESCE($7::jsonb,'{}'::jsonb),
             $8,$9,$10,$11,$12)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      r.module,
      r.detector,
      r.business || null,
      r.severity,
      r.title,
      r.body || null,
      r.context ? JSON.stringify(r.context) : null,
      r.amount_ngn || null,
      r.source_table || null,
      r.source_id || null,
      r.drill_route || null,
      r.suppression_key,
    ],
  );
  return rows[0] || null;
}

// ── Lifecycle read/write (generic over the unified table) ──
async function list({
  module,
  business,
  status = "open",
  severity,
  page = 1,
  page_size = 50,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (module) {
    where.push(`module = $${i++}`);
    params.push(module);
  }
  // Cross-brand findings (business IS NULL, e.g. inter-company) show for
  // whichever brand is asking.
  if (business) {
    where.push(`(business = $${i++} OR business IS NULL)`);
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
    `SELECT * FROM shared.ai_insights ${w}
      ORDER BY detected_at DESC LIMIT $${i++} OFFSET $${i}`,
    [...params, page_size, offset],
  );
  return rows;
}
async function getOne({ id }) {
  const { rows } = await query(
    `SELECT * FROM shared.ai_insights WHERE insight_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function setStatus({ id, status, fields = {} }) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = $${i++}`);
    params.push(v);
  }
  const { rows } = await query(
    `UPDATE shared.ai_insights SET ${sets.join(", ")}
      WHERE insight_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}
/** Per-module open counts (+ urgent = high/critical) for the summary/badges. */
async function summary({ business }) {
  const params = [];
  let filter = "";
  if (business) {
    filter = `AND (business = $1 OR business IS NULL)`;
    params.push(business);
  }
  const { rows } = await query(
    `SELECT module,
            count(*)::int AS open,
            count(*) FILTER (WHERE severity IN ('high','critical'))::int AS urgent
       FROM shared.ai_insights
      WHERE status = 'open' ${filter}
      GROUP BY module`,
    params,
  );
  const out = {};
  for (const r of rows) out[r.module] = { open: r.open, urgent: r.urgent };
  return out;
}

// ── AI Control switchboard (ai_insight_modules) ──
async function listModules() {
  const { rows } = await query(
    `SELECT * FROM shared.ai_insight_modules ORDER BY sort_order, module`,
  );
  return rows;
}
async function getModule(module) {
  const { rows } = await query(
    `SELECT * FROM shared.ai_insight_modules WHERE module = $1`,
    [module],
  );
  return rows[0] || null;
}
/** Modules with tier-1 detectors switched on. */
async function enabledModules() {
  const { rows } = await query(
    `SELECT module FROM shared.ai_insight_modules WHERE insights_enabled = true`,
  );
  return rows.map((r) => r.module);
}
/** Modules with tier-2 AI narration switched on (implies insights on). */
async function narrationModules() {
  const { rows } = await query(
    `SELECT module FROM shared.ai_insight_modules
      WHERE insights_enabled = true AND narration_enabled = true`,
  );
  return rows.map((r) => r.module);
}
async function updateModule({ module, fields, updated_by }) {
  const allowed = ["insights_enabled", "narration_enabled", "frequency"];
  const sets = [];
  const params = [module];
  let i = 2;
  for (const k of allowed) {
    if (k in fields) {
      sets.push(`${k} = $${i++}`);
      params.push(fields[k]);
    }
  }
  if (updated_by) {
    sets.push(`updated_by = $${i++}`);
    params.push(updated_by);
  }
  if (sets.length === 0) return getModule(module);
  const { rows } = await query(
    `UPDATE shared.ai_insight_modules SET ${sets.join(", ")}
      WHERE module = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── Detector SOURCE reads (the live spine) — unchanged ─────
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

// Attendance (shared.attendance_days carries business + is_offsite from 000234).
async function offsiteAttendance({ within_days = 7, limit = 500 }) {
  const { rows } = await query(
    `SELECT business, profile_id, work_date, offsite_distance_m
       FROM shared.attendance_days
      WHERE is_offsite = true
        AND work_date >= CURRENT_DATE - ($1::int)
      ORDER BY work_date DESC LIMIT $2`,
    [within_days, limit],
  );
  return rows;
}
// Purchasing: POs whose expected delivery date has passed and that are not yet
// received/closed/cancelled.
async function overduePurchaseOrders({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT po_id, po_number, supplier_id, total_ngn,
            (CURRENT_DATE - expected_delivery) AS days_overdue
       FROM ${t(brand, "purchase_orders")}
      WHERE expected_delivery IS NOT NULL
        AND expected_delivery < CURRENT_DATE
        AND status NOT IN ('received','closed','cancelled')
      ORDER BY expected_delivery ASC LIMIT $1`,
    [limit],
  );
  return rows;
}
// Logistics: failed/lost/damaged/returned deliveries, plus in-flight deliveries
// past their expected time.
async function problemDeliveries({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT delivery_id, delivery_number, order_id, status,
            pod_amount_expected_ngn, expected_delivery_at,
            (EXTRACT(EPOCH FROM (now() - expected_delivery_at)) / 3600)::int AS overdue_hours
       FROM ${t(brand, "deliveries")}
      WHERE status IN ('attempted_failed','lost','damaged','returned_to_sender')
         OR (expected_delivery_at IS NOT NULL
             AND expected_delivery_at < now()
             AND status IN ('queued','booked','picked_up','in_transit',
                            'arrived_destination_city','out_for_delivery'))
      ORDER BY expected_delivery_at ASC NULLS LAST LIMIT $1`,
    [limit],
  );
  return rows;
}
// Expenses: cash advances flagged overdue for settlement, or disbursed and ageing.
async function unsettledAdvances({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT advance_id, advance_number, purpose, status,
            COALESCE(approved_amount_ngn, requested_amount_ngn) AS amount_ngn,
            (CURRENT_DATE - created_at::date) AS age_days
       FROM ${t(brand, "cash_advances")}
      WHERE status = 'overdue_settlement'
         OR (status = 'disbursed' AND created_at < now() - interval '14 days')
      ORDER BY created_at ASC LIMIT $1`,
    [limit],
  );
  return rows;
}

// Sales: orders paid but not yet dispatched for too long (fulfilment delay).
async function fulfillmentDelayedOrders({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT order_id, order_number, contact_id, total_ngn, status,
            (EXTRACT(EPOCH FROM (now() - placed_at)) / 86400)::int AS age_days
       FROM ${t(brand, "sales_orders")}
      WHERE status IN ('paid','awaiting_dispatch','ready_for_dispatch')
        AND placed_at IS NOT NULL
        AND placed_at < now() - interval '3 days'
      ORDER BY placed_at ASC LIMIT $1`,
    [limit],
  );
  return rows;
}
// CRM: open deals with no stage movement for a while (stalled).
async function stalledDeals({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT deal_id, title, current_stage_id, expected_value_ngn,
            (EXTRACT(EPOCH FROM (now() - stage_entered_at)) / 86400)::int AS days_in_stage
       FROM ${t(brand, "crm_deals")}
      WHERE status = 'open'
        AND stage_entered_at < now() - interval '14 days'
      ORDER BY stage_entered_at ASC LIMIT $1`,
    [limit],
  );
  return rows;
}
// Production: runs whose expected arrival date has passed and aren't terminal.
async function delayedProductionRuns({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT run_id, run_number, status, total_landed_cost_ngn,
            (CURRENT_DATE - expected_arrival_date) AS days_late
       FROM ${t(brand, "production_runs")}
      WHERE expected_arrival_date IS NOT NULL
        AND expected_arrival_date < CURRENT_DATE
        AND status NOT IN ('received','styled','closed','cancelled')
      ORDER BY expected_arrival_date ASC LIMIT $1`,
    [limit],
  );
  return rows;
}
// Accounting: draft journal entries left unposted.
async function agingDraftJournals({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT entry_id, entry_number, description,
            (EXTRACT(EPOCH FROM (now() - created_at)) / 86400)::int AS age_days
       FROM ${t(brand, "journal_entries")}
      WHERE status = 'draft'
        AND created_at < now() - interval '7 days'
      ORDER BY created_at ASC LIMIT $1`,
    [limit],
  );
  return rows;
}
// Retention: contacts whose current (non-superseded) churn score is high.
async function churnRiskContacts({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT score_id, contact_id, risk_score, risk_band, computed_at
       FROM ${t(brand, "churn_risk_scores")}
      WHERE superseded_at IS NULL
        AND risk_band IN ('high','critical')
      ORDER BY risk_score DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

// Pricing: active variants whose storefront price is below cost or below their
// own floor (min_price_ngn) — a margin breach that needs a repricing decision.
async function marginBreaches({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT pv.variant_id, pv.product_id, pv.sku, pv.variant_name,
            pv.cost_price_ngn, pv.min_price_ngn, pv.price_storefront_ngn,
            p.name AS product_name
       FROM ${t(brand, "product_variants")} pv
       JOIN ${t(brand, "products")} p ON p.product_id = pv.product_id
      WHERE pv.is_active = true
        AND pv.cost_price_ngn > 0
        AND pv.price_storefront_ngn IS NOT NULL
        AND pv.price_storefront_ngn > 0
        AND (pv.price_storefront_ngn < pv.cost_price_ngn
             OR (pv.min_price_ngn IS NOT NULL AND pv.min_price_ngn > 0
                 AND pv.price_storefront_ngn < pv.min_price_ngn))
      ORDER BY (pv.cost_price_ngn - pv.price_storefront_ngn) DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}
// Retail partners: settlements disputed, or approved/invoiced but unpaid.
async function unpaidPartnerSettlements({ brand, limit = 500 }) {
  const { rows } = await query(
    `SELECT settlement_id, settlement_number, partner_id, status,
            total_partner_share_ngn,
            (EXTRACT(EPOCH FROM (now() - created_at)) / 86400)::int AS age_days
       FROM ${t(brand, "partner_settlements")}
      WHERE status = 'disputed'
         OR (status IN ('approved','invoiced')
             AND created_at < now() - interval '7 days')
      ORDER BY created_at ASC LIMIT $1`,
    [limit],
  );
  return rows;
}
// Tasks: overdue open tasks (shared.tasks carries business).
async function overdueTasks({ limit = 500 }) {
  const { rows } = await query(
    `SELECT task_id, business, title, priority, assigned_to,
            (EXTRACT(EPOCH FROM (now() - due_at)) / 86400)::int AS days_overdue
       FROM shared.tasks
      WHERE due_at IS NOT NULL
        AND due_at < now()
        AND status NOT IN ('done','cancelled')
      ORDER BY due_at ASC LIMIT $1`,
    [limit],
  );
  return rows;
}

module.exports = {
  raise,
  list,
  getOne,
  setStatus,
  summary,
  listModules,
  getModule,
  enabledModules,
  narrationModules,
  updateModule,
  overdueInvoices,
  staleIntercompany,
  staleApprovals,
  unlinkedServiceJobs,
  intercompanyJobsMissingMatch,
  offsiteAttendance,
  overduePurchaseOrders,
  problemDeliveries,
  unsettledAdvances,
  fulfillmentDelayedOrders,
  stalledDeals,
  delayedProductionRuns,
  agingDraftJournals,
  churnRiskContacts,
  marginBreaches,
  unpaidPartnerSettlements,
  overdueTasks,
};
