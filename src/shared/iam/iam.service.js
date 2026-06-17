/**
 * IAM & Security service (V2.2 §3 — IAM module).
 *
 * Business logic layer: wraps repo calls in transactions where needed,
 * enforces invariants, hashes passwords, manages TOTP lifecycle, calls
 * the audit middleware, and emits domain events. Never touches req/res.
 *
 * Every mutating function receives a `ctx` object:
 *   { business, user_id, request_id }
 */

"use strict";

const crypto = require("crypto");
const argon2 = require("argon2");
const { hashOptions } = require("../../utils/password");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { getClient: getRedis } = require("../../config/redis");
const { encrypt, decrypt } = require("../../services/encryption.service");
const {
  AppError,
  NotFoundError,
  ConflictError,
} = require("../../utils/errors");
const repo = require("./iam.repo");
const events = require("./iam.events");

// ── TOTP helpers (RFC 6238, crypto-only, no external deps) ──

const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer) {
  let bits = "";
  for (const byte of buffer) {
    bits += byte.toString(2).padStart(8, "0");
  }
  // Pad to a multiple of 5
  while (bits.length % 5 !== 0) {
    bits += "0";
  }
  let encoded = "";
  for (let i = 0; i < bits.length; i += 5) {
    const idx = parseInt(bits.substring(i, i + 5), 2);
    encoded += BASE32_CHARS[idx];
  }
  return encoded;
}

function base32Decode(encoded) {
  let bits = "";
  for (const char of encoded.toUpperCase()) {
    const idx = BASE32_CHARS.indexOf(char);
    if (idx === -1) continue; // skip padding
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/**
 * Compute a TOTP code for a given time step counter.
 * RFC 6238 / RFC 4226: HMAC-SHA1, 6-digit truncation, 30s step.
 */
function computeTotp(secretBuffer, counter) {
  const counterBuf = Buffer.alloc(8);
  // Write counter as big-endian 64-bit
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);

  const hmac = crypto.createHmac("sha1", secretBuffer).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(code % 1000000).padStart(6, "0");
}

/**
 * Verify a TOTP code against a secret, allowing +/- 1 time step window.
 */
function verifyTotpCode(secretBuffer, code) {
  const timeStep = 30;
  const counter = Math.floor(Date.now() / 1000 / timeStep);

  for (let i = -1; i <= 1; i++) {
    if (computeTotp(secretBuffer, counter + i) === code) {
      return true;
    }
  }
  return false;
}

// ── Redis session revocation (mirrors auth.service pattern) ─

async function revokeAllRedisTokens(userId) {
  const redis = getRedis();
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(
      cursor,
      "MATCH",
      "refresh:*",
      "COUNT",
      200,
    );
    cursor = next;
    if (keys.length) {
      const vals = await redis.mget(keys);
      const toDel = keys.filter((_, i) => vals[i] === String(userId));
      if (toDel.length) await redis.del(...toDel);
    }
  } while (cursor !== "0");
}

// ── CSV builder ─────────────────────────────────────────────

function escCsv(val) {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsv(headers, rows) {
  const lines = [headers.map(escCsv).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escCsv(row[h])).join(","));
  }
  return lines.join("\n");
}

// ── Dashboard ───────────────────────────────────────────────

async function getStats(ctx) {
  return repo.getSecurityStats(ctx.business);
}

// ── User management ─────────────────────────────────────────

async function listUsers(ctx, { search, status, profile_type, page, limit }) {
  return repo.listUsers({
    business: ctx.business,
    search,
    status,
    profile_type,
    page,
    limit,
  });
}

async function getUserDetail(ctx, userId) {
  const user = await repo.getUserDetail(userId);
  if (!user) throw new NotFoundError("User");
  return user;
}

