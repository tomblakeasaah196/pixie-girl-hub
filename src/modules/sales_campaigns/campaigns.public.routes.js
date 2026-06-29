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
// tight here — a buyer who retries, or several buyers behind one carrier-grade
// NAT (very common on Nigerian mobile networks), trip a 429 that surfaces as a
// confusing "silent" checkout failure. Give the pay flow its own roomier window
// AND key it on the client idempotency key when present, so (a) a buyer
// retrying the SAME checkout reuses one bucket instead of burning the budget,
// and (b) distinct buyers behind one IP no longer collide.
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const k = req.body && req.body.client_idempotency_key;
    return typeof k === "string" && k ? `idem:${k}` : req.ip || "unknown";
  },
  message: {
    error: {
      code: "TOO_MANY_REQUESTS",
      message:
        "Too many checkout attempts — please wait a moment and tap pay again.",
      retryable: true,
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

// Live cart quote: the landing cart posts its current items on every change to
// get the server-authoritative running total (position ladder + stacking bonus
// + quantity tier + reseller/bulk, stacked and floor-clamped). Read-only, uses
// the cheap landing limiter. Never trusts client-sent prices.
router.post(
  "/:slug/quote",
  landingReadLimiter,
  validator.validateQuote,
  controller.quote,
);

// Coupon preview: the checkout summary asks for a code's flat ₦ value so it can
// show (and currency-convert) the saving before the buyer pays. Read-only — no
// redemption; the Hub re-validates + floor-clamps at checkout. Cheap landing
// limiter; never reveals more than {valid, discount_ngn}.
router.post(
  "/:slug/coupon-preview",
  landingReadLimiter,
  validator.validateCouponPreview,
  controller.couponPreview,
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
