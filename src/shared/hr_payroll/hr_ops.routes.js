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
const dc = require("./devices.controller");
const dv = require("./devices.validator");
const sd = require("./staff_documents.controller");
const sdv = require("./staff_documents.validator");
const multer = require("multer");
const { config } = require("../../config/env");
const { requirePermission } = require("../../middleware/rbac");

// Side-effect: register HR subscribers (target-achieved → auto-bonus;
// sales/service-job completion → auto target-progress).
require("./target.subscribers");
require("./target.progress.subscribers");

const router = express.Router();
const P = (action) => requirePermission("hr_payroll", action);

// Employee document uploads: buffered in memory, then handed to
// documents.service.store() (compression, hashing, storage). Same cap as the
// documents module so an operator meets one limit, not two.
const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MEDIA_MAX_FILE_SIZE_MB * 1024 * 1024 },
});

// ── Self-service (My HR) — auth only ───────────────────────
router.get("/me", c.getMyHr);
router.get("/me/attendance", c.myAttendance);
router.get("/me/tasks", c.myTasks);
router.get("/me/contracts", c.myContracts);
router.get("/me/targets", c.myTargets);
router.get("/me/payslips", c.myPayslips);
// An employee reads their own file back (read-only — filing stays with HR).
router.get("/me/documents", sd.listMine);
router.get("/me/documents/:documentId/preview", sd.previewMine);
router.get("/me/documents/:documentId/download", sd.downloadMine);
router.get("/me/today", c.getMyToday);
router.post("/me/clock", v.clock, c.selfClock);
router.post("/me/leave", v.leaveRequest, c.requestLeave);
router.post("/me/queries/:id/respond", v.queryRespond, c.respondToQuery);
router.post("/me/onboarding", v.onboardingToggle, c.toggleOnboardingItem);

// ── Device binding (My HR) — auth only, email-OTP gated ────
router.get("/me/devices", dc.listMyDevices);
router.post("/me/devices/enroll/start", dv.enrollStart, dc.startEnrollment);
router.post("/me/devices/enroll/verify", dv.otp, dc.verifyEnrollment);
router.post("/me/devices/:id/remove/start", dc.startRemoval);
router.post("/me/devices/:id/remove/verify", dv.otp, dc.verifyRemoval);

// ── Overview + analytics + reconcile ───────────────────────
router.get("/overview", P("view"), c.getOverview);
router.get("/analytics", P("view"), c.getAnalytics);
router.get("/analytics/trends", P("view"), c.getAnalyticsTrends);
router.get("/probation/ending-soon", P("view"), c.getProbationEndingSoon);
router.post("/attendance/reconcile", P("edit"), v.reconcile, c.reconcile);
router.post("/attendance/reconcile-period", P("edit"), v.reconcilePeriod, c.reconcilePeriod);
router.post("/attendance/apply-lapsed-offsite", P("edit"), c.applyLapsedOffsite);
router.get("/attendance-days", P("view"), c.listAttendanceDays);
router.get("/attendance/live", P("view"), c.getLiveAttendance);

// ── Device binding (HR & Staff) — every employee + change feed ──
router.get("/devices", P("view"), dc.listAllDevices);
router.get("/devices/changes", P("view"), dc.listChangeFeed);

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

// ── Contracts (generate PDF + record; route to e-sign separately) ──
router.get("/employees/:id/dossier", P("view"), c.getEmployee360);
router.get("/employees/:id/contracts", P("view"), c.listContracts);
router.post("/employees/:id/contract", P("edit"), v.contractGenerate, c.generateContract);

// ── Employee documents (Employee → Documents tab) ──────────
// Gated on hr_payroll, NOT on the `documents` permission: these are contracts,
// NIN slips and passport photographs, and the generic Documents module is
// granted far more widely. Those same rows are excluded from /documents for
// the same reason — see src/shared/documents/documents.repo.js.
router.get("/document-types", P("view"), sd.listTypes);
router.post("/document-types", P("edit"), sdv.typeCreate, sd.createType);
router.patch("/document-types/:typeId", P("edit"), sdv.typeUpdate, sd.updateType);
router.delete("/document-types/:typeId", P("delete"), sd.removeType);

router.get("/employees/:id/documents", P("view"), sd.list);
router.post(
  "/employees/:id/documents",
  P("edit"),
  docUpload.single("file"),
  sdv.uploadMeta,
  sd.upload,
);
router.get("/employees/:id/documents/:documentId/preview", P("view"), sd.preview);
router.get("/employees/:id/documents/:documentId/download", P("view"), sd.download);
router.delete("/employees/:id/documents/:documentId", P("delete"), sd.remove);

// ── HR settings / config tab ───────────────────────────────
router.get("/settings", P("view"), c.getSettings);
router.put("/settings", P("edit"), v.settingsUpdate, c.updateSettings);
router.post("/settings/payout-pin", P("approve"), v.payoutPin, c.setPayoutPin);

module.exports = router;
