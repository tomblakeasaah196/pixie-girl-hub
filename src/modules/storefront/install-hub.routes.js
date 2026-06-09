/**
 * Install QR Hub (V2.2 §6.10 — Curated Delivery Letter). No auth.
 * GET /api/public/install-hub/:token — composes the install & care page from
 * the order (resolved by public_tracking_token), matching wig-care guides,
 * and certified stylists near the delivery city.
 */

"use strict";

const express = require("express");
const controller = require("./storefront.controller");

const router = express.Router();

router.get("/:token", controller.getInstallHub);

module.exports = router;
