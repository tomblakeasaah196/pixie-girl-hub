/**
 * Customer auth - PUBLIC routes. Mounted at /api/public/auth.
 * Token model (Hub canon): access JWT in memory, refresh in httpOnly cookie.
 */

"use strict";

const express = require("express");
const controller = require("./customer-auth.controller");
const {
  customerAuthOptional,
  requireCustomer,
} = require("../../middleware/customer-auth");

const router = express.Router();

router.post("/register", controller.register);
router.post("/login", controller.login);
router.post("/refresh", controller.refresh);
router.post("/logout", controller.logout);

// Account reads (access token required).
router.get("/me", customerAuthOptional, requireCustomer, controller.me);
router.get("/orders", customerAuthOptional, requireCustomer, controller.orders);

module.exports = router;
