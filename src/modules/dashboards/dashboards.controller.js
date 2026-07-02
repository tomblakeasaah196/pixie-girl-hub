/**
 * Dashboards (V2.2 §6.20) — HTTP controller.
 */

"use strict";

const service = require("./dashboards.service");
const metricsService = require("./dashboards.metrics.service");
const exportService = require("./dashboards.export");

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function sendWorkbook(res, { buffer, filename }) {
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", XLSX_MIME);
  res.send(buffer);
}

// ── Domain dashboards (§6.20 rebuild) ──────────────────────

async function listDomains(req, res) {
  res.json({
    data: await metricsService.listDomains({ brand: req.brand, user: req.user }),
  });
}

async function getDomain(req, res) {
  res.json({
    data: await metricsService.domainData({
      brand: req.brand,
      user: req.user,
      key: req.params.key,
      from: req.query.from,
      to: req.query.to,
    }),
  });
}

async function getDomainDetail(req, res) {
  const { data, columns, label, period, meta } =
    await metricsService.domainDetail({
      brand: req.brand,
      user: req.user,
      key: req.params.key,
      tableKey: req.params.table,
      from: req.query.from,
      to: req.query.to,
      filters: {
        status: req.query.status,
        sales_channel: req.query.sales_channel,
      },
      page: req.query.page,
      page_size: req.query.page_size,
    });
  res.json({ data, columns, label, period, meta });
}

async function exportDomainXlsx(req, res) {
  sendWorkbook(
    res,
    await exportService.exportDomain({
      brand: req.brand,
      user: req.user,
      key: req.params.key,
      from: req.query.from,
      to: req.query.to,
    }),
  );
}

async function getGlobal(req, res) {
  res.json({
    data: await metricsService.globalOverview({
      user: req.user,
      from: req.query.from,
      to: req.query.to,
    }),
  });
}

async function getPreferences(req, res) {
  res.json({
    data: await metricsService.getPreferences({
      brand: req.brand,
      user: req.user,
    }),
  });
}

async function putPreferences(req, res) {
  res.json({
    data: await metricsService.putPreferences({
      brand: req.brand,
      user: req.user,
      hidden_tiles: req.body.hidden_tiles,
    }),
  });
}

async function exportReportRunExcel(req, res) {
  const run = await service.getReportRun({ brand: req.brand, id: req.params.id });
  sendWorkbook(res, await exportService.exportReportRun({ run }));
}

async function overview(req, res) {
  res.json({
    data: await service.overview({
      brand: req.brand,
      user: req.user,
      from: req.query.from,
      to: req.query.to,
    }),
  });
}
async function salesKpis(req, res) {
  res.json({
    data: await service.salesKpis({
      brand: req.brand,
      from: req.query.from,
      to: req.query.to,
    }),
  });
}
async function opsKpis(req, res) {
  res.json({ data: await service.opsKpis({ brand: req.brand }) });
}
async function listBriefings(req, res) {
  res.json({
    data: await service.listBriefings({ brand: req.brand, user: req.user }),
  });
}
async function getBriefing(req, res) {
  res.json({ data: await service.getBriefing({ id: req.params.id }) });
}
async function markBriefingRead(req, res) {
  res.json({ data: await service.markBriefingRead({ id: req.params.id }) });
}

// ── Saved Reports ──────────────────────────────────────────
async function listSavedReports(req, res) {
  res.json({
    data: await service.listSavedReports({
      brand: req.brand,
      user: req.user,
      category: req.query.category,
      page: parseInt(req.query.page || "1", 10),
      page_size: parseInt(req.query.page_size || "20", 10),
    }),
  });
}
async function getSavedReport(req, res) {
  res.json({
    data: await service.getSavedReport({ brand: req.brand, id: req.params.id }),
  });
}
async function createSavedReport(req, res) {
  res.status(201).json({
    data: await service.createSavedReport({
      brand: req.brand,
      user: req.user,
      input: req.body,
    }),
  });
}
async function updateSavedReport(req, res) {
  res.json({
    data: await service.updateSavedReport({
      brand: req.brand,
      id: req.params.id,
      patch: req.body,
    }),
  });
}
async function deleteSavedReport(req, res) {
  await service.deleteSavedReport({ brand: req.brand, id: req.params.id });
  res.json({ data: { deleted: true } });
}

// ── Dashboard Configs ──────────────────────────────────────
async function listDashboardConfigs(req, res) {
  res.json({
    data: await service.listDashboardConfigs({
      brand: req.brand,
      user: req.user,
    }),
  });
}
async function getDashboardConfig(req, res) {
  res.json({
    data: await service.getDashboardConfig({
      brand: req.brand,
      id: req.params.id,
    }),
  });
}
async function createDashboardConfig(req, res) {
  res.status(201).json({
    data: await service.createDashboardConfig({
      brand: req.brand,
      user: req.user,
      input: req.body,
    }),
  });
}
async function updateDashboardConfig(req, res) {
  res.json({
    data: await service.updateDashboardConfig({
      brand: req.brand,
      id: req.params.id,
      patch: req.body,
    }),
  });
}
async function deleteDashboardConfig(req, res) {
  await service.deleteDashboardConfig({ brand: req.brand, id: req.params.id });
  res.json({ data: { deleted: true } });
}

// ── Widgets ────────────────────────────────────────────────
async function listWidgets(req, res) {
  res.json({ data: await service.listWidgets({ brand: req.brand }) });
}
async function createWidget(req, res) {
  res.status(201).json({
    data: await service.createWidget({ brand: req.brand, input: req.body }),
  });
}
async function updateWidget(req, res) {
  res.json({
    data: await service.updateWidget({
      brand: req.brand,
      id: req.params.id,
      patch: req.body,
    }),
  });
}

// ── Report Templates ───────────────────────────────────────
async function listReportTemplates(req, res) {
  res.json({ data: await service.listReportTemplates({ brand: req.brand }) });
}
async function getReportTemplate(req, res) {
  res.json({
    data: await service.getReportTemplate({
      brand: req.brand,
      id: req.params.id,
    }),
  });
}
async function createReportTemplate(req, res) {
  res.status(201).json({
    data: await service.createReportTemplate({
      brand: req.brand,
      input: req.body,
    }),
  });
}
async function updateReportTemplate(req, res) {
  res.json({
    data: await service.updateReportTemplate({
      brand: req.brand,
      id: req.params.id,
      patch: req.body,
    }),
  });
}

// ── Report Runs ────────────────────────────────────────────
async function listReportRuns(req, res) {
  res.json({
    data: await service.listReportRuns({
      brand: req.brand,
      filters: { status: req.query.status, template_id: req.query.template_id },
      page: parseInt(req.query.page || "1", 10),
      page_size: parseInt(req.query.page_size || "20", 10),
    }),
  });
}
async function getReportRun(req, res) {
  res.json({
    data: await service.getReportRun({ brand: req.brand, id: req.params.id }),
  });
}
async function confirmReportRun(req, res) {
  res.json({
    data: await service.confirmReportRun({
      brand: req.brand,
      user: req.user,
      id: req.params.id,
      notes: req.body.notes,
    }),
  });
}
async function generateReportRunPdf(req, res) {
  res.status(202).json({
    data: await service.generateReportRunPdf({
      brand: req.brand,
      user: req.user,
      id: req.params.id,
    }),
  });
}

module.exports = {
  listDomains,
  getDomain,
  getDomainDetail,
  exportDomainXlsx,
  getGlobal,
  getPreferences,
  putPreferences,
  exportReportRunExcel,
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
