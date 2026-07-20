/**
 * Crowns 👑 — unified loyalty + streak economy (Module 6.23). Authenticated
 * admin/staff routes, mounted at /api/v1/retention/crowns. Permission key:
 * retention. (Customer-facing storefront + wallet routes arrive with the UI PR.)
 */

"use strict";

const express = require("express");
const controller = require("./crown.controller");
const validator = require("./crown.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("retention", action);

// Programme config (tier ladder + earn rules + streak defs).
router.get("/tiers", can("view"), controller.listTiers);
router.post("/tiers", can("create"), validator.validateTierCreate, controller.createTier);
router.patch("/tiers/:id", can("edit"), validator.validateTierUpdate, controller.updateTier);
router.get("/earn-rules", can("view"), controller.listRules);
router.post("/earn-rules", can("create"), validator.validateRuleCreate, controller.createRule);
router.patch("/earn-rules/:id", can("edit"), validator.validateRuleUpdate, controller.updateRule);
router.get("/streak-config", can("view"), controller.listStreakConfig);

// Per-customer wallet + checkout entitlement.
router.get("/customers/:contactId", can("view"), controller.getWallet);
router.get("/customers/:contactId/discount", can("view"), controller.getDiscount);
router.post("/customers/:contactId/adjust", can("approve"), validator.validateAdjust, controller.adjust);
router.post("/customers/:contactId/check-in", can("edit"), controller.checkIn);
router.post(
  "/customers/:contactId/submit",
  can("edit"),
  validator.validateSubmitAction,
  controller.submitAction,
);

// Verification queue (honor auto-approves; manual proof waits for a staffer).
router.get("/submissions", can("view"), controller.listSubmissions);
router.post(
  "/submissions/:id/review",
  can("approve"),
  validator.validateReviewSubmission,
  controller.reviewSubmission,
);

module.exports = router;
