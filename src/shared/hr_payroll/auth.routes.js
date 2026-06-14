/**
 * Authentication routes — login, refresh, logout, password reset, MFA.
 * No JWT required to call these (login is how you get the JWT).
 *
 * POST   /api/v1/auth/login
 * POST   /api/v1/auth/login-pin
 * POST   /api/v1/auth/refresh
 * POST   /api/v1/auth/logout
 * POST   /api/v1/auth/forgot-password
 * POST   /api/v1/auth/reset-password
 * POST   /api/v1/auth/change-password   (requires auth)
 * GET    /api/v1/auth/pin               (requires auth) — { pin_set }
 * POST   /api/v1/auth/pin               (requires auth) — set/replace PIN
 * DELETE /api/v1/auth/pin               (requires auth) — remove PIN
 */

"use strict";

const express = require("express");
const controller = require("./auth.controller");
const { publicWriteLimiter } = require("../../middleware");
const { authMiddleware } = require("../../middleware/auth");
const { brandContextMiddleware } = require("../../middleware/brand-context");

const router = express.Router();

// Self-scoped permissions for the active brand (drives Command Center grid gating).
router.get(
  "/me/permissions",
  authMiddleware,
  brandContextMiddleware,
  controller.mePermissions,
);

router.post("/login", controller.login);
// PIN login — second, low-friction factor; public like /login.
router.post("/login-pin", controller.loginPin);
router.post("/refresh", controller.refresh);
router.post("/logout", controller.logout);

// PIN management for the authenticated caller. authMiddleware works
// per-route even though this router is mounted without it globally.
router.get("/pin", authMiddleware, controller.pinStatus);
router.post("/pin", authMiddleware, controller.setPin);
router.delete("/pin", authMiddleware, controller.removePin);
// Unauthenticated + side-effecting (email send, redis writes) → throttle per IP
// to blunt account-enumeration probing and email-bombing.
router.post("/forgot-password", publicWriteLimiter, controller.forgotPassword);
router.post("/reset-password", publicWriteLimiter, controller.resetPassword);

module.exports = router;
