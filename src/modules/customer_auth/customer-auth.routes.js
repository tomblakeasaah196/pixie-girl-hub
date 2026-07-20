/**
 * Customer auth - PUBLIC routes. Mounted at /api/public/auth.
 * Token model (Hub canon): access JWT in memory, refresh in httpOnly cookie.
 */

"use strict";

const express = require("express");
const controller = require("./customer-auth.controller");
const retention = require("./customer-retention.controller");
const retentionController = require("../retention/retention.controller");
const retentionValidator = require("../retention/retention.validator");
const crownValidator = require("../retention/crown.validator");
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

// Crowns 👑 (§6.23 unified economy) — the shopper's own wallet + earning.
// The programme (tier ladder + ways to earn) is public for the marketing page;
// the wallet, discount, submit and check-in are scoped to the signed-in shopper.
router.get("/crowns/programme", retention.crownProgramme);
router.get("/crowns", ...authed, retention.crownWallet);
router.get("/crowns/discount", ...authed, retention.crownDiscount);
router.post("/crowns/submit", ...authed, crownValidator.validateSubmitAction, retention.crownSubmit);
router.post("/crowns/check-in", ...authed, retention.crownCheckIn);

// Hair-quiz submit (customer-authed). P0-7: the public /api/public/hair-quiz
// route strips contact_id from the body (so no anonymous star farming), and
// this authed route is the only path that credits stars — always to the
// signed-in shopper (req.customer.contact_id).
router.post(
  "/hair-quiz/submit",
  ...authed,
  retentionValidator.validateQuizSubmit,
  retentionController.submitQuizAuthed,
);

module.exports = router;
