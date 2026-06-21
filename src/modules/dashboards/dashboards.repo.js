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
        count(*) FILTER (WHERE status IN ('paid','awaiting_dispatch','completed'))::int AS orders_mtd,
        COALESCE(SUM(total_ngn) FILTER (WHERE status IN ('paid','awaiting_dispatch','completed')),0)::text AS revenue_mtd,
        count(*) FILTER (WHERE status = 'pending_payment')::int AS pending_payment_count,
        COALESCE(ROUND(
          SUM(total_ngn) FILTER (WHERE status IN ('paid','awaiting_dispatch','completed'))
          / NULLIF(count(*) FILTER (WHERE status IN ('paid','awaiting_dispatch','completed')), 0)
        , 2), 0)::text AS avg_order_value
       FROM ${t(brand, "sales_orders")}
      WHERE true ${range}`,
    params,
  );
  // Open quotations (awaiting customer action).
  const { rows: q } = await query(
    `SELECT count(*)::int AS open_quotes
       FROM ${t(brand, "quotations")}
      WHERE status IN ('sent','viewed')`,
  );
  return { ...rows[0], open_quotes: q[0].open_quotes };
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

// ── Saved Reports (F-12) ──────────────────────────────────

async function listSavedReports({
  brand,
  user_id,
  category,
  page = 1,
  page_size = 20,
  offset = 0,
}) {
  const where = [`is_active = true`, `(created_by = $1 OR is_shared = true)`];
  const params = [user_id];
  let i = 2;
  if (category) {
    where.push(`report_category = $${i++}`);
    params.push(category);
  }
  const { rows: c } = await query(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "saved_reports")} WHERE ${where.join(" AND ")}`,
    params,
  );
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "saved_reports")} WHERE ${where.join(" AND ")} ORDER BY last_run_at DESC NULLS LAST, created_at DESC LIMIT $${i++} OFFSET $${i++}`,
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

async function getSavedReport({ brand, id }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "saved_reports")} WHERE report_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function createSavedReport({ brand, report }) {
  const { rows } = await query(
    `INSERT INTO ${t(brand, "saved_reports")}
       (report_key, display_name, description, report_category, created_by, is_shared, base_query_key, config, default_format)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) RETURNING *`,
    [
      report.report_key,
      report.display_name,
      report.description || null,
      report.report_category,
      report.created_by || null,
      report.is_shared || false,
      report.base_query_key || null,
      JSON.stringify(report.config || {}),
      report.default_format || "pdf",
    ],
  );
  return rows[0];
}

async function updateSavedReport({ brand, id, patch }) {
  const cols = [
    "display_name",
    "description",
    "is_shared",
    "base_query_key",
    "config",
    "default_format",
    "is_active",
  ];
  const sets = [];
  const params = [id];
  let i = 2;
  for (const col of cols) {
    if (patch[col] === undefined) continue;
    const val = col === "config" ? JSON.stringify(patch[col]) : patch[col];
    sets.push(`${col} = ${col === "config" ? `$${i++}::jsonb` : `$${i++}`}`);
    params.push(val);
  }
  if (!sets.length) return getSavedReport({ brand, id });
  const { rows } = await query(
    `UPDATE ${t(brand, "saved_reports")} SET ${sets.join(",")} WHERE report_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function deleteSavedReport({ brand, id }) {
  await query(
    `UPDATE ${t(brand, "saved_reports")} SET is_active = false WHERE report_id = $1`,
    [id],
  );
}

// ── Dashboard Configs (F-12) ──────────────────────────────

async function listDashboardConfigs({ brand, user_id }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "dashboard_configs")} WHERE user_id = $1 ORDER BY display_order, created_at`,
    [user_id],
  );
  return rows;
}

async function getDashboardConfig({ brand, id }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "dashboard_configs")} WHERE dashboard_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function createDashboardConfig({ brand, config }) {
  const { rows } = await query(
    `INSERT INTO ${t(brand, "dashboard_configs")} (user_id, display_name, description, layout, is_default, is_shared, display_order)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7) RETURNING *`,
    [
      config.user_id,
      config.display_name,
      config.description || null,
      JSON.stringify(config.layout || []),
      config.is_default || false,
      config.is_shared || false,
      config.display_order || 0,
    ],
  );
  return rows[0];
}

async function updateDashboardConfig({ brand, id, patch }) {
  const cols = [
    "display_name",
    "description",
    "layout",
    "is_default",
    "is_shared",
    "display_order",
  ];
  const sets = [];
  const params = [id];
  let i = 2;
  for (const col of cols) {
    if (patch[col] === undefined) continue;
    const val = col === "layout" ? JSON.stringify(patch[col]) : patch[col];
    sets.push(`${col} = ${col === "layout" ? `$${i++}::jsonb` : `$${i++}`}`);
    params.push(val);
  }
  if (!sets.length) return getDashboardConfig({ brand, id });
  const { rows } = await query(
    `UPDATE ${t(brand, "dashboard_configs")} SET ${sets.join(",")} WHERE dashboard_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function deleteDashboardConfig({ brand, id }) {
  await query(
    `DELETE FROM ${t(brand, "dashboard_configs")} WHERE dashboard_id = $1`,
    [id],
  );
}

// ── Dashboard Widgets ─────────────────────────────────────

