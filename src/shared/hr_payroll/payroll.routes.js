/**
 * Payroll operations routes (V2.2 §6.11) — Pass 2.
 * Mounted at /api/v1/hr (alongside the Pass-1 hr router), gated on
 * `hr_payroll`. Prefixes: /payroll-runs, /payslips, /commissions, /bonuses.
 *
 * Payslips are read-only (immutable after paid); their payment is settled by
 * the run's `pay` action, not edited directly.
 */

"use strict";

const express = require("express");
const c = require("./payroll.controller");
const v = require("./payroll.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const P = (a) => requirePermission("hr_payroll", a);

// ── Payroll runs (state machine) ───────────────────────────
router.get("/payroll-runs", P("view"), c.listRuns);
router.post("/payroll-runs", P("create"), v.runCreate, c.createRun);
router.get("/payroll-runs/:id", P("view"), c.getRun);
router.post("/payroll-runs/:id/calculate", P("edit"), c.calculateRun);
router.post("/payroll-runs/:id/review", P("edit"), c.reviewRun);
router.post("/payroll-runs/:id/approve", P("approve"), c.approveRun);
router.post("/payroll-runs/:id/pay", P("approve"), c.payRun);
router.post("/payroll-runs/:id/reverse", P("approve"), c.reverseRun);

// ── Payslips (read-only) ───────────────────────────────────
router.get("/payslips", P("view"), c.listPayslips);
router.get("/payslips/:id", P("view"), c.getPayslip);

// ── Commission earned ──────────────────────────────────────
router.get("/commissions", P("view"), c.listCommissions);
router.post(
  "/commissions",
  P("create"),
  v.commissionAccrue,
  c.accrueCommission,
);
router.post("/commissions/:id/approve", P("approve"), c.approveCommission);
router.post("/commissions/:id/reverse", P("approve"), c.reverseCommission);

// ── Bonuses awarded ────────────────────────────────────────
router.get("/bonuses", P("view"), c.listBonuses);
router.post("/bonuses", P("create"), v.bonusAward, c.awardBonus);
router.post(
  "/bonuses/:id/decision",
  P("approve"),
  v.bonusDecide,
  c.decideBonus,
);
router.post("/bonuses/:id/reverse", P("approve"), c.reverseBonus);

module.exports = router;
