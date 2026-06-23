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

// Checkout is a genuine buyer action. The signup cap (20 / 15 min) is far too
// tight here — a buyer who retries, or several buyers behind one NAT'd IP,
// trip a 429 that surfaces as a confusing "silent" checkout failure. Give the
// pay flow its own, roomier window with a checkout-specific message.
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "TOO_MANY_REQUESTS",
      message: "Too many checkout attempts — please wait a moment and retry.",
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

// Checkout: the live sale "Pay now" flow. Uses its own roomier limiter so a
// retrying buyer is never mistaken for a bot and 429'd mid-purchase.
router.post(
  "/:slug/checkout",
  checkoutLimiter,
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
