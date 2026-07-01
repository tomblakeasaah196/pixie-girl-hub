/**
 * Customer assets (Stylist Studio §6.24) — routes. Mounted at
 * /api/v1/customer-assets. Permission key: service_jobs (Stylist Studio).
 */

"use strict";

const express = require("express");
const c = require("./customer-assets.controller");
const v = require("./customer-assets.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("service_jobs", action);

router.get("/", can("view"), c.listAssets);
router.post("/", can("create"), v.validateCheckIn, c.checkIn);
router.get("/:id", can("view"), c.getAsset);
router.post("/:id/check-out", can("edit"), v.validateCheckOut, c.checkOut);

module.exports = router;
