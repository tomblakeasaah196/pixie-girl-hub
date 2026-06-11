/**
 * AI Insights (V2.2 §6.30) — routes. Mounted at /api/v1/insights.
 * Permission key: ai_insights. Tier-1 proactive insights: a category-keyed
 * list/get + acknowledge/resolve/dismiss lifecycle, an open-counts summary,
 * and a manual detector-sweep trigger (also run on a cron).
 *
 * Categories: stock | margin | invoice | intercompany | attendance |
 * approval | service_match.
 *
 * Requiring the subscribers here registers the detector cron connection
 * (side-effect import).
 */

"use strict";

const express = require("express");
const c = require("./insights.controller");
const v = require("./insights.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("ai_insights", action);

// Literal segments before the category param.
router.get("/summary", can("view"), c.summary);
router.post("/sweep", can("edit"), c.sweep);

router.get("/:category", can("view"), c.list);
router.get("/:category/:id", can("view"), c.getOne);
router.post("/:category/:id/acknowledge", can("edit"), c.acknowledge);
router.post(
  "/:category/:id/resolve",
  can("edit"),
  v.validateResolve,
  c.resolve,
);
router.post("/:category/:id/dismiss", can("edit"), c.dismiss);

module.exports = router;
