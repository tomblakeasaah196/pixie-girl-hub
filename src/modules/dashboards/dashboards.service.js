/**
 * Dashboards (V2.2 §6.20) — business logic.
 *
 * Role-based KPI dashboards. The overview composes the live spine (sales +
 * ops aggregates) with the AI Insights open-counts (the cross-module
 * connection) and the latest AI briefing. Briefings are produced by the AI
 * layer; here they are read + marked read.
 */

"use strict";

const repo = require("./dashboards.repo");
const insights = require("../ai_insights/insights.service");
const { NotFoundError } = require("../../utils/errors");

/**
 * Month-to-date window in the business timezone (Africa/Lagos, fixed UTC+1).
 * The overview "Revenue this month" tile is genuinely month-to-date so the
 * figure matches the label — a prior 30-day rolling default was silently shown
 * under an "MTD" label, and (separately) the sales object exposed *_mtd field
 * names the client never read. Both are fixed here.
 */
function monthToDateRange() {
  const now = new Date();
  const lagos = new Date(now.getTime() + 60 * 60 * 1000); // shift into Lagos
  // 00:00 Lagos on the 1st == 23:00 UTC on the last day of the prior month.
  const from = new Date(
    Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), 1) - 60 * 60 * 1000,
  );
  return { from: from.toISOString(), to: now.toISOString() };
}

async function overview({ brand, user, from, to }) {
  const mtd = monthToDateRange();
  const range = { from: from || mtd.from, to: to || mtd.to };
  const [sales, ops, snapshots, insightCounts, briefings] = await Promise.all([
    repo.salesKpis({ brand, from: range.from, to: range.to }),
    repo.opsKpis({ brand }),
    repo.overviewSnapshots({ brand }),
    insights.summary({ brand }),
    repo.listBriefings({ brand, recipient_user_id: user.user_id, limit: 1 }),
  ]);
  return {
    period: range,
    // The client reads paid_orders / cash_collected_ngn / order_value_ngn /
    // pending_orders / outstanding_ngn (see apps/admin useCommandCenter
    // DashboardOverview). The KPI repo returns *_mtd / pending_payment_count
    // and no outstanding, so map them here — otherwise every money/count tile
    // silently renders 0.
    //
    // The monthly money headline is CASH COLLECTED (payment rows in the window),
    // not gross order value: the tile used to read `revenue_ngn` mapped from a
    // `SUM(total_ngn)` over revenue-state orders, which is what was SOLD, not
    // what was received. Gross order value is still exposed — under its own
    // accurate name — so nothing that needs it loses it.
    sales: {
      ...sales,
      paid_orders: sales.orders_mtd,
      cash_collected_ngn: sales.cash_collected_mtd,
      order_value_ngn: sales.order_value_mtd,
      pending_orders: snapshots.pending_orders,
      outstanding_ngn: snapshots.outstanding_ngn,
    },
    operations: ops,
    insights: insightCounts,
    latest_briefing: briefings[0] || null,
  };
}

function salesKpis({ brand, from, to }) {
  return repo.salesKpis({ brand, from, to });
}
function opsKpis({ brand }) {
  return repo.opsKpis({ brand });
}
function listBriefings({ brand, user }) {
  return repo.listBriefings({ brand, recipient_user_id: user.user_id });
}
async function getBriefing({ id }) {
  const b = await repo.getBriefing({ id });
  if (!b) throw new NotFoundError("Briefing");
  return b;
}
async function markBriefingRead({ id }) {
  const b = await repo.markBriefingRead({ id });
  if (!b) throw new NotFoundError("Briefing");
  return b;
}

// ── Saved Reports (F-12) ──────────────────────────────────

function listSavedReports({ brand, user, category, page = 1, page_size = 20 }) {
  const offset = (page - 1) * page_size;
  return repo.listSavedReports({
    brand,
    user_id: user.user_id,
    category,
    page,
    page_size,
    offset,
  });
}

async function getSavedReport({ brand, id }) {
  const r = await repo.getSavedReport({ brand, id });
  if (!r) throw new NotFoundError("Saved report");
  return r;
}

function createSavedReport({ brand, user, input }) {
  return repo.createSavedReport({
    brand,
    report: { ...input, created_by: user.user_id },
  });
}

async function updateSavedReport({ brand, id, patch }) {
  const r = await repo.updateSavedReport({ brand, id, patch });
  if (!r) throw new NotFoundError("Saved report");
  return r;
}