async function provisionStaffLogin(ctx, profileId, input) {
  const tempPassword = crypto.randomBytes(16).toString("base64url");
  const password_hash = await argon2.hash(tempPassword, hashOptions);

  const user = await transaction(async (client) => {
    const created = await repo.provisionStaffLogin(client, profileId, {
      email: input.email,
      password_hash,
      default_business: input.default_business,
      permitted_businesses: input.permitted_businesses,
    });
    if (!created) {
      throw new NotFoundError("Staff profile");
    }
    return created;
  });

  await audit({
    business: ctx.business,
    user_id: ctx.user_id,
    action_key: "provision_login",
    target_type: "users",
    target_id: user.user_id,
    after: { email: user.email, profile_type: "staff" },
    request_id: ctx.request_id,
  });
  events.emit("user_provisioned", { business: ctx.business, user_id: user.user_id });

  return { ...user, temp_password: tempPassword };
}

async function provisionExternalUser(ctx, input) {
  const tempPassword = crypto.randomBytes(16).toString("base64url");
  const password_hash = await argon2.hash(tempPassword, hashOptions);

  const user = await transaction(async (client) => {
    return repo.provisionExternalUser(client, {
      email: input.email,
      password_hash,
      display_name: input.display_name,
      external_label: input.external_label || null,
      default_business: input.default_business,
      permitted_businesses: input.permitted_businesses,
    });
  });

  await audit({
    business: ctx.business,
    user_id: ctx.user_id,
    action_key: "provision_external",
    target_type: "users",
    target_id: user.user_id,
    after: { email: user.email, profile_type: "external", external_label: user.external_label },
    request_id: ctx.request_id,
  });
  events.emit("user_provisioned", { business: ctx.business, user_id: user.user_id });

  return { ...user, temp_password: tempPassword };
}

async function deactivateUser(ctx, userId) {
  const existing = await repo.findUserById(userId);
  if (!existing) throw new NotFoundError("User");
  if (existing.status === "disabled") {
    throw new ConflictError("User is already disabled");
  }
  if (existing.is_ceo) {
    throw new AppError("CANNOT_DEACTIVATE_CEO", "Cannot deactivate the CEO account", 403);
  }

  const user = await transaction(async (client) => {
    return repo.deactivateUser(client, userId);
  });

  // Revoke all Redis refresh tokens for this user
  await revokeAllRedisTokens(userId);

  await audit({
    business: ctx.business,
    user_id: ctx.user_id,
    action_key: "deactivate_login",
    target_type: "users",
    target_id: userId,
    before: { status: existing.status },
    after: { status: "disabled" },
    request_id: ctx.request_id,
  });
  events.emit("user_deactivated", { business: ctx.business, user_id: userId });

  return user;
}

async function reactivateUser(ctx, userId) {
  const existing = await repo.findUserById(userId);
  if (!existing) throw new NotFoundError("User");
  if (existing.status === "active") {
    throw new ConflictError("User is already active");
  }

  const user = await transaction(async (client) => {
    return repo.reactivateUser(client, userId);
  });

  await audit({
    business: ctx.business,
    user_id: ctx.user_id,
    action_key: "reactivate_login",
    target_type: "users",
    target_id: userId,
    before: { status: existing.status },
    after: { status: "active" },
    request_id: ctx.request_id,
  });
  events.emit("user_reactivated", { business: ctx.business, user_id: userId });

  return user;
}

async function adminResetPassword(ctx, userId) {
  const existing = await repo.findUserById(userId);
  if (!existing) throw new NotFoundError("User");

  const tempPassword = crypto.randomBytes(16).toString("base64url");
  const password_hash = await argon2.hash(tempPassword, hashOptions);

  await transaction(async (client) => {
    await repo.updatePassword(client, userId, password_hash);
  });

  // Revoke existing sessions so old credentials stop working
  await revokeAllRedisTokens(userId);
  await repo.deleteUserSessions(userId);

  await audit({
    business: ctx.business,
    user_id: ctx.user_id,
    action_key: "admin_reset_password",
    target_type: "users",
    target_id: userId,
    metadata: { admin_user_id: ctx.user_id },
    request_id: ctx.request_id,
    is_sensitive: true,
  });
  events.emit("password_reset", { business: ctx.business, user_id: userId });

  return { temp_password: tempPassword };
}

