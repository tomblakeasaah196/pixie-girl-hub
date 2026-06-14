/**
 * Auth service — login / refresh / logout business logic.
 * See auth.controller.js for the HTTP contract.
 */

"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const argon2 = require("argon2");
const { hashOptions } = require("../../utils/password");
const { v4: uuidv4 } = require("uuid");
const { config } = require("../../config/env");
const { AppError } = require("../../utils/errors");
const { getClient: getRedis } = require("../../config/redis");
const { logger } = require("../../config/logger");
const emailService = require("../../services/email.service");
const staffRepo = require("./staff.repo");

// ── Password-reset helpers ─────────────────────────────────
const RESET_PREFIX = "pwreset:";
const MIN_PASSWORD_LEN = 8;
const sha256 = (raw) => crypto.createHash("sha256").update(raw).digest("hex");
const resetTtlSec = () => (config.PASSWORD_RESET_TTL_MIN || 30) * 60;
const resetLink = (raw) =>
  `${String(config.APP_URL || "").replace(/\/$/, "")}/reset-password?token=${raw}`;

/**
 * Revoke every refresh session for a user. Refresh tokens live in redis as
 * `refresh:{jti}` with the user_id as the value, so we SCAN for those whose
 * value is this user and delete them. (Internal-tool scale → the keyspace is
 * small; SCAN keeps this off the hot login/refresh path.) Access tokens are
 * short-lived (≈15 min) and expire on their own.
 */
async function revokeAllSessions(redis, userId) {
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

async function login({ email, password, ip, user_agent }) {
  if (!email || !password)
    throw new AppError(
      "INVALID_CREDENTIALS",
      "Email and password required",
      400,
    );
  const user = await staffRepo.findByEmail(email.toLowerCase());
  if (!user)
    throw new AppError("INVALID_CREDENTIALS", "Invalid email or password", 401);
  if (user.status === "locked")
    throw new AppError(
      "USER_LOCKED",
      "Account locked. Contact administrator",
      423,
    );
  if (user.status !== "active")
    throw new AppError("USER_INACTIVE", "Account not active", 401);

  const ok = await argon2.verify(user.password_hash, password);
  if (!ok) {
    await staffRepo.recordFailedLogin(user.user_id);
    throw new AppError("INVALID_CREDENTIALS", "Invalid email or password", 401);
  }
  await staffRepo.recordSuccessfulLogin(user.user_id, { ip, user_agent });

  const access_jti = uuidv4();
  const refresh_jti = uuidv4();
  const payload = { sub: user.user_id, jti: access_jti, email: user.email };

  const access_token = jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_ACCESS_EXPIRES_IN,
  });
  const refresh_token = jwt.sign(
    { sub: user.user_id, jti: refresh_jti, type: "refresh" },
    config.JWT_SECRET,
    { expiresIn: config.JWT_REFRESH_EXPIRES_IN },
  );

  // Store refresh jti in redis so it's revocable
  const redis = getRedis();
  await redis.set(
    `refresh:${refresh_jti}`,
    user.user_id,
    "EX",
    14 * 24 * 60 * 60,
  );

  return {
    user: {
      user_id: user.user_id,
      email: user.email,
      display_name: user.display_name,
      is_ceo: user.is_ceo,
      available_businesses: user.available_businesses || [],
      default_business_key: user.default_business_key || null,
    },
    access_token,
    refresh_token,
    expires_in: 15 * 60,
  };
}

