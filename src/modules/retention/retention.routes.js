/**
 * Customer Retention & Loyalty + Streak Stars + Hair Quiz (V2.2 §6.23) —
 * authenticated routes. Mounted at /api/v1/retention. Permission key:
 * retention. (Public referral + hair-quiz endpoints live in their own
 * routers under /api/public.)
 */

"use strict";

const express = require("express");
const controller = require("./retention.controller");
const validator = require("./retention.validator");
const { requirePermission } = require("../../middleware/rbac");

// Side-effect: register order.paid → loyalty + streak earners.
require("./retention.subscribers");

const router = express.Router();
const can = (action) => requirePermission("retention", action);

// Loyalty
router.get("/loyalty/tiers", can("view"), controller.listTiers);
router.get("/customers/:contactId/loyalty", can("view"), controller.getLoyalty);
router.post(
  "/customers/:contactId/loyalty/redeem",
  can("edit"),
  validator.validateRedeem,
  controller.redeemLoyalty,
);
router.post(
  "/customers/:contactId/loyalty/adjust",
  can("approve"),
  validator.validateAdjust,
  controller.adjustLoyalty,
);

// Streak Stars
router.get("/streak/tiers", can("view"), controller.listStreakTiers);
router.get("/customers/:contactId/streak", can("view"), controller.getStreak);
router.post(
  "/customers/:contactId/streak/award",
  can("approve"),
  validator.validateAwardStreak,
  controller.awardStreak,
);

// Referral
router.get(
  "/customers/:contactId/referral",
  can("view"),
  controller.getReferral,
);

module.exports = router;
