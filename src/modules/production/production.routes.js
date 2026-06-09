/**
 * Production & Landed Cost (V2.2 §6.24) — routes. Mounted at /api/v1/production.
 * Permission key: production. Production runs (factory→Lagos→styled, landed
 * cost) + service jobs (styling). Finished goods post to Stock; deposit-
 * triggered orders open a service job via the order.deposit_met subscriber.
 */

"use strict";

const express = require("express");
const controller = require("./production.controller");
const validator = require("./production.validator");
const { requirePermission } = require("../../middleware/rbac");

// Side-effect: register order.deposit_met → styling service job (G-1).
require("./production.subscribers");

const router = express.Router();
const can = (action) => requirePermission("production", action);

// ── Production runs ───────────────────────────────────────
router.get("/runs", can("view"), controller.listRuns);
router.post(
  "/runs",
  can("create"),
  validator.validateRunCreate,
  controller.openRun,
);
router.get("/runs/:id", can("view"), controller.getRun);
router.post(
  "/runs/:id/advance",
  can("edit"),
  validator.validateRunAdvance,
  controller.advanceRun,
);
router.post(
  "/runs/:id/costs",
  can("edit"),
  validator.validateCostAdd,
  controller.addCostComponent,
);
router.post(
  "/runs/:id/units",
  can("edit"),
  validator.validateUnitAdd,
  controller.addUnit,
);
router.post(
  "/runs/:id/receive",
  can("edit"),
  validator.validateReceive,
  controller.receiveProduction,
);

// ── Service jobs ──────────────────────────────────────────
router.get("/service-jobs", can("view"), controller.listServiceJobs);
router.post(
  "/service-jobs",
  can("create"),
  validator.validateServiceJobCreate,
  controller.createServiceJob,
);
router.get("/service-jobs/:id", can("view"), controller.getServiceJob);
router.post(
  "/service-jobs/:id/advance",
  can("edit"),
  validator.validateServiceJobAdvance,
  controller.advanceServiceJob,
);

module.exports = router;
