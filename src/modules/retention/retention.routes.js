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
const strategyRouter = require("./strategy.routes");
const rewardsRouter = require("./rewards.routes");
const earnRouter = require("./earn.routes");
const referralAdminRouter = require("./referral-admin.routes");
const analyticsRouter = require("./analytics.routes");
const maintenanceRouter = require("./maintenance.routes");
const { requirePermission } = require("../../middleware/rbac");

// Side-effect: register order.paid → loyalty + streak earners + strategy spine.
require("./retention.subscribers");

const router = express.Router();
const can = (action) => requirePermission("retention", action);

// Coupon code engine (F-3 / §6.23.2)
router.use("/coupons", couponRouter);
// Bundle offers (F-2 / §6.23.4)
router.use("/bundles", bundleRouter);
// Wig subscriptions (F-1 / §6.23.5)
router.use("/subscriptions", subscriptionRouter);
// Automated retention workflows (F-4 / §6.23) — legacy single-action engine
router.use("/workflows", workflowRouter);
// Retention strategy engine (multi-step journeys; the no-code evolution)
router.use("/strategies", strategyRouter);
// Loyalty rewards catalogue + redemption (§6.23 economy)
router.use("/rewards", rewardsRouter);
// Loyalty earn-rules admin (§6.23 economy)
router.use("/earn-rules", earnRouter);
// Referral programme admin: settings + ladder + dashboard (§6.23)
router.use("/referral-program", referralAdminRouter);
// Retention analytics dashboard (§6.23.7)
router.use("/analytics", analyticsRouter);
// Maintenance plans (Faitlyn salon subscriptions, §6.23)
router.use("/maintenance", maintenanceRouter);

// Loyalty
router.get("/loyalty/tiers", can("view"), controller.listTiers);
router.post("/loyalty/tiers", can("create"), validator.validateTierCreate, controller.createTier);
router.patch(
  "/loyalty/tiers/:id",
  can("edit"),
  validator.validateTierUpdate,
  controller.updateTier,
);
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
