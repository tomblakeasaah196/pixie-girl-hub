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
 * GET    /api/v1/auth/me             (requires auth) — profile
 * PATCH  /api/v1/auth/me             (requires auth) — update profile
 * POST   /api/v1/auth/me/avatar      (requires auth) — upload avatar
 * POST   /api/v1/auth/change-password (requires auth)
 */

"use strict";

const express = require("express");
const controller = require("./auth.controller");
const { publicWriteLimiter } = require("../../middleware");
const { authMiddleware } = require("../../middleware/auth");
const { brandContextMiddleware } = require("../../middleware/brand-context");
const multer = require("multer");
const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

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

router.post("/change-password", authMiddleware, controller.changePassword);
router.get("/me", authMiddleware, controller.getMe);
router.patch("/me", authMiddleware, controller.updateMe);
router.post("/me/avatar", authMiddleware, avatarUpload.single("avatar"), controller.uploadAvatar);
router.post("/change-email", authMiddleware, controller.requestEmailChange);
router.post("/verify-email-change", authMiddleware, controller.confirmEmailChange);

module.exports = router;
