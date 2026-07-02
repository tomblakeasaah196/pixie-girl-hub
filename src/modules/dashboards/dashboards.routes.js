/**
 * Dashboards (V2.2 §6.20) — routes. Mounted at /api/v1/dashboards.
 * Permission key: dashboards. Role-based KPI rollups over the live spine +
 * the AI briefings feed.
 */

"use strict";

const express = require("express");
const c = require("./dashboards.controller");
const v = require("./dashboards.validator");
const { requirePermission } = require("../../middleware/rbac");
const {
  requireDashboardView,
  requireDashboardExport,
} = require("./dashboards.access");

const router = express.Router();
const can = (action) => requirePermission("dashboards", action);
// VIEW admits the management circle: RBAC matrix OR org-chart rights
// (management position / dotted-line can_view_dashboards). Writes and
// exports stay matrix-only.
const view = requireDashboardView;

// ── Domain dashboards (§6.20: overview + 9 domains) ────────
router.get("/domains", view, c.listDomains);
router.get("/domains/:key", view, v.validatePeriodQuery, c.getDomain);
router.get(
  "/domains/:key/detail/:table",
  view,
  v.validateDetailQuery,
  c.getDomainDetail,
);
router.get(
  "/domains/:key/export",
  requireDashboardExport,
  v.validatePeriodQuery,
  c.exportDomainXlsx,
);
// CEO-only cross-entity rollup — the ONE place businesses aggregate.
router.get("/global", view, v.validatePeriodQuery, c.getGlobal);
// Per-user tile show/hide (fixed layout + personal visibility).
router.get("/preferences", view, c.getPreferences);
router.put("/preferences", view, v.validatePreferences, c.putPreferences);

router.get("/overview", view, c.overview);
router.get("/kpis/sales", view, c.salesKpis);
router.get("/kpis/operations", view, c.opsKpis);

router.get("/briefings", view, c.listBriefings);
router.get("/briefings/:id", view, c.getBriefing);
router.post("/briefings/:id/read", view, c.markBriefingRead);

// Saved Reports (F-12)
router.get("/saved-reports", view, c.listSavedReports);
router.post(
  "/saved-reports",
  can("edit"),
  v.validateSavedReportCreate,
  c.createSavedReport,
);
router.get("/saved-reports/:id", view, c.getSavedReport);
router.patch(
  "/saved-reports/:id",
  can("edit"),
  v.validateSavedReportUpdate,
  c.updateSavedReport,
);
router.delete("/saved-reports/:id", can("edit"), c.deleteSavedReport);

// Dashboard Configs (F-12)
router.get("/configs", view, c.listDashboardConfigs);
router.post(
  "/configs",
  can("edit"),
  v.validateDashboardConfigCreate,
  c.createDashboardConfig,
);
router.get("/configs/:id", view, c.getDashboardConfig);
router.patch(
  "/configs/:id",
  can("edit"),
  v.validateDashboardConfigUpdate,
  c.updateDashboardConfig,
);
router.delete("/configs/:id", can("edit"), c.deleteDashboardConfig);

// Widgets (admin-managed config; "admin" is not a valid RBAC action —
// requirePermission only accepts view/create/edit/delete/approve/export)
router.get("/widgets", view, c.listWidgets);
router.post("/widgets", can("create"), v.validateWidgetCreate, c.createWidget);
router.patch(
  "/widgets/:id",
  can("edit"),
  v.validateWidgetUpdate,
  c.updateWidget,
);

// Report Templates (U-3)
router.get("/report-templates", view, c.listReportTemplates);
router.post(
  "/report-templates",
  can("create"),
  v.validateReportTemplateCreate,
  c.createReportTemplate,
);
router.get("/report-templates/:id", view, c.getReportTemplate);
router.patch(
  "/report-templates/:id",
  can("edit"),
  v.validateReportTemplateUpdate,
  c.updateReportTemplate,
);

// Report Runs
router.get("/report-runs", view, c.listReportRuns);
router.get("/report-runs/:id", view, c.getReportRun);
router.post("/report-runs/:id/confirm", can("approve"), c.confirmReportRun);
router.post("/report-runs/:id/pdf", can("export"), c.generateReportRunPdf);
router.get(
  "/report-runs/:id/excel",
  requireDashboardExport,
  c.exportReportRunExcel,
);

module.exports = router;
