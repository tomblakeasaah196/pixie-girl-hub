/**
 * CRM (V2.2 §6.1) — routes. Mounted at /api/v1/crm. Permission key: crm.
 */

"use strict";

const express = require("express");
const c = require("./crm.controller");
const v = require("./crm.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (a) => requirePermission("crm", a);

// Dashboard KPIs (literal — before any :id route)
router.get("/kpis", can("view"), c.kpis);

// Clients (contacts + commercial roll-up) and the Today outreach buckets
router.get("/clients", can("view"), c.listClients);
router.get("/today", can("view"), c.today);

// Reports (BI: LTV ranking, cohort retention, win/loss, velocity, forecast)
router.get("/reports/ltv", can("view"), c.reportLtv);
router.get("/reports/cohorts", can("view"), c.reportCohorts);
router.get("/reports/win-loss", can("view"), c.reportWinLoss);
router.get("/reports/velocity", can("view"), c.reportVelocity);
router.get("/reports/forecast", can("view"), c.reportForecast);

// Pipelines + stages
router.get("/pipelines", can("view"), c.listPipelines);
router.post(
  "/pipelines",
  can("create"),
  v.validatePipelineCreate,
  c.createPipeline,
);
router.patch(
  "/pipelines/:pipeId",
  can("edit"),
  v.validatePipelineUpdate,
  c.updatePipeline,
);
router.delete("/pipelines/:pipeId", can("delete"), c.archivePipeline);
router.get("/pipelines/:pipeId/stages", can("view"), c.listStages);
router.post(
  "/pipelines/:pipeId/stages",
  can("edit"),
  v.validateStageCreate,
  c.createStage,
);
router.patch(
  "/stages/:stageId",
  can("edit"),
  v.validateStageUpdate,
  c.updateStage,
);
router.delete("/stages/:stageId", can("delete"), c.deleteStage);

// Deals
router.get("/deals", can("view"), c.listDeals);
router.post("/deals", can("create"), v.validateDealCreate, c.createDeal);
router.get("/deals/:id", can("view"), c.getDeal);
router.patch("/deals/:id", can("edit"), v.validateDealUpdate, c.updateDeal);
router.post("/deals/:id/move", can("edit"), v.validateMoveStage, c.moveStage);
router.post("/deals/:id/status", can("edit"), v.validateSetStatus, c.setStatus);
router.delete("/deals/:id", can("delete"), c.deleteDeal);

// Stage history (append-only trail) + anticipated line items
router.get("/deals/:id/history", can("view"), c.listStageHistory);
router.get("/deals/:id/products", can("view"), c.listDealProducts);
router.post(
  "/deals/:id/products",
  can("edit"),
  v.validateDealProductCreate,
  c.addDealProduct,
);
router.patch(
  "/deals/:id/products/:dealProductId",
  can("edit"),
  v.validateDealProductUpdate,
  c.updateDealProduct,
);
router.delete(
  "/deals/:id/products/:dealProductId",
  can("delete"),
  c.deleteDealProduct,
);

// Activities + notes
router.get("/deals/:id/activities", can("view"), c.listActivities);
router.post(
  "/deals/:id/activities",
  can("edit"),
  v.validateActivityCreate,
  c.addActivity,
);
router.get("/deals/:id/notes", can("view"), c.listNotes);
router.post("/deals/:id/notes", can("edit"), v.validateNoteCreate, c.addNote);

// Customer profile (preferences / measurements / churn) — by contact
router.get("/customers/:contactId/preferences", can("view"), c.getPreferences);
router.put(
  "/customers/:contactId/preferences",
  can("edit"),
  v.validatePreferencesUpsert,
  c.upsertPreferences,
);
router.get(
  "/customers/:contactId/measurements",
  can("view"),
  c.listMeasurements,
);
router.post(
  "/customers/:contactId/measurements",
  can("edit"),
  v.validateMeasurementCreate,
  c.addMeasurement,
);
router.patch(
  "/customers/:contactId/measurements/:measurementId",
  can("edit"),
  v.validateMeasurementUpdate,
  c.updateMeasurement,
);
router.delete(
  "/customers/:contactId/measurements/:measurementId",
  can("delete"),
  c.deleteMeasurement,
);
// Contact-level activity log (calls/WhatsApp/emails on the 360 timeline)
router.get(
  "/customers/:contactId/activities",
  can("view"),
  c.listContactActivities,
);
router.post(
  "/customers/:contactId/activities",
  can("edit"),
  v.validateActivityCreate,
  c.addContactActivity,
);
// One-click win-back → retention strategy engine (`win_back` trigger)
router.post("/customers/:contactId/win-back", can("edit"), c.triggerWinBack);
router.get("/customers/:contactId/churn", can("view"), c.listChurnScores);
router.post(
  "/customers/:contactId/churn",
  can("edit"),
  v.validateChurnRecord,
  c.recordChurnScore,
);

module.exports = router;