async function refresh({ refresh_token }) {
  if (!refresh_token)
    throw new AppError("NO_REFRESH_TOKEN", "Refresh token missing", 401);
  let payload;
  try {
    payload = jwt.verify(refresh_token, config.JWT_SECRET);
  } catch {
    throw new AppError("INVALID_TOKEN", "Refresh token invalid", 401);
  }
  if (payload.type !== "refresh")
    throw new AppError("INVALID_TOKEN", "Not a refresh token", 401);

  const redis = getRedis();
  const stored = await redis.get(`refresh:${payload.jti}`);
  if (!stored || stored !== payload.sub) {
    throw new AppError("TOKEN_REVOKED", "Refresh token revoked", 401);
  }

  // Rotate: revoke old, issue new
  await redis.del(`refresh:${payload.jti}`);
  const new_refresh_jti = uuidv4();
  const new_access_jti = uuidv4();
  const access_token = jwt.sign(
    { sub: payload.sub, jti: new_access_jti },
    config.JWT_SECRET,
    { expiresIn: config.JWT_ACCESS_EXPIRES_IN },
  );
  const new_refresh_token = jwt.sign(
    { sub: payload.sub, jti: new_refresh_jti, type: "refresh" },
    config.JWT_SECRET,
    { expiresIn: config.JWT_REFRESH_EXPIRES_IN },
  );
  await redis.set(
    `refresh:${new_refresh_jti}`,
    payload.sub,
    "EX",
    14 * 24 * 60 * 60,
  );

  return {
    access_token,
    refresh_token: new_refresh_token,
    expires_in: 15 * 60,
  };
}

async function logout({ refresh_token }) {
  if (!refresh_token) return;
  try {
    const payload = jwt.verify(refresh_token, config.JWT_SECRET);
    const redis = getRedis();
    await redis.del(`refresh:${payload.jti}`);
  } catch {
    // ignore — already invalid
  }
}

/**
 * Begin a password reset. Generates a single-use raw token, stores only its
 * SHA-256 hash in redis (TTL = PASSWORD_RESET_TTL_MIN), and emails the raw token
 * as a link. ALWAYS resolves without revealing whether the email exists or is
 * active — the controller returns 200 regardless (no account enumeration).
 */
async function forgotPassword({ email: rawEmail }) {
  if (!rawEmail || typeof rawEmail !== "string") return;
  const user = await staffRepo.findByEmail(rawEmail.toLowerCase().trim());
  // Only issue a token for a real, active account — but never disclose that.
  if (!user || user.status !== "active") return;

  const rawToken = crypto.randomBytes(32).toString("hex");
  const token_hash = sha256(rawToken);
  const redis = getRedis();
  await redis.set(RESET_PREFIX + token_hash, user.user_id, "EX", resetTtlSec());

  try {
    const link = resetLink(rawToken);
    const mins = Math.round(resetTtlSec() / 60);
    await emailService.send({
      to: user.email,
      subject: "Reset your Pixie Girl Hub password",
      html: `<p>Hello${user.display_name ? " " + user.display_name : ""},</p>
             <p>We received a request to reset your password. This link expires in ${mins} minutes:</p>
             <p><a href="${link}">Reset your password</a></p>
             <p>If you didn't request this, you can safely ignore this email — your password will not change.</p>`,
      text: `Reset your Pixie Girl Hub password (link expires in ${mins} minutes): ${link}`,
    });
  } catch (err) {
    // Best-effort: the token is stored; surfacing the email failure would leak
    // that the address exists. Log it for ops; the user can retry.
    logger.error({ err: err.message }, "password reset email send failed");
  }
}

/**
 * Complete a password reset. Verifies the token against its stored hash, sets
 * the new argon2 password, consumes the token (single-use), and revokes every
 * existing session so any leaked/old credentials stop working.
 */
async function resetPassword({ token, new_password }) {
  if (!token || typeof token !== "string")
    throw new AppError(
      "INVALID_RESET_TOKEN",
      "Invalid or expired reset link",
      400,
    );
  if (
    !new_password ||
    typeof new_password !== "string" ||
    new_password.length < MIN_PASSWORD_LEN
  )
    throw new AppError(
      "WEAK_PASSWORD",
      `Password must be at least ${MIN_PASSWORD_LEN} characters`,
      422,
    );

  const redis = getRedis();
  const key = RESET_PREFIX + sha256(token);
  const userId = await redis.get(key);
  if (!userId)
    throw new AppError(
      "INVALID_RESET_TOKEN",
      "Invalid or expired reset link",
      400,
    );

  const password_hash = await argon2.hash(new_password, hashOptions);
  await staffRepo.updatePassword(userId, password_hash);
  await redis.del(key); // single-use
  await revokeAllSessions(redis, userId);
}

module.exports = { login, refresh, logout, forgotPassword, resetPassword };
