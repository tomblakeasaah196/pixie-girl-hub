/**
 * Dashboards (V2.2 §6.20) — repository.
 *
 * Read-only KPI aggregates over the live spine (per-brand sales_orders,
 * service_jobs, deliveries) + the shared AI briefings feed. No writes except
 * marking a briefing read. Parameterised SQL only.
 */

"use strict";

const { query } = require("../../config/database");
const { t } = require("../../config/brands");

// ── Sales KPIs ─────────────────────────────────────────────
async function salesKpis({ brand, from, to }) {
  const params = [];
  let range = "";
  let i = 1;
  if (from) {
    range += ` AND COALESCE(placed_at, created_at) >= $${i++}`;
    params.push(from);
  }
  if (to) {
    range += ` AND COALESCE(placed_at, created_at) <= $${i++}`;
    params.push(to);
  }
  const { rows } = await query(
    `SELECT
        count(*) FILTER (WHERE status IN ('paid','awaiting_dispatch','completed'))::int AS paid_orders,
        COALESCE(SUM(total_ngn) FILTER (WHERE status IN ('paid','awaiting_dispatch','completed')),0) AS revenue_ngn,
        count(*) FILTER (WHERE status = 'pending_payment')::int AS pending_orders,
        COALESCE(SUM(balance_due_ngn) FILTER (WHERE status = 'pending_payment'),0) AS outstanding_ngn
       FROM ${t(brand, "sales_orders")}
      WHERE COALESCE(is_deleted,false) = false ${range}`,
    params,
  );
  return rows[0];
}

// ── Ops KPIs ───────────────────────────────────────────────
async function opsKpis({ brand }) {
  const { rows: sj } = await query(
    `SELECT
        count(*) FILTER (WHERE status = 'pending')::int AS jobs_pending,
        count(*) FILTER (WHERE status = 'in_progress')::int AS jobs_in_progress
       FROM ${t(brand, "service_jobs")}`,
  );
  const { rows: dl } = await query(
    `SELECT
        count(*) FILTER (WHERE status IN ('booked','picked_up','in_transit','out_for_delivery'))::int AS deliveries_active,
        count(*) FILTER (WHERE status = 'attempted_failed')::int AS deliveries_failed
       FROM ${t(brand, "deliveries")}`,
  );
  return { ...sj[0], ...dl[0] };
}

// ── Briefings (shared AI narration feed) ───────────────────
async function listBriefings({ brand, recipient_user_id, limit = 20 }) {
  const where = ["status = 'generated'"];
  const params = [];
  let i = 1;
  if (brand) {
    where.push(`(business = $${i++} OR business IS NULL)`);
    params.push(brand);
  }
  if (recipient_user_id) {
    where.push(`(recipient_user_id = $${i++} OR recipient_user_id IS NULL)`);
    params.push(recipient_user_id);
  }
  params.push(limit);
  const { rows } = await query(
    `SELECT briefing_id, business, schedule_type, scheduled_for, window_start,
            window_end, recipient_user_id, briefing_text, insight_count, status,
            generated_at, read_at, created_at
       FROM shared.ai_briefings
      WHERE ${where.join(" AND ")}
      ORDER BY scheduled_for DESC LIMIT $${i}`,
    params,
  );
  return rows;
}
async function getBriefing({ id }) {
  const { rows } = await query(
    `SELECT * FROM shared.ai_briefings WHERE briefing_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { rows: refs } = await query(
    `SELECT * FROM shared.ai_briefing_insight_refs WHERE briefing_id = $1 ORDER BY display_order`,
    [id],
  );
  return { ...rows[0], insight_refs: refs };
}
async function markBriefingRead({ id }) {
  const { rows } = await query(
    `UPDATE shared.ai_briefings SET read_at = COALESCE(read_at, now())
      WHERE briefing_id = $1 RETURNING briefing_id, read_at`,
    [id],
  );
  return rows[0] || null;
}

module.exports = {
  salesKpis,
  opsKpis,
  listBriefings,
  getBriefing,
  markBriefingRead,
};
