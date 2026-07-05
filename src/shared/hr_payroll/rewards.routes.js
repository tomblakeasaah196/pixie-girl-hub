/**
 * Rewards routes. Mounted alongside hr.routes at /api/v1/hr. Gated on
 * hr_payroll (CEO bypasses). Grant approval that moves money uses the
 * approve action.
 */

"use strict";

const express = require("express");
const c = require("./rewards.controller");
const v = require("./rewards.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const P = (action) => requirePermission("hr_payroll", action);

// Rules
router.get("/rewards/rules", P("view"), c.listRules);
router.post("/rewards/rules", P("edit"), v.ruleCreate, c.createRule);
router.patch("/rewards/rules/:id", P("edit"), v.ruleUpdate, c.updateRule);
router.delete("/rewards/rules/:id", P("delete"), c.deleteRule);

// Evaluation + standings
router.post("/rewards/evaluate", P("edit"), v.evaluate, c.evaluate);
router.get("/rewards/leaderboard", P("view"), c.leaderboard);

// Grants
router.get("/rewards/grants", P("view"), c.listGrants);
router.post("/rewards/grants/:id/apply", P("approve"), c.applyGrant);
router.post("/rewards/grants/:id/reject", P("approve"), v.reject, c.rejectGrant);

module.exports = router;
