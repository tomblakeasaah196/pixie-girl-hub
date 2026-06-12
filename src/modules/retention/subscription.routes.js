/**
 * Wig subscription (F-1 / PD §6.23.5) — authenticated routes. Mounted under
 * /api/v1/retention/subscriptions. Permission key: retention.
 */

"use strict";

const express = require("express");
const controller = require("./subscription.controller");
const validator = require("./subscription.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("retention", action);

// Plans
router.get("/plans", can("view"), controller.listPlans);
router.post(
  "/plans",
  can("create"),
  validator.validatePlanCreate,
  controller.createPlan,
);
router.get("/plans/:id", can("view"), controller.getPlan);
router.patch(
  "/plans/:id",
  can("edit"),
  validator.validatePlanUpdate,
  controller.updatePlan,
);
router.patch(
  "/plans/:id/active",
  can("edit"),
  validator.validateActive,
  controller.setPlanActive,
);

// Subscriptions
router.get("/", can("view"), controller.listSubs);
router.post("/", can("create"), validator.validateEnrol, controller.enrol);
router.get("/:id", can("view"), controller.getSub);
router.post(
  "/:id/pause",
  can("edit"),
  validator.validateReason,
  controller.pause,
);
router.post("/:id/resume", can("edit"), controller.resume);
router.post(
  "/:id/cancel",
  can("edit"),
  validator.validateReason,
  controller.cancel,
);

module.exports = router;