async function listWidgets({ brand, active_only = true }) {
  const w = active_only ? "WHERE is_active = true" : "";
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "dashboard_widgets")} ${w} ORDER BY display_name`,
  );
  return rows;
}

async function createWidget({ brand, widget }) {
  const { rows } = await query(
    `INSERT INTO ${t(brand, "dashboard_widgets")}
       (widget_key, display_name, description, widget_type, query_type, sql_query, module_key, refresh_seconds, display_config, required_permission)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,300),$9::jsonb,$10) RETURNING *`,
    [
      widget.widget_key,
      widget.display_name,
      widget.description || null,
      widget.widget_type,
      widget.query_type || "module_built_in",
      widget.sql_query || null,
      widget.module_key || null,
      widget.refresh_seconds,
      JSON.stringify(widget.display_config || {}),
      widget.required_permission || null,
    ],
  );
  return rows[0];
}

async function updateWidget({ brand, id, patch }) {
  const cols = [
    "display_name",
    "description",
    "refresh_seconds",
    "display_config",
    "required_permission",
    "is_active",
  ];
  const sets = [];
  const params = [id];
  let i = 2;
  for (const col of cols) {
    if (patch[col] === undefined) continue;
    const val =
      col === "display_config" ? JSON.stringify(patch[col]) : patch[col];
    sets.push(
      `${col} = ${col === "display_config" ? `$${i++}::jsonb` : `$${i++}`}`,
    );
    params.push(val);
  }
  if (!sets.length) return null;
  const { rows } = await query(
    `UPDATE ${t(brand, "dashboard_widgets")} SET ${sets.join(",")} WHERE widget_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── Report Templates (U-3) ────────────────────────────────

async function listReportTemplates({ brand, active_only = true }) {
  const w = active_only ? "WHERE is_active = true" : "";
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "report_templates")} ${w} ORDER BY cadence, display_name`,
  );
  return rows;
}

async function getReportTemplate({ brand, id }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "report_templates")} WHERE template_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function createReportTemplate({ brand, template }) {
  const { rows } = await query(
    `INSERT INTO ${t(brand, "report_templates")}
       (template_key, display_name, description, cadence, scheduled_day_of_week, scheduled_hour,
        default_recipient_role_ids, sections, output_formats, requires_staff_confirmation, delivery_method, is_system_template)
     VALUES ($1,$2,$3,$4,$5,$6,$7::uuid[],$8::jsonb,$9::text[],COALESCE($10,true),$11::text[],COALESCE($12,false))
     RETURNING *`,
    [
      template.template_key,
      template.display_name,
      template.description || null,
      template.cadence,
      template.scheduled_day_of_week ?? null,
      template.scheduled_hour ?? null,
      `{${(template.default_recipient_role_ids || []).join(",")}}`,
      JSON.stringify(template.sections || []),
      `{${(template.output_formats || ["pdf", "html"]).join(",")}}`,
      template.requires_staff_confirmation,
      `{${(template.delivery_method || ["email", "in_app"]).join(",")}}`,
      template.is_system_template,
    ],
  );
  return rows[0];
}

async function updateReportTemplate({ brand, id, patch }) {
  const updatable = [
    "display_name",
    "description",
    "cadence",
    "scheduled_day_of_week",
    "scheduled_hour",
    "requires_staff_confirmation",
    "is_active",
    "next_run_at",
  ];
  const sets = [];
  const params = [id];
  let i = 2;
  for (const col of updatable) {
    if (patch[col] === undefined) continue;
    sets.push(`${col} = $${i++}`);
    params.push(patch[col]);
  }
  if (!sets.length) return getReportTemplate({ brand, id });
  const { rows } = await query(
    `UPDATE ${t(brand, "report_templates")} SET ${sets.join(",")} WHERE template_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── Report Runs ───────────────────────────────────────────

async function listReportRuns({
  brand,
  filters = {},
  page = 1,
  page_size = 20,
  offset = 0,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (filters.status) {
    where.push(`rr.status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.template_id) {
    where.push(`rr.report_template_id = $${i++}`);
    params.push(filters.template_id);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows: c } = await query(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "report_runs")} rr ${w}`,
    params,
  );
  const { rows } = await query(
    `SELECT rr.*, rt.display_name AS template_name
       FROM ${t(brand, "report_runs")} rr
       LEFT JOIN ${t(brand, "report_templates")} rt ON rt.template_id = rr.report_template_id
      ${w} ORDER BY rr.created_at DESC LIMIT $${i++} OFFSET $${i++}`,
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

async function getReportRun({ brand, id }) {
  const { rows } = await query(
    `SELECT rr.*, rt.display_name AS template_name
       FROM ${t(brand, "report_runs")} rr
       LEFT JOIN ${t(brand, "report_templates")} rt ON rt.template_id = rr.report_template_id
      WHERE rr.run_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { rows: outputs } = await query(
    `SELECT * FROM ${t(brand, "report_run_outputs")} WHERE run_id = $1`,
    [id],
  );
  return { ...rows[0], outputs };
}

async function confirmReportRun({ brand, id, user_id, notes }) {
  const { rows } = await query(
    `UPDATE ${t(brand, "report_runs")} SET status = 'confirmed', confirmed_by = $2, confirmed_at = now(), confirmation_notes = $3
      WHERE run_id = $1 AND status = 'needs_confirmation' RETURNING *`,
    [id, user_id, notes || null],
  );
  return rows[0] || null;
}

module.exports = {
  salesKpis,
  opsKpis,
  listBriefings,
  getBriefing,
  markBriefingRead,
  listSavedReports,
  getSavedReport,
  createSavedReport,
  updateSavedReport,
  deleteSavedReport,
  listDashboardConfigs,
  getDashboardConfig,
  createDashboardConfig,
  updateDashboardConfig,
  deleteDashboardConfig,
  listWidgets,
  createWidget,
  updateWidget,
  listReportTemplates,
  getReportTemplate,
  createReportTemplate,
  updateReportTemplate,
  listReportRuns,
  getReportRun,
  confirmReportRun,
};
