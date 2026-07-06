/**
 * HR & Payroll routes (V2.2 §6.11) — Pass 1: employees + Tier-1 config.
 * Mounted at /api/v1/hr, gated on the `hr_payroll` permission. Auth + brand
 * context applied upstream. Static prefixes precede any dynamic :id.
 *
 * Pass 2 (operational): payroll_runs, payslips, commission_earned,
 * bonuses_awarded, performance scoring + reviews, attendance.
 */

"use strict";

const express = require("express");
const controller = require("./hr.controller");
const validate = require("./hr.validator");
const { requirePermission } = require("../../middleware/rbac");

// Side-effect: register sales.order.paid → commission accrual (G-3).
require("./commission.subscribers");

const router = express.Router();
const P = (action) => requirePermission("hr_payroll", action);

// ── Employees ──────────────────────────────────────────────
router.get("/employees", P("view"), controller.listStaff);
router.post(
  "/employees",
  P("create"),
  validate.staff.create,
  controller.createStaff,
);
router.get("/employees/:id", P("view"), controller.getStaff);
router.patch(
  "/employees/:id",
  P("edit"),
  validate.staff.update,
  controller.updateStaff,
);
router.delete("/employees/:id", P("delete"), controller.deleteStaff);

// ── Commission rules ───────────────────────────────────────
router.get("/commission-rules", P("view"), controller.commissionRules.list);
router.post(
  "/commission-rules",
  P("create"),
  validate.commissionRule.create,
  controller.commissionRules.create,
);
router.get("/commission-rules/:id", P("view"), controller.commissionRules.get);
router.patch(
  "/commission-rules/:id",
  P("edit"),
  validate.commissionRule.update,
  controller.commissionRules.update,
);
router.delete(
  "/commission-rules/:id",
  P("delete"),
  controller.commissionRules.remove,
);

// ── Bonus rules ────────────────────────────────────────────
router.get("/bonus-rules", P("view"), controller.bonusRules.list);
router.post(
  "/bonus-rules",
  P("create"),
  validate.bonusRule.create,
  controller.bonusRules.create,
);
router.get("/bonus-rules/:id", P("view"), controller.bonusRules.get);
router.patch(
  "/bonus-rules/:id",
  P("edit"),
  validate.bonusRule.update,
  controller.bonusRules.update,
);
router.delete("/bonus-rules/:id", P("delete"), controller.bonusRules.remove);

// ── Performance KPI definitions (weighted; must total 100) ──
router.get(
  "/kpi-definitions/weight-summary",
  P("view"),
  controller.kpiDefs.weightSummary,
);
router.get("/kpi-definitions", P("view"), controller.kpiDefs.list);
router.post(
  "/kpi-definitions",
  P("create"),
  validate.kpiDef.create,
  controller.kpiDefs.create,
);
router.get("/kpi-definitions/:id", P("view"), controller.kpiDefs.get);
router.patch(
  "/kpi-definitions/:id",
  P("edit"),
  validate.kpiDef.update,
  controller.kpiDefs.update,
);
router.delete("/kpi-definitions/:id", P("delete"), controller.kpiDefs.remove);

// ── Performance cycles ─────────────────────────────────────
router.get("/performance-cycles", P("view"), controller.cycles.list);
router.post(
  "/performance-cycles",
  P("create"),
  validate.cycle.create,
  controller.cycles.create,
);
router.get("/performance-cycles/:id", P("view"), controller.cycles.get);
router.patch(
  "/performance-cycles/:id",
  P("edit"),
  validate.cycle.update,
  controller.cycles.update,
);
router.delete("/performance-cycles/:id", P("delete"), controller.cycles.remove);

// ── Appraisal scoring + reviews (F-8) ──────────────────────
// Scores are nested under a cycle; reviews roll the scores into one figure.
router.get(
  "/performance-cycles/:cycleId/scores",
  P("view"),
  controller.appraisal.listScores,
);
router.post(
  "/performance-cycles/:cycleId/scores",
  P("edit"),
  validate.appraisal.score,
  controller.appraisal.score,
);
// Auto-score a cycle from real HR data (attendance, sales, quality, ratings).
router.post(
  "/performance-cycles/:cycleId/auto-score",
  P("edit"),
  validate.appraisal.autoScore,
  controller.appraisal.autoScore,
);
// Manager calibration of a single score (overrides + shields from auto-refresh).
router.post(
  "/performance-cycles/:cycleId/scores/:scoreId/calibrate",
  P("edit"),
  validate.appraisal.calibrate,
  controller.appraisal.calibrate,
);
router.post(
  "/performance-cycles/:cycleId/reviews",
  P("edit"),
  validate.appraisal.reviewGenerate,
  controller.appraisal.generateReview,
);
router.get("/performance-reviews", P("view"), controller.appraisal.listReviews);
router.get(
  "/performance-reviews/:id",
  P("view"),
  controller.appraisal.getReview,
);
router.patch(
  "/performance-reviews/:id",
  P("edit"),
  validate.appraisal.reviewContent,
  controller.appraisal.updateReview,
);
router.post(
  "/performance-reviews/:id/advance",
  P("approve"),
  validate.appraisal.reviewAdvance,
  controller.appraisal.advanceReview,
);
router.post(
  "/performance-reviews/:id/acknowledge",
  P("edit"),
  validate.appraisal.reviewAcknowledge,
  controller.appraisal.acknowledgeReview,
);

// ── Payroll deductions (PAYE / pension / NHF) ──────────────
router.get("/deductions", P("view"), controller.deductions.list);
router.post(
  "/deductions",
  P("create"),
  validate.deduction.create,
  controller.deductions.create,
);
router.get("/deductions/:id", P("view"), controller.deductions.get);
router.patch(
  "/deductions/:id",
  P("edit"),
  validate.deduction.update,
  controller.deductions.update,
);
router.delete("/deductions/:id", P("delete"), controller.deductions.remove);

module.exports = router;
