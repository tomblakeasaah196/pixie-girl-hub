/**
 * Stylist Partner Programme (V2.2 §6.26) — PORTAL routes for partners.
 * Mounted at /api/v1/stylist-portal. Uses the stylist JWT class (NOT staff
 * auth). `login` is unauthenticated; everything else requires stylistAuth.
 */

"use strict";

const express = require("express");
const c = require("./stylist.controller");
const v = require("./stylist.validator");
const { stylistAuth } = require("./stylist.auth");

const router = express.Router();

// Unauthenticated: token issue + the invite/forgot-password rail.
router.post("/login", v.validateLogin, c.login);
router.post("/password/forgot", v.validateForgot, c.forgotPassword);
router.post("/password/reset", v.validateReset, c.resetPassword);

// Authenticated portal surface.
router.get("/me", stylistAuth, c.myProfile);
router.patch("/me", stylistAuth, v.validateMyProfilePatch, c.updateMyProfile);
router.patch(
  "/me/payout-details",
  stylistAuth,
  v.validateMyPayoutDetails,
  c.updateMyPayoutDetails,
);
router.get("/offers", stylistAuth, c.myOffers);
router.get("/assignments", stylistAuth, c.myAssignments);
router.get("/earnings", stylistAuth, c.myEarnings);
router.get("/payouts", stylistAuth, c.myPayouts);
router.get("/payouts/:id", stylistAuth, c.myPayout);

router.post("/assignments/:id/accept", stylistAuth, c.acceptOffer);
router.post(
  "/assignments/:id/decline",
  stylistAuth,
  v.validateReason,
  c.declineOffer,
);
router.post("/assignments/:id/start", stylistAuth, c.startAssignment);
router.post("/assignments/:id/complete", stylistAuth, c.completeAssignment);

// Referrals (two-way earnings, Q17).
router.get("/referrals", stylistAuth, c.myReferrals);
router.post(
  "/referrals/links",
  stylistAuth,
  v.validateReferralLink,
  c.createReferralLink,
);

// Notifications feed (Q18).
router.get("/notifications", stylistAuth, c.myNotifications);
router.post("/notifications/read-all", stylistAuth, c.markAllNotificationsRead);
router.post("/notifications/:id/read", stylistAuth, c.markNotificationRead);

// Badge + contract (Q10/Q11).
router.get("/badge", stylistAuth, c.myBadge);
router.get("/badge/card", stylistAuth, c.myBadgeCard);
router.get("/contract", stylistAuth, c.myContract);
router.get("/contract/document", stylistAuth, c.myContractDocument);
router.post("/contract/sign", stylistAuth, v.validateContractSign, c.signMyContract);

module.exports = router;
