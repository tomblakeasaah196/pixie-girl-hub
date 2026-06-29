/**
 * Maintenance plans (Module 6.23) — authenticated routes.
 * Mounted at /api/v1/retention/maintenance. Permission key: retention.
 */

"use strict";

const express = require("express");
const controller = require("./maintenance.controller");
const validator = require("./maintenance.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("retention", action);

router.get("/plans", can("view"), controller.listPlans);
router.post("/plans", can("create"), validator.validateCreate, controller.createPlan);
router.patch("/plans/:id", can("edit"), validator.validateUpdate, controller.updatePlan);
router.get("/subscriptions", can("view"), controller.listSubscriptions);

module.exports = router;
