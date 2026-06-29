/**
 * Referral programme admin (Module 6.23) — authenticated routes.
 * Mounted at /api/v1/retention/referral-program. Permission key: retention.
 */

"use strict";

const express = require("express");
const controller = require("./referral-admin.controller");
const validator = require("./referral-admin.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("retention", action);

router.get("/settings", can("view"), controller.getSettings);
router.put("/settings", can("edit"), validator.validateSettings, controller.saveSettings);
router.get("/dashboard", can("view"), controller.dashboard);
router.get("/tiers", can("view"), controller.listTiers);
router.post("/tiers", can("create"), validator.validateTier, controller.createTier);
router.patch("/tiers/:id", can("edit"), validator.validateTierUpdate, controller.updateTier);
router.delete("/tiers/:id", can("delete"), controller.deleteTier);

module.exports = router;
