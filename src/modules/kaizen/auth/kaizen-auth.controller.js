/**
 * Kaizen auth controller — thin HTTP handlers. Mounted at /api/v1/kaizen/auth.
 *
 * Access token is returned in the JSON body (kept in memory by the client).
 * Refresh token is set as an httpOnly, Secure, SameSite=Strict cookie scoped to
 * this auth path — never returned in the body, never in localStorage.
 */

"use strict";

const express = require("express");

const service = require("./kaizen-auth.service");
const { kaizenAuthMiddleware } = require("./kaizen-auth.middleware");
const v = require("./kaizen-auth.validator");
const operatorsService = require("../operators/operators.service");

const router = express.Router();

function meta(req) {
  return { userAgent: req.headers["user-agent"], ip: req.ip };
}

function setRefreshCookie(res, token) {
  res.cookie(service.REFRESH_COOKIE, token, service.refreshCookieOptions());
}
function clearRefreshCookie(res) {
  const opts = service.refreshCookieOptions();
  res.clearCookie(service.REFRESH_COOKIE, {
    path: opts.path,
    domain: opts.domain,
  });
}

router.post("/login", async (req, res) => {
  const input = v.loginSchema.parse(req.body);
  const result = await service.login({ ...input, ...meta(req) });
  setRefreshCookie(res, result.refresh_token);
  res.json({ operator: result.operator, access_token: result.access_token });
});

router.post("/refresh", async (req, res) => {
  const refreshToken = req.cookies?.[service.REFRESH_COOKIE];
  const result = await service.refresh({ refreshToken, ...meta(req) });
  setRefreshCookie(res, result.refresh_token);
  res.json({ operator: result.operator, access_token: result.access_token });
});

router.post("/logout", async (req, res) => {
  const refreshToken = req.cookies?.[service.REFRESH_COOKIE];
  await service.logout({ refreshToken, ip: req.ip });
  clearRefreshCookie(res);
  res.json({ ok: true });
});

router.post("/accept-invite", async (req, res) => {
  const input = v.acceptInviteSchema.parse(req.body);
  const result = await operatorsService.acceptInvite(input);
  res.json({ ok: true, ...result });
});

// ── Authenticated ───────────────────────────────────────────
router.get("/me", kaizenAuthMiddleware, async (req, res) => {
  res.json({ operator: req.operator });
});

router.post("/change-password", kaizenAuthMiddleware, async (req, res) => {
  const input = v.changePasswordSchema.parse(req.body);
  await service.changePassword({
    operatorId: req.operator.operator_id,
    currentPassword: input.current_password,
    newPassword: input.new_password,
    currentRefreshToken: req.cookies?.[service.REFRESH_COOKIE],
    ip: req.ip,
  });
  res.json({ ok: true });
});

// ── Forgot password (unauthenticated) ───────────────────────
// Always 200, even for an unknown address — see requestPasswordReset.
router.post("/forgot-password", async (req, res) => {
  const input = v.requestPasswordResetSchema.parse(req.body);
  await service.requestPasswordReset(input.email, req.ip);
  res.json({ ok: true });
});

router.post("/verify-reset-code", async (req, res) => {
  const input = v.verifyResetCodeSchema.parse(req.body);
  const result = await service.verifyPasswordResetCode(input.email, input.code);
  res.json(result);
});

router.post("/reset-password", async (req, res) => {
  const input = v.resetPasswordSchema.parse(req.body);
  const result = await service.resetPasswordWithOtp({
    email: input.email,
    code: input.code,
    newPassword: input.new_password,
    ...meta(req),
  });
  setRefreshCookie(res, result.refresh_token);
  res.json({ operator: result.operator, access_token: result.access_token });
});

module.exports = { router };
