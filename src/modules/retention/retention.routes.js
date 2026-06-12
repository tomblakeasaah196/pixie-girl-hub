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
const couponRouter = require("./coupon.routes");
const bundleRouter = require("./bundle.routes");
const subscriptionRouter = require("./subscription.routes");
const workflowRouter = require("./workflow.routes");
const { requirePermission } = require("../../middleware/rbac");

// Side-effect: register order.paid → loyalty + streak earners.
require("./retention.subscribers");

const router = express.Router();
const can = (action) => requirePermission("retention", action);

// Coupon code engine (F-3 / §6.23.2)
router.use("/coupons", couponRouter);
// Bundle offers (F-2 / §6.23.4)
router.use("/bundles", bundleRouter);
// Wig subscriptions (F-1 / §6.23.5)
router.use("/subscriptions", subscriptionRouter);
// Automated retention workflows (F-4 / §6.23)
router.use("/workflows", workflowRouter);

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
