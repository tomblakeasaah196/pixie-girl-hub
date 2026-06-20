/**
 * IAM & Security routes (V2.2 §3 — IAM module).
 *
 * Mounted at /api/v1/iam. Auth + brand context are applied upstream.
 * Most routes are gated on the `iam` permission key; self-service
 * endpoints (my-sessions, TOTP) require only authentication.
 *
 * Route map:
 *   /stats                                  security dashboard overview
 *   /users, /users/:userId                  user management
 *   /users/provision-staff/:profileId       create login for existing staff
 *   /users/provision-external               create external-user login
 *   /sessions, /sessions/:userId            admin session management
 *   /my-sessions                            self-service session management
 *   /audit, /audit/export, /audit/:logId    audit log queries & export
 *   /events                                 security events feed
 *   /reviews, /reviews/:reviewId            access reviews
 *   /totp/*                                 TOTP setup, verify, disable
 */

"use strict";

const express = require("express");
const controller = require("./iam.controller");
const validator = require("./iam.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("iam", action);

// ── Dashboard ───────────────────────────────────────────────
router.get("/stats", can("view"), controller.getStats);

// ── User management ─────────────────────────────────────────
router.get(
  "/users",
  can("view"),
  validator.validateListQuery,
  controller.listUsers,
);
router.get("/users/:userId", can("view"), controller.getUserDetail);
router.post(
  "/users/provision-staff/:profileId",
  can("create"),
  validator.validateProvisionStaffLogin,
  controller.provisionStaffLogin,
);
router.post(
  "/users/provision-external",
  can("create"),
  validator.validateProvisionExternal,
  controller.provisionExternalUser,
);
router.post(
  "/users/:userId/deactivate",
  can("edit"),
  controller.deactivateUser,
);
router.post(
  "/users/:userId/reactivate",
  can("edit"),
  controller.reactivateUser,
);
router.post(
  "/users/:userId/reset-password",
  can("edit"),
  controller.adminResetPassword,
);
router.post(
  "/users/:userId/send-reset-link",
  can("edit"),
  controller.sendResetLink,
);

// ── Sessions (admin) ────────────────────────────────────────
router.get(
  "/sessions",
  can("view"),
  validator.validateSessionListQuery,
  controller.listAllSessions,
);
router.get("/sessions/:userId", can("view"), controller.listUserSessions);
router.delete(
  "/sessions/:userId/:sessionId",
  can("edit"),
  controller.revokeSession,
);
router.delete(
  "/sessions/:userId",
  can("edit"),
  controller.revokeAllUserSessions,
);

// ── Sessions (self-service, auth only) ──────────────────────
router.get("/my-sessions", controller.listMySessions);
router.delete("/my-sessions/:sessionId", controller.revokeMySession);

// ── Audit ───────────────────────────────────────────────────
// Export and record-trail routes BEFORE the :logId param route so they
// are matched as literal segments, not as a UUID param.
router.get(
  "/audit/export",
  can("export"),
  validator.validateAuditExport,
  controller.exportAuditLog,
);
router.get(
  "/audit/record/:table/:recordId",
  can("view"),
  controller.getRecordTrail,
);
router.get(
  "/audit",
  can("view"),
  validator.validateAuditQuery,
  controller.queryAuditLog,
);
router.get("/audit/:logId", can("view"), controller.getAuditEntry);

// ── Security events ─────────────────────────────────────────
router.get(
  "/events",
  can("view"),
  validator.validateEventsQuery,
  controller.listSecurityEvents,
);

// ── Access reviews ──────────────────────────────────────────
router.get(
  "/reviews",
  can("view"),
  validator.validateReviewListQuery,
  controller.listReviews,
);
router.post(
  "/reviews",
  can("create"),
  validator.validateCreateReview,
  controller.createReview,
);
router.get("/reviews/:reviewId", can("view"), controller.getReview);
router.patch(
  "/reviews/:reviewId",
  can("edit"),
  validator.validateUpdateReview,
  controller.updateReview,
);
router.get(
  "/reviews/:reviewId/export",
  can("export"),
  validator.validateExportReviewQuery,
  controller.exportReview,
);
router.patch(
  "/reviews/:reviewId/entries/:entryId",
  can("edit"),
  validator.validateDecideEntry,
  controller.decideEntry,
);

// ── TOTP (self-service, auth only) ──────────────────────────
router.post("/totp/setup", controller.setupTotp);
router.post(
  "/totp/verify",
  validator.validateTotpVerify,
  controller.verifyTotp,
);
router.delete("/totp", validator.validateTotpDisable, controller.disableTotp);
router.get("/totp/status", controller.totpStatus);

module.exports = router;
