/**
 * Authentication middleware.
 *
 * Expects `Authorization: Bearer <jwt>` on protected routes.
 * Verifies, loads user, attaches req.user. 401 on failure.
 *
 * The verified user is then a starting point for:
 *   - req.user.user_id            uuid
 *   - req.user.email
 *   - req.user.role_ids           []
 *   - req.user.is_ceo             boolean
 *   - req.user.available_businesses ['valid-brand-key'] | subset
 */

"use strict";

const jwt = require("jsonwebtoken");
const { config } = require("../config/env");
const { AppError } = require("../utils/errors");
const { getClient: getRedis } = require("../config/redis");
const identityCache = require("../shared/cache/identity-cache");
const sessionIdle = require("../shared/hr_payroll/session-idle");

async function authMiddleware(req, _res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    throw new AppError("AUTH_REQUIRED", "Authorization header missing", 401);
  }

  const token = header.slice("Bearer ".length).trim();
  let payload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET);
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      throw new AppError("TOKEN_EXPIRED", "Access token expired", 401);
    }
    throw new AppError("INVALID_TOKEN", "Invalid access token", 401);
  }

  // Idle-session enforcement (session-idle.js): the sid claim keys a redis
  // marker armed at login with a 45-minute TTL. Requests carrying
  // X-User-Activity (the admin app sets it only when a human touched the
  // page recently) re-arm the window; background traffic merely checks it.
  // A lapsed marker rejects the request even though the JWT itself is still
  // valid — a walked-away session stops working everywhere at once. Tokens
  // without a sid predate this enforcement and are rejected the same way
  // (their refresh is rejected too, so the user just re-logs-in once).
  if (!payload.sid) {
    throw new AppError(
      "SESSION_IDLE_TIMEOUT",
      "Session expired — sign in again",
      401,
    );
  }
  const alive =
    req.headers["x-user-activity"] === "1"
      ? await sessionIdle.touch(getRedis(), payload.sid)
      : await sessionIdle.isAlive(getRedis(), payload.sid);
  if (!alive) {
    throw new AppError(
      "SESSION_IDLE_TIMEOUT",
      "Signed out after inactivity — sign in again",
      401,
    );
  }

  // Cached auth projection (30 s TTL + event invalidation on deactivate/
  // role change/session revoke) — saves a DB round-trip on every request.
  const user = await identityCache.getAuthUser(payload.sub);
  if (!user || user.status !== "active") {
    throw new AppError("USER_INACTIVE", "User not found or inactive", 401);
  }

  req.user = {
    user_id: user.user_id,
    email: user.email,
    display_name: user.display_name,
    role_ids: user.role_ids || [],
    is_ceo: user.is_ceo === true,
    available_businesses: user.available_businesses || [],
    // The brand-context middleware documents a fallback to the user's home
    // brand; the column was loaded here but never attached, so that fallback
    // could never fire. Attach it so the documented resolution order works.
    default_business_key: user.default_business_key || null,
    jwt_iat: payload.iat,
    jwt_jti: payload.jti,
  };

  return next();
}

module.exports = { authMiddleware };
