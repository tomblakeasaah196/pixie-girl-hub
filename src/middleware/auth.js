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
const userRepo = require("../modules/hr_payroll/staff.repo");

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

  const user = await userRepo.findById(payload.sub);
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
    jwt_iat: payload.iat,
    jwt_jti: payload.jti,
  };

  return next();
}

module.exports = { authMiddleware };
