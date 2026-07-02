/**
 * Faitlyn Service Job Tracker (V2.2 §6.24) — routes. Mounted at
 * /api/v1/service-jobs. Permission key: service_jobs.
 *
 * Requiring the subscriber here registers `order.deposit_met → service job`
 * once at boot (side-effect import; moved out of Production).
 */

"use strict";

const express = require("express");
const c = require("./service-jobs.controller");
const v = require("./service-jobs.validator");
const { requirePermission } = require("../../middleware/rbac");
require("./service-jobs.subscribers");

const router = express.Router();
const can = (action) => requirePermission("service_jobs", action);

// ── Service types (literal segment before /:id) ────────────
router.get("/types", can("view"), c.listServiceTypes);
router.post(
  "/types",
  can("create"),
  v.validateServiceTypeCreate,
  c.createServiceType,
);
router.patch(
  "/types/:id",
  can("edit"),
  v.validateServiceTypeUpdate,
  c.updateServiceType,
);

// ── Chemical recipes (F-7c) — literal segment before /:id ──
router.get("/recipes", can("view"), c.listRecipes);
router.post("/recipes", can("create"), v.validateRecipeCreate, c.createRecipe);
router.get("/recipes/:id", can("view"), c.getRecipe);
router.patch(
  "/recipes/:id",
  can("edit"),
  v.validateRecipeUpdate,
  c.updateRecipe,
);

// ── Monthly chemical reconciliation (F-7e) ─────────────────
router.get("/chemical-reconciliations", can("view"), c.listReconciliations);
router.post(
  "/periods/:periodId/chemical-reconciliation",
  can("approve"),
  c.reconcileChemicals,
);

// ── Wig accountability (literal segments before /:id) ──────
router.get("/accountability", can("view"), c.getAccountability);
router.get("/accountability/ledger", can("view"), c.listCustodyLedger);

// ── Jobs ───────────────────────────────────────────────────
router.get("/", can("view"), c.listJobs);
router.post("/", can("create"), v.validateJobCreate, c.createJob);
router.get("/:id", can("view"), c.getJob);
router.patch("/:id", can("edit"), v.validateJobUpdate, c.updateJob);
router.post("/:id/advance", can("edit"), v.validateJobAdvance, c.advanceJob);
router.post("/:id/assign", can("edit"), v.validateAssignStaff, c.assignStaff);
router.post("/:id/outcome", can("edit"), v.validateOutcome, c.recordOutcome);

// ── Stylist Studio (PR2) lifecycle ─────────────────────────
router.post("/:id/start", can("edit"), c.startWork);
router.post("/:id/pause", can("edit"), c.pauseWork);
router.post("/:id/resume", can("edit"), c.resumeWork);
router.post("/:id/return", can("edit"), c.returnForQc);
router.post("/:id/qc", can("edit"), v.validateQc, c.recordQc);
router.post("/:id/dispatch", can("edit"), c.dispatch);
router.post("/:id/hand-to-sales", can("edit"), c.handToSales);
// Flow-1: bind a cross-entity styling job to its matched IC styling invoice.
router.post(
  "/:id/intercompany-link",
  can("edit"),
  v.validateIntercompanyLink,
  c.linkIntercompany,
);
router.post(
  "/:id/write-off",
  can("approve"),
  v.validateWriteOff,
  c.writeOffWig,
);

// ── Materials / references / time logs ─────────────────────
router.get("/:id/materials", can("view"), c.listMaterials);
router.post(
  "/:id/materials",
  can("edit"),
  v.validateMaterialLog,
  c.logMaterial,
);
router.get("/:id/references", can("view"), c.listReferences);
router.post(
  "/:id/references",
  can("edit"),
  v.validateReferenceAdd,
  c.addReference,
);
router.delete("/:id/references/:refId", can("edit"), c.removeReference);
router.get("/:id/time-logs", can("view"), c.listTimeLogs);

// ── Service-job chemical consumption (F-7d) ────────────────
router.get("/:id/chemicals", can("view"), c.listChemicals);
router.post(
  "/:id/chemicals",
  can("edit"),
  v.validateChemicalRecord,
  c.recordChemical,
);

module.exports = router;
