/**
 * Kaizen auth repository — parameterised SQL only. No business logic, no events.
 * Operates on the shared.kaizen_* tables (separate from the platform identity).
 */

"use strict";

const { query } = require("../../../config/database");

async function findOperatorByEmail(email) {
  const { rows } = await query(
    `SELECT operator_id, email, display_name, phone, password_hash,
            status, must_change_password
       FROM shared.kaizen_operators
      WHERE email = $1
      LIMIT 1`,
    [email],
  );
  return rows[0] || null;
}

async function findOperatorById(operatorId) {
  const { rows } = await query(
    `SELECT operator_id, email, display_name, phone, status,
            must_change_password, last_login_at
       FROM shared.kaizen_operators
      WHERE operator_id = $1
      LIMIT 1`,
    [operatorId],
  );
  return rows[0] || null;
}

async function findOperatorAuthById(operatorId) {
  const { rows } = await query(
    `SELECT operator_id, email, password_hash, status
       FROM shared.kaizen_operators
      WHERE operator_id = $1
      LIMIT 1`,
    [operatorId],
  );
  return rows[0] || null;
}

async function touchLastLogin(operatorId) {
  await query(
    `UPDATE shared.kaizen_operators
        SET last_login_at = now(), updated_at = now()
      WHERE operator_id = $1`,
    [operatorId],
  );
}

async function updatePassword(operatorId, passwordHash) {
  await query(
    `UPDATE shared.kaizen_operators
        SET password_hash = $2,
            must_change_password = FALSE,
            status = CASE WHEN status = 'invited' THEN 'active' ELSE status END,
            updated_at = now()
      WHERE operator_id = $1`,
    [operatorId, passwordHash],
  );
}

// ── Sessions (refresh tokens) ──────────────────────────────────────────────

async function createSession({
  operatorId,
  jti,
  refreshTokenHash,
  userAgent,
  ip,
  expiresAt,
}) {
  await query(
    `INSERT INTO shared.kaizen_operator_sessions
       (operator_id, jti, refresh_token_hash, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [operatorId, jti, refreshTokenHash, userAgent || null, ip || null, expiresAt],
  );
}

async function findLiveSessionByTokenHash(refreshTokenHash) {
  const { rows } = await query(
    `SELECT session_id, operator_id, jti, expires_at
       FROM shared.kaizen_operator_sessions
      WHERE refresh_token_hash = $1
        AND revoked_at IS NULL
        AND expires_at > now()
      LIMIT 1`,
    [refreshTokenHash],
  );
  return rows[0] || null;
}

async function revokeSession(sessionId) {
  await query(
    `UPDATE shared.kaizen_operator_sessions
        SET revoked_at = now()
      WHERE session_id = $1 AND revoked_at IS NULL`,
    [sessionId],
  );
}

async function revokeSessionByTokenHash(refreshTokenHash) {
  await query(
    `UPDATE shared.kaizen_operator_sessions
        SET revoked_at = now()
      WHERE refresh_token_hash = $1 AND revoked_at IS NULL`,
    [refreshTokenHash],
  );
}

async function revokeAllSessions(operatorId) {
  await query(
    `UPDATE shared.kaizen_operator_sessions
        SET revoked_at = now()
      WHERE operator_id = $1 AND revoked_at IS NULL`,
    [operatorId],
  );
}

// Revoke every session for an operator except the one identified by the given
// refresh-token hash (used on password change so the current session survives).
async function revokeAllSessionsExcept(operatorId, exceptTokenHash) {
  await query(
    `UPDATE shared.kaizen_operator_sessions
        SET revoked_at = now()
      WHERE operator_id = $1
        AND revoked_at IS NULL
        AND ($2::text IS NULL OR refresh_token_hash <> $2)`,
    [operatorId, exceptTokenHash || null],
  );
}

// ── Audit ──────────────────────────────────────────────────────────────────

async function writeAudit({ operatorId, action, targetType, targetId, metadata, ip }) {
  await query(
    `INSERT INTO shared.kaizen_audit_log
       (operator_id, action, target_type, target_id, metadata, ip)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      operatorId || null,
      action,
      targetType || null,
      targetId || null,
      metadata ? JSON.stringify(metadata) : "{}",
      ip || null,
    ],
  );
}

// ── Password Reset OTP ──────────────────────────────────────────────────────

async function createPasswordResetToken(email, code, expiresAt) {
  const { rows } = await query(
    `INSERT INTO shared.kaizen_password_reset_tokens
       (email, code, expires_at)
     VALUES ($1, $2, $3)
     RETURNING token_id, code, expires_at`,
    [email.toLowerCase(), code, expiresAt],
  );
  return rows[0];
}

async function findActiveResetTokenByCode(code) {
  const { rows } = await query(
    `SELECT token_id, email, code, attempt_count, max_attempts, expires_at
       FROM shared.kaizen_password_reset_tokens
      WHERE code = $1
        AND used_at IS NULL
        AND expires_at > now()
      LIMIT 1`,
    [code],
  );
  return rows[0] || null;
}

async function incrementResetTokenAttempts(tokenId) {
  const { rows } = await query(
    `UPDATE shared.kaizen_password_reset_tokens
        SET attempt_count = attempt_count + 1
      WHERE token_id = $1
     RETURNING attempt_count, max_attempts`,
    [tokenId],
  );
  return rows[0];
}

async function markResetTokenUsed(tokenId) {
  await query(
    `UPDATE shared.kaizen_password_reset_tokens
        SET used_at = now()
      WHERE token_id = $1`,
    [tokenId],
  );
}

async function revokeResetTokensByEmail(email) {
  await query(
    `UPDATE shared.kaizen_password_reset_tokens
        SET used_at = now()
      WHERE email = $1 AND used_at IS NULL`,
    [email.toLowerCase()],
  );
}

module.exports = {
  findOperatorByEmail,
  findOperatorById,
  findOperatorAuthById,
  touchLastLogin,
  updatePassword,
  createSession,
  findLiveSessionByTokenHash,
  revokeSession,
  revokeSessionByTokenHash,
  revokeAllSessions,
  revokeAllSessionsExcept,
  writeAudit,
  createPasswordResetToken,
  findActiveResetTokenByCode,
  incrementResetTokenAttempts,
  markResetTokenUsed,
  revokeResetTokensByEmail,
};
