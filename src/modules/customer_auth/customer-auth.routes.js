/**
 * Customer auth - PUBLIC routes. Mounted at /api/public/auth.
 * Token model (Hub canon): access JWT in memory, refresh in httpOnly cookie.
 */

"use strict";

const express = require("express");
const controller = require("./customer-auth.controller");
const retention = require("./customer-retention.controller");
const {
  customerAuthOptional,
  requireCustomer,
} = require("../../middleware/customer-auth");

const router = express.Router();
const authed = [customerAuthOptional, requireCustomer];

router.post("/register", controller.register);
router.post("/login", controller.login);
router.post("/refresh", controller.refresh);
router.post("/logout", controller.logout);

// Email verification + password reset (token delivered by email).
router.post("/verify-email", controller.verifyEmail);
router.post("/forgot", controller.forgot);
router.post("/reset", controller.reset);

// Account reads (access token required).
router.get("/me", ...authed, controller.me);
router.get("/orders", ...authed, controller.orders);

// Retention surface (§6.23) — the shopper's own loyalty/referral/rewards.
router.get("/loyalty", ...authed, retention.loyalty);
router.get("/referral", ...authed, retention.referral);
router.get("/rewards", ...authed, retention.rewards);
router.post("/rewards/:id/redeem", ...authed, retention.redeem);

module.exports = router;
