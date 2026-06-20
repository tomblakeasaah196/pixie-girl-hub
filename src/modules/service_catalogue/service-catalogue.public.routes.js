/**
 * Service Catalogue — public storefront routes (no auth).
 * Mounted at /api/public/services. Brand from X-Brand-Context / ?brand.
 * Services sell online as bookable offerings; "Book" captures a request.
 */

"use strict";

const express = require("express");
const c = require("./service-catalogue.controller");
const v = require("./service-catalogue.validator");
const { publicWriteLimiter } = require("../../middleware");

const router = express.Router();

router.get("/", c.publicList);
router.get("/:slug", c.publicGet);
router.post(
  "/:slug/book",
  publicWriteLimiter,
  v.validateBookingRequest,
  c.publicBook,
);

module.exports = router;
