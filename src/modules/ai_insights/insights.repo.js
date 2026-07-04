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
  await ex(client)(
    `INSERT INTO shared.ai_insights
       (module, detector, business, severity, status, title, body, context,
        amount_ngn, source_table, source_id, drill_route, suppression_key)
     VALUES ($1,$2,$3,$4,'open',$5,$6,COALESCE($7::jsonb,'{}'::jsonb),
             $8,$9,$10,$11,$12)
     ON CONFLICT DO NOTHING`,
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
};
