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
// Performance appraisal (KPIs, cycles, scoring, reviews) has its own gate so a
// manager can be granted "Performance" to score their team WITHOUT seeing
// payroll or salary. Grants were copied from hr_payroll on split (migration
// 000289) so no existing role loses access.
const PERF = (action) => requirePermission("performance", action);

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
// Gated on `performance` (split from hr_payroll) so team scoring can be
// delegated without granting payroll/salary access.
router.get(
  "/kpi-definitions/weight-summary",
  PERF("view"),
  controller.kpiDefs.weightSummary,
);
router.get("/kpi-definitions", PERF("view"), controller.kpiDefs.list);
router.post(
  "/kpi-definitions",
  PERF("create"),
  validate.kpiDef.create,
  controller.kpiDefs.create,
);
router.get("/kpi-definitions/:id", PERF("view"), controller.kpiDefs.get);
router.patch(
  "/kpi-definitions/:id",
  PERF("edit"),
  validate.kpiDef.update,
  controller.kpiDefs.update,
);
router.delete("/kpi-definitions/:id", PERF("delete"), controller.kpiDefs.remove);

// ── Performance cycles ─────────────────────────────────────
router.get("/performance-cycles", PERF("view"), controller.cycles.list);
router.post(
  "/performance-cycles",
  PERF("create"),
  validate.cycle.create,
  controller.cycles.create,
);
router.get("/performance-cycles/:id", PERF("view"), controller.cycles.get);
router.patch(
  "/performance-cycles/:id",
  PERF("edit"),
  validate.cycle.update,
  controller.cycles.update,
);
router.delete("/performance-cycles/:id", PERF("delete"), controller.cycles.remove);

// ── Appraisal scoring + reviews (F-8) ──────────────────────
// Scores are nested under a cycle; reviews roll the scores into one figure.
router.get(
  "/performance-cycles/:cycleId/scores",
  PERF("view"),
  controller.appraisal.listScores,
);
router.post(
  "/performance-cycles/:cycleId/scores",
  PERF("edit"),
  validate.appraisal.score,
  controller.appraisal.score,
);
// Auto-score a cycle from real HR data (attendance, sales, quality, ratings).
router.post(
  "/performance-cycles/:cycleId/auto-score",
  PERF("edit"),
  validate.appraisal.autoScore,
  controller.appraisal.autoScore,
);
// Manager calibration of a single score (overrides + shields from auto-refresh).
router.post(
  "/performance-cycles/:cycleId/scores/:scoreId/calibrate",
  PERF("edit"),
  validate.appraisal.calibrate,
  controller.appraisal.calibrate,
);
router.post(
  "/performance-cycles/:cycleId/reviews",
  PERF("edit"),
  validate.appraisal.reviewGenerate,
  controller.appraisal.generateReview,
);
router.get("/performance-reviews", PERF("view"), controller.appraisal.listReviews);
router.get(
  "/performance-reviews/:id",
  PERF("view"),
  controller.appraisal.getReview,
);
router.patch(
  "/performance-reviews/:id",
  PERF("edit"),
  validate.appraisal.reviewContent,
  controller.appraisal.updateReview,
);
router.post(
  "/performance-reviews/:id/advance",
  PERF("approve"),
  validate.appraisal.reviewAdvance,
  controller.appraisal.advanceReview,
);
// Export the review as a stored PDF (sets performance_reviews.document_id).
router.post(
  "/performance-reviews/:id/pdf",
  PERF("edit"),
  controller.appraisal.exportPdf,
);
router.post(
  "/performance-reviews/:id/acknowledge",
  PERF("edit"),
  validate.appraisal.reviewAcknowledge,
  controller.appraisal.acknowledgeReview,
);

// ── Performance → Insights (Sales exec of the month + Attendance) ──
// Gated on `performance` (same as cycles/KPIs/reviews) so a manager granted
// Performance can see the leaderboard + attendance report for their team
// without payroll/salary access. Period comes from ?from&to (default: month).
router.get("/insights/sales-reps", PERF("view"), controller.insights.sales);
router.get("/insights/attendance", PERF("view"), controller.insights.attendance);
router.get("/insights/export", PERF("view"), controller.insights.exportExcel);
router.post("/insights/winner-pdf", PERF("view"), controller.insights.exportWinnerPdf);
// Announce the winner to brand staff (in-app notification). Needs `edit`.
router.post("/insights/announce-winner", PERF("edit"), controller.insights.announceWinner);

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