async function sendResetLink(ctx, userId) {
  const existing = await repo.findUserById(userId);
  if (!existing) throw new NotFoundError("User");

  // Reuse the auth service's forgot-password flow by importing it
  const authService = require("../hr_payroll/auth.service");
  await authService.forgotPassword({ email: existing.email });

  await audit({
    business: ctx.business,
    user_id: ctx.user_id,
    action_key: "send_reset_link",
    target_type: "users",
    target_id: userId,
    metadata: { email: existing.email },
    request_id: ctx.request_id,
  });

  return { sent: true };
}

// ── Sessions ────────────────────────────────────────────────

async function listAllSessions(ctx, { page, limit }) {
  return repo.listAllSessions({ page, limit });
}

async function listUserSessions(_ctx, userId) {
  return repo.listSessions(userId);
}

async function listMySessions(ctx) {
  return repo.listSessions(ctx.user_id);
}

async function revokeSession(ctx, userId, sessionId) {
  const deleted = await repo.deleteSession(sessionId);
  if (!deleted) throw new NotFoundError("Session");

  await revokeAllRedisTokens(userId);

  await audit({
    business: ctx.business,
    user_id: ctx.user_id,
    action_key: "session_revoked",
    target_type: "user_sessions",
    target_id: sessionId,
    metadata: { target_user_id: userId },
    request_id: ctx.request_id,
  });
  events.emit("session_revoked", { business: ctx.business, user_id: userId });

  return { revoked: true };
}

async function revokeAllUserSessions(ctx, userId) {
  const count = await repo.deleteUserSessions(userId);
  await revokeAllRedisTokens(userId);

  await audit({
    business: ctx.business,
    user_id: ctx.user_id,
    action_key: "all_sessions_revoked",
    target_type: "user_sessions",
    target_id: userId,
    metadata: { sessions_revoked: count },
    request_id: ctx.request_id,
  });
  events.emit("session_revoked", { business: ctx.business, user_id: userId });

  return { revoked: count };
}

async function revokeMySession(ctx, sessionId) {
  const deleted = await repo.deleteSession(sessionId);
  if (!deleted) throw new NotFoundError("Session");
  return { revoked: true };
}

// ── TOTP ────────────────────────────────────────────────────

async function setupTotp(ctx) {
  const user = await repo.findUserById(ctx.user_id);
  if (!user) throw new NotFoundError("User");
  if (user.totp_enabled) {
    throw new ConflictError("TOTP is already enabled. Disable it first to reconfigure.");
  }

  // Generate 20 random bytes as TOTP secret
  const secretBytes = crypto.randomBytes(20);
  const secretBase32 = base32Encode(secretBytes);

  // Encrypt the secret for storage
  const secretEnc = encrypt(secretBase32);
  await repo.setTotpSecret(ctx.user_id, secretEnc);

  // Build the otpauth URI for QR code generation
  const issuer = "PixieGirlHub";
  const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(user.email)}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

  return { secret: secretBase32, uri };
}

async function verifyTotp(ctx, code) {
  const record = await repo.getTotpSecret(ctx.user_id);
  if (!record || !record.totp_secret_enc) {
    throw new AppError("TOTP_NOT_SETUP", "TOTP has not been set up. Call setup first.", 400);
  }

  // Decrypt the stored secret
  const secretBase32 = decrypt(record.totp_secret_enc);
  const secretBuffer = base32Decode(secretBase32);

  if (!verifyTotpCode(secretBuffer, code)) {
    throw new AppError("INVALID_TOTP", "Invalid or expired TOTP code", 401);
  }

  // Mark TOTP as enabled
  await repo.enableTotp(ctx.user_id);

  await audit({
    business: ctx.business,
    user_id: ctx.user_id,
    action_key: "totp_enabled",
    target_type: "users",
    target_id: ctx.user_id,
    request_id: ctx.request_id,
  });
  events.emit("totp_enabled", { business: ctx.business, user_id: ctx.user_id });

  return { enabled: true };
}

