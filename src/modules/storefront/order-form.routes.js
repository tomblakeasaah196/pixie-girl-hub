/**
 * Public Order Form (V2.2 §6.4 / §6.21). No-login checkout.
 * POST /api/public/order-form — upsert contact + raise a public_form order.
 * Brand from X-Brand-Context header / ?brand (default pixiegirl).
 */

"use strict";

const express = require("express");
const controller = require("./storefront.controller");
const validator = require("./storefront.validator");

const router = express.Router();

router.post("/", validator.validateOrderForm, controller.submitOrderForm);

module.exports = router;
