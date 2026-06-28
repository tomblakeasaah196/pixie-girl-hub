/**
 * Public catalogue + storefront-analytics endpoints (no auth).
 * Mounted at BOTH /api/public/catalogue (legacy) and /api/public/storefront
 * (the path the Storefront Website calls — alongside the geo router, whose
 * paths don't overlap). Brand from X-Brand-Context / ?brand.
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
// Browse-by-shade (000062) — index + shade page with its styled products.
router.get("/shades", controller.listShades);
router.get("/shades/:slug", controller.getShade);
// Collections — index + collection page (detail keeps its existing path).
router.get("/collections", controller.listCollections);
router.get("/collections/:slug", controller.getCollection);
// Bundles — index + bundle detail (":slug" === bundle_code).
router.get("/bundles", controller.listBundles);
router.get("/bundles/:slug", controller.getBundle);
// Published Studio config for the SSR shell (theme/nav/pages/popups).
router.get("/site", controller.getSite);
// Content posts: list (journal/policies index) + single post.
router.get("/content/:type", controller.listContent);
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
