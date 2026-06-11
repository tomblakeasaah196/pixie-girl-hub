/**
 * Dashboards (V2.2 §6.20) — routes. Mounted at /api/v1/dashboards.
 * Permission key: dashboards. Role-based KPI rollups over the live spine +
 * the AI briefings feed.
 */

"use strict";

const express = require("express");
const c = require("./dashboards.controller");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("dashboards", action);

router.get("/overview", can("view"), c.overview);
router.get("/kpis/sales", can("view"), c.salesKpis);
router.get("/kpis/operations", can("view"), c.opsKpis);

router.get("/briefings", can("view"), c.listBriefings);
router.get("/briefings/:id", can("view"), c.getBriefing);
router.post("/briefings/:id/read", can("view"), c.markBriefingRead);

module.exports = router;