function deleteSavedReport({ brand, id }) {
  return repo.deleteSavedReport({ brand, id });
}

// ── Dashboard Configs (F-12) ──────────────────────────────

function listDashboardConfigs({ brand, user }) {
  return repo.listDashboardConfigs({ brand, user_id: user.user_id });
}

async function getDashboardConfig({ brand, id }) {
  const d = await repo.getDashboardConfig({ brand, id });
  if (!d) throw new NotFoundError("Dashboard config");
  return d;
}

function createDashboardConfig({ brand, user, input }) {
  return repo.createDashboardConfig({
    brand,
    config: { ...input, user_id: user.user_id },
  });
}

async function updateDashboardConfig({ brand, id, patch }) {
  const d = await repo.updateDashboardConfig({ brand, id, patch });
  if (!d) throw new NotFoundError("Dashboard config");
  return d;
}

function deleteDashboardConfig({ brand, id }) {
  return repo.deleteDashboardConfig({ brand, id });
}

// ── Widgets (admin) ───────────────────────────────────────

function listWidgets({ brand }) {
  return repo.listWidgets({ brand });
}

function createWidget({ brand, input }) {
  return repo.createWidget({ brand, widget: input });
}

async function updateWidget({ brand, id, patch }) {
  const w = await repo.updateWidget({ brand, id, patch });
  if (!w) throw new NotFoundError("Widget");
  return w;
}

// ── Report Templates (U-3) ────────────────────────────────

function listReportTemplates({ brand }) {
  return repo.listReportTemplates({ brand });
}

async function getReportTemplate({ brand, id }) {
  const t = await repo.getReportTemplate({ brand, id });
  if (!t) throw new NotFoundError("Report template");
  return t;
}

function createReportTemplate({ brand, input }) {
  return repo.createReportTemplate({ brand, template: input });
}

async function updateReportTemplate({ brand, id, patch }) {
  const t = await repo.updateReportTemplate({ brand, id, patch });
  if (!t) throw new NotFoundError("Report template");
  return t;
}

// ── Report Runs ───────────────────────────────────────────

function listReportRuns({ brand, filters, page = 1, page_size = 20 }) {
  const offset = (page - 1) * page_size;
  return repo.listReportRuns({ brand, filters, page, page_size, offset });
}

async function getReportRun({ brand, id }) {
  const r = await repo.getReportRun({ brand, id });
  if (!r) throw new NotFoundError("Report run");
  return r;
}

async function confirmReportRun({ brand, user, id, notes }) {
  const r = await repo.confirmReportRun({
    brand,
    id,
    user_id: user.user_id,
    notes,
  });
  if (!r) throw new NotFoundError("Report run (or already confirmed)");
  return r;
}

/**
 * Queue a PDF render of a report run (J-7). Flattens the run + its outputs into
 * report sections and enqueues the report-generate job; the worker renders it
 * via headless Chromium and stores it against the run (reference_type
 * 'report_run'). Returns immediately — the document appears once the job runs.
 */
async function generateReportRunPdf({ brand, user, id }) {
  const { enqueue } = require("../../jobs/queue-producer");
  const run = await repo.getReportRun({ brand, id });
  if (!run) throw new NotFoundError("Report run");

  const title = run.template_name || run.report_type || "Report";
  const sections = [
    {
      heading: "Summary",
      rows: [
        ["Report", title],
        [
          "Period",
          `${run.period_start || run.period_label || ""} → ${run.period_end || ""}`.trim(),
        ],
        ["Status", run.status],
        ["Generated", run.created_at],
      ],
    },
  ];
  for (const o of run.outputs || []) {
    const payload =
      o.output_json ?? o.data ?? o.payload ?? o.content ?? o.result ?? {};
    const rows = Object.entries(payload)
      .filter(([, v]) => v === null || typeof v !== "object")
      .map(([k, v]) => [k, v === null || v === undefined ? "" : String(v)]);
    if (rows.length)
      sections.push({
        heading: o.output_label || o.section_key || o.label || "Detail",
        rows,
      });
  }

  await enqueue("report-generate", "report.pdf", {
    brand,
    title,
    subtitle: run.template_name ? run.report_type || undefined : undefined,
    sections,
    reference_type: "report_run",
    reference_id: run.run_id,
    user_id: user ? user.user_id : null,
  });
  return { queued: true, run_id: run.run_id };
}

module.exports = {
  overview,
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
  generateReportRunPdf,
};
