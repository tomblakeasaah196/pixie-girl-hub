/**
 * Service Catalogue — public storefront routes (no auth).
 * Mounted at /api/public/services. Brand from X-Brand-Context / ?brand.
 * Services sell online as bookable offerings; "Book" captures a request.
 */

"use strict";

const express = require("express");
const c = require("./service-catalogue.controller");
const v = require("./service-catalogue.validator");

const router = express.Router();

router.get("/", c.publicList);
router.get("/:slug", c.publicGet);
// No per-IP write limiter — booking requests shouldn't be throttled like login.
router.post("/:slug/book", v.validateBookingRequest, c.publicBook);

module.exports = router;
