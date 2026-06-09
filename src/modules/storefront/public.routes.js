/**
 * Public catalogue + storefront-analytics endpoints (no auth).
 * Mounted at /api/public/catalogue. Brand from X-Brand-Context / ?brand.
 */

"use strict";

const express = require("express");
const controller = require("./storefront.controller");
const validator = require("./storefront.validator");

const router = express.Router();

// Catalogue reads
router.get("/products", controller.listProducts);
router.get("/products/:slug", controller.getProduct);
router.get("/categories", controller.listCategories);
router.get("/collections/:slug", controller.getCollection);
router.get("/content/:type/:slug", controller.getContent);

// Analytics ingestion (B-7)
router.post(
  "/analytics/sessions",
  validator.validateSession,
  controller.startSession,
);
router.post(
  "/analytics/page-views",
  validator.validatePageView,
  controller.recordPageView,
);
router.post(
  "/analytics/funnel-events",
  validator.validateFunnel,
  controller.recordFunnelEvent,
);

module.exports = router;
