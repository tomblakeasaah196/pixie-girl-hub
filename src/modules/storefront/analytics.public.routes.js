/**
 * Storefront analytics ingestion — PUBLIC (no auth).
 * Mounted at /api/public/analytics (the path the website fires to, per guide
 * §5.6). The same handlers are also reachable under the catalogue router; this
 * dedicated mount gives them the canonical top-level path.
 *
 * Brand resolves from X-Brand-Context / ?brand.
 */

"use strict";

const express = require("express");
const controller = require("./storefront.controller");
const validator = require("./storefront.validator");

const router = express.Router();

router.post("/sessions", validator.validateSession, controller.startSession);
router.post(
  "/page-views",
  validator.validatePageView,
  controller.recordPageView,
);
router.post(
  "/funnel-events",
  validator.validateFunnel,
  controller.recordFunnelEvent,
);

module.exports = router;
