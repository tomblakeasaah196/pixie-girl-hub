/**
 * AI Insights (V2.2 §6.30 / §6.31) — routes. Mounted at /api/v1/insights.
 * Permission key: ai_insights. Unified store: one list/summary + a per-insight
 * acknowledge/resolve/dismiss lifecycle, the AI Control per-module switchboard,
 * and a manual detector-sweep trigger (also run on a cron every 30 min).
 *
 * Modules: stock | invoicing | intercompany | approvals | service_jobs |
 * pricing | hr_attendance | sales | crm | purchasing | logistics | expenses |
 * production | retention | accounting | … (27 seeded in ai_insight_modules).
 */

"use strict";

const express = require("express");
const c = require("./insights.controller");
const v = require("./insights.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("ai_insights", action);

// Literal segments first (before the :id param route).
router.get("/summary", can("view"), c.summary);
router.get("/modules", can("view"), c.listModules);
router.patch("/modules/:module", can("edit"), v.validateModuleUpdate, c.updateModule);
router.post("/sweep", can("edit"), c.sweep);

// List (optionally ?module=&status=&severity=&page=).
router.get("/", can("view"), c.list);

// Per-insight (id is globally unique in the unified store).
router.get("/:id", can("view"), c.getOne);
router.post("/:id/acknowledge", can("edit"), c.acknowledge);
router.post("/:id/resolve", can("edit"), v.validateResolve, c.resolve);
router.post("/:id/dismiss", can("edit"), c.dismiss);

module.exports = router;
