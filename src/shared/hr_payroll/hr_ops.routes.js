/**
 * HR operations routes (HR Phase 1). Mounted alongside hr.routes at
 * /api/v1/hr. Auth + brand context applied upstream.
 *
 * Self-service endpoints (My HR) need only an authenticated user with a linked
 * staff profile — they are NOT gated on the hr_payroll permission, because
 * every employee uses them (answer #13). Management endpoints are gated on
 * hr_payroll like the rest of the module.
 */

"use strict";

const express = require("express");
const c = require("./hr_ops.controller");
const v = require("./hr_ops.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const P = (action) => requirePermission("hr_payroll", action);

// ── Self-service (My HR) — auth only ───────────────────────
router.get("/me", c.getMyHr);
router.post("/me/leave", v.leaveRequest, c.requestLeave);
router.post("/me/queries/:id/respond", v.queryRespond, c.respondToQuery);

// ── Overview + reconcile ───────────────────────────────────
router.get("/overview", P("view"), c.getOverview);
router.post("/attendance/reconcile", P("edit"), v.reconcile, c.reconcile);
router.get("/attendance-days", P("view"), c.listAttendanceDays);

// ── Leave inbox ────────────────────────────────────────────
router.get("/leave", P("view"), c.listLeave);
router.post("/leave", P("edit"), v.leaveRequest, c.requestLeave);
router.post("/leave/:id/approve", P("approve"), c.approveLeave);
router.post("/leave/:id/reject", P("approve"), v.leaveReject, c.rejectLeave);

// ── Queries ────────────────────────────────────────────────
router.get("/queries", P("view"), c.listQueries);
router.post("/queries", P("edit"), v.queryRaise, c.raiseQuery);
router.post("/queries/:id/resolve", P("edit"), v.queryResolve, c.resolveQuery);

// ── Monthly performance targets ────────────────────────────
router.get("/targets", P("view"), c.listTargets);
router.post("/targets", P("edit"), v.targetCreate, c.setTarget);
router.patch("/targets/:id/progress", P("edit"), v.targetProgress, c.updateTargetProgress);
router.delete("/targets/:id", P("delete"), c.removeTarget);

// ── HR settings / config tab ───────────────────────────────
router.get("/settings", P("view"), c.getSettings);
router.put("/settings", P("edit"), v.settingsUpdate, c.updateSettings);
router.post("/settings/payout-pin", P("approve"), v.payoutPin, c.setPayoutPin);

module.exports = router;
