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

// ── Password reset (OTP over email) ────────────────────────────────────────

const RESET_CODE_TTL_MS = 15 * 60 * 1000;

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

/**
 * Request a reset code. Resolves the same way whether or not the email belongs
 * to an active operator — a 404 here would turn the endpoint into an operator
 * enumeration oracle, which the login path deliberately avoids too.
 */
async function requestPasswordReset(email, ip) {
  const op = await repo.findOperatorByEmail(email);
  if (!op || op.status !== "active") return;

  // crypto.randomInt, not Math.random — this is a credential.
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MS);

  // One live code at a time: a fresh request invalidates the previous one.
  await repo.revokeResetTokensForOperator(op.operator_id);
  await repo.createPasswordResetToken({
    operatorId: op.operator_id,
    codeHash: sha256(code),
    expiresAt,
  });

  await emailService.send({
    to: op.email,
    subject: "Your Kaizen password reset code",
    html:
      `<p>Hi ${escapeHtml(op.display_name || "there")},</p>` +
      `<p>Use this code to set a new Kaizen password:</p>` +
      `<p style="font-size:28px;font-weight:700;letter-spacing:6px;">${code}</p>` +
      `<p>It expires in 15 minutes and can be used once.</p>` +
      `<p>If you didn't request this, you can ignore this email — your ` +
      `password hasn't changed.</p>`,
    text:
      `Your Kaizen password reset code is ${code}\n\n` +
      `It expires in 15 minutes and can be used once.\n` +
      `If you didn't request this, ignore this email.`,
  });

  await repo.writeAudit({
    operatorId: op.operator_id,
    action: "auth.password_reset_requested",
    ip,
  });
}

const invalidCode = () =>
  new AppError("KAIZEN_INVALID_OTP", "Invalid or expired code", 401, {
    user_message: "That code is invalid or has expired.",
  });

const codeAttemptsExceeded = () =>
  new AppError("KAIZEN_OTP_ATTEMPTS_EXCEEDED", "Too many attempts", 429, {
    user_message: "Too many incorrect attempts. Request a new code.",
  });

/**
 * Resolve the live token for `email` and check `code` against it. The lookup is
 * keyed on the operator, never on the code alone — otherwise a guessed 6-digit
 * code would match ANY operator's live token, and the per-token attempt cap
 * would do nothing to slow a search of the 10^6 code space.
 *
 * A wrong guess burns one of the token's attempts.
 * @returns {Promise<{operator: object, tokenId: string}>}
 */
async function assertResetCode(email, code) {
  const op = await repo.findOperatorByEmail(email);
  if (!op || op.status !== "active") throw invalidCode();

  const token = await repo.findLiveResetTokenByOperator(op.operator_id);
  if (!token) throw invalidCode();
  if (token.attempt_count >= token.max_attempts) throw codeAttemptsExceeded();

  const supplied = Buffer.from(sha256(code), "hex");
  const expected = Buffer.from(token.code_hash, "hex");
  const ok =
    supplied.length === expected.length &&
    crypto.timingSafeEqual(supplied, expected);

  if (!ok) {
    const after = await repo.incrementResetTokenAttempts(token.token_id);
    if (after && after.attempt_count >= after.max_attempts) {
      throw codeAttemptsExceeded();
    }
    throw invalidCode();
  }

  return { operator: op, tokenId: token.token_id };
}

/** Step 2 of the flow: confirm the code before asking for a new password. Does
 *  NOT redeem the token — resetPasswordWithOtp still needs it. */
async function verifyPasswordResetCode(email, code) {
  await assertResetCode(email, code);
  return { ok: true };
}

async function resetPasswordWithOtp({ email, code, newPassword, userAgent, ip }) {
  const { operator, tokenId } = await assertResetCode(email, code);

  const hash = await argon2.hash(newPassword);
  await repo.updatePassword(operator.operator_id, hash);
  await repo.markResetTokenUsed(tokenId);
  // Anyone holding a session from before the reset loses it.
  await repo.revokeAllSessions(operator.operator_id);
  await repo.writeAudit({
    operatorId: operator.operator_id,
    action: "auth.password_reset_completed",
    ip,
  });

  // Re-read so must_change_password reflects the update we just made.
  const fresh = await repo.findOperatorById(operator.operator_id);
  const { accessToken, refreshToken } = await issueTokens(fresh, {
    userAgent,
    ip,
  });
  return {
    operator: publicOperator(fresh),
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
