/**
 * IAM & Security controller (V2.2 §3 — IAM module).
 * HTTP only — translates req/res to service calls. Never contains
 * business logic; that lives in iam.service.js.
 */

"use strict";

const service = require("./iam.service");

// ── Context builder ─────────────────────────────────────────

function ctx(req) {
  return {
    business: req.brand,
    user_id: req.user.user_id,
    request_id: req.request_id,
  };
}

// ── Dashboard ───────────────────────────────────────────────

async function getStats(req, res) {
  const data = await service.getStats(ctx(req));
  res.json({ data });
}

// ── User management ─────────────────────────────────────────

async function listUsers(req, res) {
  const result = await service.listUsers(ctx(req), req.query);
  res.json(result);
}

async function getUserDetail(req, res) {
  const data = await service.getUserDetail(ctx(req), req.params.userId);
  res.json({ data });
}

async function provisionStaffLogin(req, res) {
  const data = await service.provisionStaffLogin(
    ctx(req),
    req.params.profileId,
    req.body,
  );
  res.status(201).json({ data });
}

async function provisionExternalUser(req, res) {
  const data = await service.provisionExternalUser(ctx(req), req.body);
  res.status(201).json({ data });
}

async function deactivateUser(req, res) {
  const data = await service.deactivateUser(ctx(req), req.params.userId);
  res.json({ data });
}

async function reactivateUser(req, res) {
  const data = await service.reactivateUser(ctx(req), req.params.userId);
  res.json({ data });
}

async function adminResetPassword(req, res) {
  const data = await service.adminResetPassword(ctx(req), req.params.userId);
  res.json({ data });
}

async function sendResetLink(req, res) {
  const data = await service.sendResetLink(ctx(req), req.params.userId);
  res.json({ data });
}

// ── Sessions (admin) ────────────────────────────────────────

async function listAllSessions(req, res) {
  const result = await service.listAllSessions(ctx(req), req.query);
  res.json(result);
}

async function listUserSessions(req, res) {
  const data = await service.listUserSessions(ctx(req), req.params.userId);
  res.json({ data });
}

async function revokeSession(req, res) {
  const data = await service.revokeSession(
    ctx(req),
    req.params.userId,
    req.params.sessionId,
  );
  res.json({ data });
}

async function revokeAllUserSessions(req, res) {
  const data = await service.revokeAllUserSessions(ctx(req), req.params.userId);
  res.json({ data });
}

// ── Sessions (self-service) ─────────────────────────────────

async function listMySessions(req, res) {
  const data = await service.listMySessions(ctx(req));
  res.json({ data });
}

async function revokeMySession(req, res) {
  const data = await service.revokeMySession(ctx(req), req.params.sessionId);
  res.json({ data });
}

// ── TOTP ────────────────────────────────────────────────────

async function setupTotp(req, res) {
  const data = await service.setupTotp(ctx(req));
  res.json({ data });
}

async function verifyTotp(req, res) {
  const data = await service.verifyTotp(ctx(req), req.body.code);
  res.json({ data });
}

async function disableTotp(req, res) {
  const data = await service.disableTotp(ctx(req), req.body.password);
  res.json({ data });
}

async function totpStatus(req, res) {
  const data = await service.totpStatus(ctx(req));
  res.json({ data });
}

// ── Access reviews ──────────────────────────────────────────

async function listReviews(req, res) {
  const result = await service.listReviews(ctx(req), req.query);
  res.json(result);
}

async function createReview(req, res) {
  const data = await service.createAccessReview(ctx(req), req.body);
  res.status(201).json({ data });
}

async function getReview(req, res) {
  const data = await service.getReview(ctx(req), req.params.reviewId);
  res.json({ data });
}

async function updateReview(req, res) {
  const data = await service.updateReview(
    ctx(req),
    req.params.reviewId,
    req.body,
  );
  res.json({ data });
}

async function decideEntry(req, res) {
  const data = await service.decideReviewEntry(
    ctx(req),
    req.params.entryId,
    req.body.decision,
    req.body.reviewer_note,
  );
  res.json({ data });
}

async function exportReview(req, res) {
  const format = req.query.format || "csv";
  const result = await service.exportReview(
    ctx(req),
    req.params.reviewId,
    format,
  );
  res.setHeader("Content-Type", result.content_type);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${result.filename}"`,
  );
  res.send(result.content);
}

// ── Audit ───────────────────────────────────────────────────

async function queryAuditLog(req, res) {
  const result = await service.queryAuditLog(ctx(req), req.query);
  // The admin audit table reads { rows, total }. Return that shape flat (no
  // top-level `data` key) so the api client doesn't unwrap it to a bare array
  // and drop the total.
  res.json({
    rows: result.rows ?? result.data ?? [],
    total: result.total ?? 0,
    page: result.page,
    page_size: result.page_size,
  });
}

async function getAuditEntry(req, res) {
  const data = await service.getAuditEntry(ctx(req), req.params.logId);
  res.json({ data });
}

async function getRecordTrail(req, res) {
  const data = await service.getRecordTrail(
    ctx(req),
    req.params.table,
    req.params.recordId,
  );
  res.json({ data });
}

async function exportAuditLog(req, res) {
  const result = await service.exportAuditLog(ctx(req), req.query);
  res.setHeader("Content-Type", result.content_type);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${result.filename}"`,
  );
  res.send(result.content);
}

// ── Security events ─────────────────────────────────────────

async function listSecurityEvents(req, res) {
  const result = await service.listSecurityEvents(ctx(req), req.query);
  // Admin reads { rows, total } — return flat so the api client keeps total.
  res.json({
    rows: result.rows ?? result.data ?? [],
    total: result.total ?? 0,
    page: result.page,
    page_size: result.page_size,
  });
}

module.exports = {
  // Dashboard
  getStats,
  // Users
  listUsers,
  getUserDetail,
  provisionStaffLogin,
  provisionExternalUser,
  deactivateUser,
  reactivateUser,
  adminResetPassword,
  sendResetLink,
  // Sessions (admin)
  listAllSessions,
  listUserSessions,
  revokeSession,
  revokeAllUserSessions,
  // Sessions (self-service)
  listMySessions,
  revokeMySession,
  // TOTP
  setupTotp,
  verifyTotp,
  disableTotp,
  totpStatus,
  // Access reviews
  listReviews,
  createReview,
  getReview,
  updateReview,
  decideEntry,
  exportReview,
  // Audit
  queryAuditLog,
  getAuditEntry,
  getRecordTrail,
  exportAuditLog,
  // Security events
  listSecurityEvents,
};