async function disableTotp(ctx, password) {
  const user = await repo.findUserById(ctx.user_id);
  if (!user) throw new NotFoundError("User");
  if (!user.totp_enabled) {
    throw new AppError("TOTP_NOT_ENABLED", "TOTP is not currently enabled", 400);
  }

  // Verify password before disabling TOTP (security confirmation)
  const ok = await argon2.verify(user.password_hash, password);
  if (!ok) {
    throw new AppError("INVALID_PASSWORD", "Password is incorrect", 401);
  }

  await repo.disableTotp(ctx.user_id);

  await audit({
    business: ctx.business,
    user_id: ctx.user_id,
    action_key: "totp_disabled",
    target_type: "users",
    target_id: ctx.user_id,
    request_id: ctx.request_id,
  });
  events.emit("totp_disabled", { business: ctx.business, user_id: ctx.user_id });

  return { disabled: true };
}

async function totpStatus(ctx) {
  const record = await repo.getTotpSecret(ctx.user_id);
  return {
    enabled: !!(record && record.totp_enabled),
    configured: !!(record && record.totp_secret_enc),
  };
}

// ── Access reviews ──────────────────────────────────────────

async function listReviews(ctx, { status, page, limit }) {
  return repo.listReviews({ business: ctx.business, status, page, limit });
}

async function getReview(ctx, reviewId) {
  const review = await repo.getReview(reviewId);
  if (!review) throw new NotFoundError("Access review");
  return review;
}

async function createAccessReview(ctx, input) {
  const result = await transaction(async (client) => {
    const review = await repo.createReview(client, {
      business: ctx.business,
      title: input.title,
      description: input.description,
      due_date: input.due_date,
      initiated_by: ctx.user_id,
    });

    // Snapshot all active users with their roles/permissions
    const snapshot = await repo.snapshotActiveUsers(client, ctx.business);
    if (snapshot.length > 0) {
      await repo.createReviewEntries(
        client,
        review.review_id,
        snapshot.map((u) => ({
          user_id: u.user_id,
          user_name: u.user_name,
          user_email: u.user_email,
          role_name: u.role_name || "no_role",
          businesses: u.businesses || [],
          permissions_snapshot: u.permissions_snapshot || [],
        })),
      );
    }

    return review;
  });

  await audit({
    business: ctx.business,
    user_id: ctx.user_id,
    action_key: "access_review.create",
    target_type: "access_reviews",
    target_id: result.review_id,
    after: { title: input.title },
    request_id: ctx.request_id,
  });
  events.emit("review_created", { business: ctx.business, review_id: result.review_id });

  return result;
}

async function updateReview(ctx, reviewId, patch) {
  const existing = await repo.getReview(reviewId);
  if (!existing) throw new NotFoundError("Access review");

  const updatePatch = { ...patch };

  // Auto-fill completion fields when completing
  if (patch.status === "completed") {
    updatePatch.completed_at = new Date().toISOString();
    updatePatch.completed_by = ctx.user_id;
  }

  const updated = await transaction(async (client) => {
    return repo.updateReview(client, reviewId, updatePatch);
  });
  if (!updated) throw new NotFoundError("Access review");

  await audit({
    business: ctx.business,
    user_id: ctx.user_id,
    action_key: "access_review.update",
    target_type: "access_reviews",
    target_id: reviewId,
    before: { status: existing.status },
    after: { status: updated.status },
    request_id: ctx.request_id,
  });
  events.emit("review_updated", { business: ctx.business, review_id: reviewId });

  return updated;
}

