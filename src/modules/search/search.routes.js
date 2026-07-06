/**
 * Search router — mounted under /api/v1/search.
 *
 * All three endpoints are read-only and inherit the surrounding auth + brand
 * context middleware from src/routes/index.js. No requirePermission gate at
 * the route level: fan-out enforces per-entity RBAC internally, so a user
 * with (say) sales but not invoicing sees results from sales only.
 */

"use strict";

const express = require("express");
const controller = require("./search.controller");

const router = express.Router();

router.get("/", controller.search);
router.get("/suggestions", controller.suggestions);
router.get("/types", controller.types);

module.exports = router;
