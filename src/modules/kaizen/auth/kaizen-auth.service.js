/**
 * Kaizen auth service — business logic for operator authentication.
 *
 * Deliberately SEPARATE from the platform auth (shared.users): distinct JWT
 * secret + `aud: "kaizen"` so a platform token can never be replayed here and
 * vice-versa. No internal RBAC — every active operator is a full admin — but
 * logins/changes are audit-logged.
 */

"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const argon2 = require("argon2");

const { config } = require("../../../config/env");
const { AppError } = require("../../../utils/errors");
const emailService = require("../../../services/email.service");
const repo = require("./kaizen-auth.repo");

const ACCESS_AUDIENCE = "kaizen";

/** Fail fast (only on the auth path) if Kaizen isn't configured — never touches
 *  the rest of the API, which boots fine without these vars. */
function requireSecret() {
  if (!config.KAIZEN_JWT_SECRET) {
    throw new AppError(
      "KAIZEN_NOT_CONFIGURED",
      "KAIZEN_JWT_SECRET is not set — Kaizen auth is unavailable",
      503,
      { user_message: "Kaizen is not configured on this server yet." },
    );
  }
  return config.KAIZEN_JWT_SECRET;
}

function sha256(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function signAccessToken(operatorId) {
  const jti = crypto.randomUUID();
  const token = jwt.sign({ sub: operatorId }, requireSecret(), {
    audience: ACCESS_AUDIENCE,
    expiresIn: config.KAIZEN_ACCESS_TTL,
    jwtid: jti,
  });
  return { token, jti };
}

function verifyAccessToken(token) {
  return jwt.verify(token, requireSecret(), { audience: ACCESS_AUDIENCE });
}

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/v1/kaizen/auth",
    domain: config.KAIZEN_COOKIE_DOMAIN || undefined,
    maxAge: config.KAIZEN_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}

const REFRESH_COOKIE = "kaizen_refresh";

function publicOperator(op) {
  return {
    operator_id: op.operator_id,
    email: op.email,
    display_name: op.display_name,
    must_change_password: op.must_change_password === true,
  };
}

