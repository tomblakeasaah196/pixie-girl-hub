/**
 * Dashboards (V2.2 §6.20) — routes. Mounted at /api/v1/dashboards.
 * Permission key: dashboards. Role-based KPI rollups over the live spine +
 * the AI briefings feed.
 */

"use strict";

const express = require("express");
const c = require("./dashboards.controller");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("dashboards", action);

router.get("/overview", can("view"), c.overview);
router.get("/kpis/sales", can("view"), c.salesKpis);
router.get("/kpis/operations", can("view"), c.opsKpis);

router.get("/briefings", can("view"), c.listBriefings);
router.get("/briefings/:id", can("view"), c.getBriefing);
router.post("/briefings/:id/read", can("view"), c.markBriefingRead);

// Saved Reports (F-12)
router.get("/saved-reports", can("view"), c.listSavedReports);
router.post("/saved-reports", can("edit"), c.createSavedReport);
router.get("/saved-reports/:id", can("view"), c.getSavedReport);
router.patch("/saved-reports/:id", can("edit"), c.updateSavedReport);
router.delete("/saved-reports/:id", can("edit"), c.deleteSavedReport);

// Dashboard Configs (F-12)
router.get("/configs", can("view"), c.listDashboardConfigs);
router.post("/configs", can("edit"), c.createDashboardConfig);
router.get("/configs/:id", can("view"), c.getDashboardConfig);
router.patch("/configs/:id", can("edit"), c.updateDashboardConfig);
router.delete("/configs/:id", can("edit"), c.deleteDashboardConfig);

// Widgets (admin)
router.get("/widgets", can("view"), c.listWidgets);
router.post("/widgets", can("admin"), c.createWidget);
router.patch("/widgets/:id", can("admin"), c.updateWidget);

// Report Templates (U-3)
router.get("/report-templates", can("view"), c.listReportTemplates);
router.post("/report-templates", can("admin"), c.createReportTemplate);
router.get("/report-templates/:id", can("view"), c.getReportTemplate);
router.patch("/report-templates/:id", can("admin"), c.updateReportTemplate);

// Report Runs
router.get("/report-runs", can("view"), c.listReportRuns);
router.get("/report-runs/:id", can("view"), c.getReportRun);
router.post("/report-runs/:id/confirm", can("approve"), c.confirmReportRun);

module.exports = router;
