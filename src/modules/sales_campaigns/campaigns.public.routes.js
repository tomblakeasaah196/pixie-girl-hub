/**
 * Sales Campaigns — PUBLIC routes (no auth).
 * Mounted at /api/public/sale.
 *
 *   GET  /:slug          → landing payload (before | live | ended)
 *   GET  /:slug/stock    → live stock counters (poll fallback for socket)
 *   POST /:slug/signup   → pre-launch notification signup (rate-limited)
 */

"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const controller = require("./campaigns.public.controller");
const validator = require("./campaigns.validator");

const router = express.Router();

// Reads are cheap individually but can be hammered to scrape inventory or
// brute-force-enumerate slugs. The global limiter (300/min) is too loose for
// an unauthenticated endpoint that hits the DB per request.
const landingReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "TOO_MANY_REQUESTS",
      message: "Too many requests — slow down and try again shortly.",
    },
  },
});

// Stricter cap on writes — pre-launch notification list is a popular abuse
// target (email enumeration, mailing list seeding).
const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "TOO_MANY_REQUESTS",
      message: "Too many signups, try again later",
    },
  },
});

// Storefront index (no slug) — must precede the /:slug route.
router.get("/", landingReadLimiter, controller.index);
router.get("/:slug", landingReadLimiter, controller.landing);
router.get("/:slug/stock", landingReadLimiter, controller.stock);
router.post(
  "/:slug/signup",
  signupLimiter,
  validator.validateSignup,
  controller.signup,
);

// Checkout: the live sale "Pay now" flow. Uses the signup limiter (20 per
// 15 min per IP) — a real buyer will never hit this; a scraper/bot will.
router.post(
  "/:slug/checkout",
  signupLimiter,
  validator.validateCheckout,
  controller.checkout,
);

// Order status: thank-you page polls this to show confirmation.
router.get("/:slug/order/:orderId", landingReadLimiter, controller.orderStatus);

// Product detail for the landing-page product modal — gallery, long
// description, variants (size × lace with effective price), and the brand's
// head-size guide + video.
router.get(
  "/:slug/product/:styledId",
  landingReadLimiter,
  controller.productDetail,
);

module.exports = router;
