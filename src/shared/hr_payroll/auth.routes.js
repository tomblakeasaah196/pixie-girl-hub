/**
 * Authentication routes — login, refresh, logout, password reset, MFA.
 * No JWT required to call these (login is how you get the JWT).
 *
 * POST /api/v1/auth/login
 * POST /api/v1/auth/refresh
 * POST /api/v1/auth/logout
 * POST /api/v1/auth/forgot-password
 * POST /api/v1/auth/reset-password
 * POST /api/v1/auth/change-password   (requires auth)
 */

"use strict";

const express = require("express");
const controller = require("./auth.controller");
const { publicWriteLimiter } = require("../../middleware");

const router = express.Router();

router.post("/login", controller.login);
router.post("/refresh", controller.refresh);
router.post("/logout", controller.logout);
// Unauthenticated + side-effecting (email send, redis writes) → throttle per IP
// to blunt account-enumeration probing and email-bombing.
router.post("/forgot-password", publicWriteLimiter, controller.forgotPassword);
router.post("/reset-password", publicWriteLimiter, controller.resetPassword);

module.exports = router;