async function decideReviewEntry(ctx, entryId, decision, note) {
  const entry = await repo.getReviewEntry(entryId);
  if (!entry) throw new NotFoundError("Review entry");

  const updated = await transaction(async (client) => {
    return repo.updateReviewEntry(client, entryId, {
      decision,
      reviewer_note: note,
      decided_by: ctx.user_id,
    });
  });

  await audit({
    business: ctx.business,
    user_id: ctx.user_id,
    action_key: "access_review.decide",
    target_type: "access_review_entries",
    target_id: entryId,
    before: { decision: entry.decision },
    after: { decision, reviewer_note: note },
    metadata: { review_id: entry.review_id, target_user_id: entry.user_id },
    request_id: ctx.request_id,
  });
  events.emit("review_entry_decided", {
    business: ctx.business,
    review_id: entry.review_id,
    entry_id: entryId,
  });

  return updated;
}

async function completeReview(ctx, reviewId, note) {
  return updateReview(ctx, reviewId, {
    status: "completed",
    summary_note: note,
  });
}

async function exportReview(ctx, reviewId, format) {
  const review = await repo.getReviewExportData(reviewId);
  if (!review) throw new NotFoundError("Access review");

  const headers = [
    "entry_id",
    "user_name",
    "user_email",
    "role_name",
    "businesses",
    "decision",
    "reviewer_note",
    "decided_at",
  ];

  const rows = (review.entries || []).map((e) => ({
    ...e,
    businesses: Array.isArray(e.businesses) ? e.businesses.join("; ") : e.businesses,
  }));

  if (format === "csv") {
    return {
      content: buildCsv(headers, rows),
      content_type: "text/csv",
      filename: `access-review-${review.review_id}.csv`,
    };
  }

  // xlsx not available without a dependency — fall back to CSV
  return {
    content: buildCsv(headers, rows),
    content_type: "text/csv",
    filename: `access-review-${review.review_id}.csv`,
  };
}

// ── Audit ───────────────────────────────────────────────────

async function queryAuditLog(ctx, filters) {
  return repo.queryAuditLog({ business: ctx.business, ...filters });
}

async function getAuditEntry(ctx, logId) {
  const entry = await repo.getAuditEntry(logId);
  if (!entry) throw new NotFoundError("Audit entry");
  return entry;
}

async function getRecordTrail(_ctx, tableName, recordId) {
  return repo.getRecordTrail(tableName, recordId);
}

async function exportAuditLog(ctx, filters) {
  const rows = await repo.exportAuditLog({ business: ctx.business, ...filters });

  const headers = [
    "log_id",
    "occurred_at",
    "user_name",
    "user_email",
    "action_key",
    "target_type",
    "target_id",
    "ip_address",
    "is_sensitive",
    "metadata",
  ];

  const mappedRows = rows.map((r) => ({
    ...r,
    metadata: r.metadata ? JSON.stringify(r.metadata) : "",
  }));

  if (filters.format === "csv" || !filters.format) {
    return {
      content: buildCsv(headers, mappedRows),
      content_type: "text/csv",
      filename: `audit-log-${ctx.business}-${new Date().toISOString().slice(0, 10)}.csv`,
    };
  }

  // xlsx not available without a dependency — fall back to CSV
  return {
    content: buildCsv(headers, mappedRows),
    content_type: "text/csv",
    filename: `audit-log-${ctx.business}-${new Date().toISOString().slice(0, 10)}.csv`,
  };
}

// ── Security events (filtered audit feed for dashboard) ─────

async function listSecurityEvents(ctx, { page, limit }) {
  return repo.queryAuditLog({
    business: ctx.business,
    action: undefined,
    page,
    limit,
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
  // Sessions
  listAllSessions,
  listUserSessions,
  listMySessions,
  revokeSession,
  revokeAllUserSessions,
  revokeMySession,
  // TOTP
  setupTotp,
  verifyTotp,
  disableTotp,
  totpStatus,
  // Access reviews
  listReviews,
  getReview,
  createAccessReview,
  updateReview,
  decideReviewEntry,
  completeReview,
  exportReview,
  // Audit
  queryAuditLog,
  getAuditEntry,
  getRecordTrail,
  exportAuditLog,
  listSecurityEvents,
};
