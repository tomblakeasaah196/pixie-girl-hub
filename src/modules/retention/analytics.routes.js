/**
 * Retention analytics (Module 6.23.7) — authenticated routes.
 * Mounted at /api/v1/retention/analytics. Permission key: retention.
 */

"use strict";

const express = require("express");
const controller = require("./analytics.controller");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();

router.get("/", requirePermission("retention", "view"), controller.overview);

module.exports = router;
