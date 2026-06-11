/**
 * Socket.io authentication middleware.
 * Verifies the JWT passed in `auth.token` (preferred) or `?token=` query.
 * Attaches socket.user with the same shape as req.user.
 */

"use strict";

const jwt = require("jsonwebtoken");
const { config } = require("../config/env");
const { logger } = require("../config/logger");
const staffRepo = require("../shared/hr_payroll/staff.repo");

async function authenticateSocket(socket, next) {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error("AUTH_REQUIRED"));

    const payload = jwt.verify(token, config.JWT_SECRET);
    const user = await staffRepo.findById(payload.sub);
    if (!user || user.status !== "active")
      return next(new Error("USER_INACTIVE"));

    socket.user = {
      user_id: user.user_id,
      email: user.email,
      is_ceo: user.is_ceo === true,
      available_businesses: user.available_businesses || [],
      role_ids: user.role_ids || [],
    };
    return next();
  } catch (err) {
    logger.warn({ err: err.message }, "socket auth failed");
    return next(new Error("AUTH_FAILED"));
  }
}

module.exports = { authenticateSocket };