/** Issue a fresh refresh-token session + a signed access token. */
async function issueTokens(operator, { userAgent, ip }) {
  const { token: accessToken } = signAccessToken(operator.operator_id);
  const refreshToken = crypto.randomBytes(48).toString("hex");
  const expiresAt = new Date(
    Date.now() + config.KAIZEN_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  await repo.createSession({
    operatorId: operator.operator_id,
    jti: crypto.randomUUID(),
    refreshTokenHash: sha256(refreshToken),
    userAgent,
    ip,
    expiresAt,
  });
  return { accessToken, refreshToken };
}

async function login({ email, password, userAgent, ip }) {
  requireSecret();
  const op = await repo.findOperatorByEmail(email);
  // Generic error either way — never reveal whether the email exists.
  const invalid = new AppError(
    "KAIZEN_INVALID_CREDENTIALS",
    "Invalid email or password",
    401,
    { user_message: "Invalid email or password." },
  );
  if (!op || op.status !== "active" || !op.password_hash) throw invalid;

  let ok = false;
  try {
    ok = await argon2.verify(op.password_hash, password);
  } catch {
    ok = false;
  }
  if (!ok) throw invalid;

  const { accessToken, refreshToken } = await issueTokens(op, { userAgent, ip });
  await repo.touchLastLogin(op.operator_id);
  await repo.writeAudit({
    operatorId: op.operator_id,
    action: "auth.login",
    ip,
  });

  return {
    operator: publicOperator(op),
    access_token: accessToken,
    refresh_token: refreshToken,
  };
}

async function refresh({ refreshToken, userAgent, ip }) {
  if (!refreshToken) {
    throw new AppError("KAIZEN_NO_REFRESH", "No refresh token", 401);
  }
  const session = await repo.findLiveSessionByTokenHash(sha256(refreshToken));
  if (!session) {
    throw new AppError("KAIZEN_INVALID_REFRESH", "Invalid or expired session", 401);
  }
  const op = await repo.findOperatorById(session.operator_id);
  if (!op || op.status !== "active") {
    throw new AppError("KAIZEN_OPERATOR_INACTIVE", "Operator not active", 401);
  }
  // Rotate: revoke the presented refresh token, mint a new pair.
  await repo.revokeSession(session.session_id);
  const { accessToken, refreshToken: newRefresh } = await issueTokens(op, {
    userAgent,
    ip,
  });
  return {
    operator: publicOperator(op),
    access_token: accessToken,
    refresh_token: newRefresh,
  };
}

async function logout({ refreshToken, operatorId, ip }) {
  if (refreshToken) await repo.revokeSessionByTokenHash(sha256(refreshToken));
  if (operatorId) {
    await repo.writeAudit({ operatorId, action: "auth.logout", ip });
  }
}

async function changePassword({
  operatorId,
  currentPassword,
  newPassword,
  currentRefreshToken,
  ip,
}) {
  const op = await repo.findOperatorAuthById(operatorId);
  if (!op || !op.password_hash) {
    throw new AppError("KAIZEN_OPERATOR_INACTIVE", "Operator not found", 404);
  }
  let ok = false;
  try {
    ok = await argon2.verify(op.password_hash, currentPassword);
  } catch {
    ok = false;
  }
  if (!ok) {
    throw new AppError(
      "KAIZEN_INVALID_CREDENTIALS",
      "Current password is incorrect",
      400,
      { user_message: "Your current password is incorrect." },
    );
  }
  const hash = await argon2.hash(newPassword);
  await repo.updatePassword(operatorId, hash);
  // Revoke every OTHER session (force re-login elsewhere) but keep the caller's
  // current session alive so they aren't logged out of the tab they're using.
  await repo.revokeAllSessionsExcept(
    operatorId,
    currentRefreshToken ? sha256(currentRefreshToken) : null,
  );
  await repo.writeAudit({ operatorId, action: "auth.change_password", ip });
}

async function requestPasswordReset(email, ip) {
  const op = await repo.findOperatorByEmail(email);
  if (!op || op.status !== "active") {
    throw new AppError(
      "KAIZEN_OPERATOR_NOT_FOUND",
      "No active operator found with that email",
      404,
      { user_message: "No active operator found with that email." },
    );
  }

  const code = Math.random().toString().slice(2, 8).padEnd(6, "0");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await repo.revokeResetTokensByEmail(email);
  await repo.createPasswordResetToken(email, code, expiresAt);

  const operatorName = op.display_name || "Operator";
  const html = `
    <p>Hi ${operatorName},</p>
    <p>You requested a password reset for your Kaizen account. Use this code to reset your password:</p>
    <h2 style="font-size: 24px; font-weight: bold; text-align: center; letter-spacing: 2px;">${code}</h2>
    <p>This code expires in 15 minutes.</p>
    <p>If you did not request this, please ignore this email.</p>
  `;

  await emailService.send({
    to: email,
    subject: "Kaizen Password Reset Code",
    html,
    text: `Your Kaizen password reset code is: ${code}\n\nThis code expires in 15 minutes.`,
  });

  await repo.writeAudit({
    action: "auth.password_reset_requested",
    metadata: { email },
    ip,
  });

  return { email };
}

async function verifyPasswordResetCode(code) {
  const token = await repo.findActiveResetTokenByCode(code);
  if (!token) {
    throw new AppError(
      "KAIZEN_INVALID_OTP",
      "Invalid or expired OTP",
      401,
      { user_message: "Invalid or expired code." },
    );
  }

  if (token.attempt_count >= token.max_attempts) {
    throw new AppError(
      "KAIZEN_OTP_ATTEMPTS_EXCEEDED",
      "Too many verification attempts",
      429,
      { user_message: "Too many attempts. Request a new code." },
    );
  }

  return { email: token.email, tokenId: token.token_id };
}

async function resetPasswordWithOtp(code, newPassword, ip) {
  const token = await repo.findActiveResetTokenByCode(code);
  if (!token) {
    throw new AppError(
      "KAIZEN_INVALID_OTP",
      "Invalid or expired OTP",
      401,
      { user_message: "Invalid or expired code." },
    );
  }

  if (token.attempt_count >= token.max_attempts) {
    throw new AppError(
      "KAIZEN_OTP_ATTEMPTS_EXCEEDED",
      "Too many verification attempts",
      429,
      { user_message: "Too many attempts. Request a new code." },
    );
  }

  const op = await repo.findOperatorByEmail(token.email);
  if (!op || op.status !== "active") {
    throw new AppError("KAIZEN_OPERATOR_INACTIVE", "Operator not found", 404);
  }

  const hash = await argon2.hash(newPassword);
  await repo.updatePassword(op.operator_id, hash);
  await repo.markResetTokenUsed(token.token_id);
  await repo.revokeAllSessions(op.operator_id);

  await repo.writeAudit({
    operatorId: op.operator_id,
    action: "auth.password_reset_completed",
    ip,
  });

  const { token: accessToken } = signAccessToken(op.operator_id);
  const refreshToken = crypto.randomBytes(48).toString("hex");
  const expiresAt = new Date(
    Date.now() + config.KAIZEN_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  await repo.createSession({
    operatorId: op.operator_id,
    jti: crypto.randomUUID(),
    refreshTokenHash: sha256(refreshToken),
    userAgent: null,
    ip,
    expiresAt,
  });

  return {
    operator: publicOperator(op),
    access_token: accessToken,
    refresh_token: refreshToken,
  };
}

module.exports = {
  login,
  refresh,
  logout,
  changePassword,
  requestPasswordReset,
  verifyPasswordResetCode,
  resetPasswordWithOtp,
  verifyAccessToken,
  refreshCookieOptions,
  publicOperator,
  sha256,
  REFRESH_COOKIE,
};
