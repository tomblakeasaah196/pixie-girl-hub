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

function defaultRange() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 3600 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

async function overview({ brand, user, from, to }) {
  const range = {
    from: from || defaultRange().from,
    to: to || defaultRange().to,
  };
  const [sales, ops, insightCounts, briefings] = await Promise.all([
    repo.salesKpis({ brand, from: range.from, to: range.to }),
    repo.opsKpis({ brand }),
    insights.summary({ brand }),
    repo.listBriefings({ brand, recipient_user_id: user.user_id, limit: 1 }),
  ]);
  return {
    period: range,
    sales,
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
      .map(([k, v]) => [k, v == null ? "" : String(v)]);
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
