/**
 * Production & Landed Cost (V2.2 §6.24) — routes. Mounted at /api/v1/production.
 * Permission key: production. Production runs (factory→Lagos→styled, landed
 * cost). Finished goods post to Stock. Service jobs live in /api/v1/service-jobs.
 */

"use strict";

const express = require("express");
const controller = require("./production.controller");
const validator = require("./production.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("production", action);

// ── Production runs ───────────────────────────────────────
router.get("/", can("view"), controller.listRuns);
// Rate lookup for the cost form's NGN preview. Must sit above /:id so
// "fx-rate" is never read as a run id.
router.get("/fx-rate", can("view"), controller.fxRate);
router.post(
  "/",
  can("create"),
  validator.validateRunCreate,
  controller.openRun,
);
router.get("/:id", can("view"), controller.getRun);
router.post(
  "/:id/advance",
  can("edit"),
  validator.validateRunAdvance,
  controller.advanceRun,
);
router.post(
  "/:id/costs",
  can("edit"),
  validator.validateCostAdd,
  controller.addCostComponent,
);
router.post(
  "/:id/products",
  can("edit"),
  validator.validateProductsAdd,
  controller.addProducts,
);
router.post(
  "/:id/units",
  can("edit"),
  validator.validateUnitAdd,
  controller.addUnit,
);
// Receiving posts a production_in movement into a Lagos location, so it needs
// stock rights on top of production rights — a China factory manager runs the
// batch but does not book goods into the Lagos warehouse.
router.post(
  "/:id/receive",
  can("edit"),
  requirePermission("stock", "edit"),
  validator.validateReceive,
  controller.receiveProduction,
);

// ── Landed-cost breakdown (F-7a) ──────────────────────────
router.get("/:id/landed-cost", can("view"), controller.getLandedCost);
router.post(
  "/:id/landed-cost/recompute",
  can("edit"),
  controller.refreshLandedCost,
);

// ── Rework events (F-7b) ──────────────────────────────────
router.get("/:id/rework", can("view"), controller.listRework);
router.post(
  "/:id/units/:unitId/rework",
  can("edit"),
  validator.validateReworkAdd,
  controller.recordRework,
);

module.exports = router;
