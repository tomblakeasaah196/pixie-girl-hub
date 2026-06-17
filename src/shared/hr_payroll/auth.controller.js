/**
 * Auth controller — issues + refreshes JWTs.
 *
 * Login flow:
 *   1. Validate email + password (argon2 verify)
 *   2. Check user is active, not locked
 *   3. Increment failed_login_count on bad password; lock at 5
 *   4. Issue access_token (15m) + refresh_token (14d) — refresh stored in
 *      redis keyed by jti so it can be revoked
 *   5. Set httpOnly refresh cookie; return access token in body
 */

"use strict";

const service = require("./auth.service");
const permissionsRepo = require("../org_workflow/permissions.repo");
const { AppError } = require("../../utils/errors");

async function login(req, res) {
  const { email, password } = req.body || {};
  const result = await service.login({
    email,
    password,
    ip: req.ip,
    user_agent: req.headers["user-agent"],
  });
  res.cookie("refresh_token", result.refresh_token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: 14 * 24 * 60 * 60 * 1000,
  });
  res.json({
    data: {
      user: result.user,
      access_token: result.access_token,
      expires_in: result.expires_in,
    },
  });
}

async function loginPin(req, res) {
  const { email, pin } = req.body || {};
  const result = await service.loginPin({
    email,
    pin,
    ip: req.ip,
    user_agent: req.headers["user-agent"],
  });
  res.cookie("refresh_token", result.refresh_token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: 14 * 24 * 60 * 60 * 1000,
  });
  res.json({
    data: {
      user: result.user,
      access_token: result.access_token,
      expires_in: result.expires_in,
    },
  });
}

async function pinStatus(req, res) {
  res.json({ data: await service.getPinStatus({ user_id: req.user.user_id }) });
}

async function setPin(req, res) {
  await service.setPin({ user_id: req.user.user_id, pin: req.body?.pin });
  res.json({ data: { ok: true } });
}

async function removePin(req, res) {
  await service.removePin({ user_id: req.user.user_id });
  res.json({ data: { ok: true } });
}

async function refresh(req, res) {
  const token = req.cookies?.refresh_token;
  const result = await service.refresh({ refresh_token: token });
  res.cookie("refresh_token", result.refresh_token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    maxAge: 14 * 24 * 60 * 60 * 1000,
  });
  res.json({
    data: { access_token: result.access_token, expires_in: result.expires_in },
  });
}

async function logout(req, res) {
  const token = req.cookies?.refresh_token;
  await service.logout({
    refresh_token: token,
    user_id: req.user?.user_id,
    ip: req.ip,
    user_agent: req.headers["user-agent"],
  });
  res.clearCookie("refresh_token");
  res.status(204).end();
}

async function forgotPassword(req, res) {
  await service.forgotPassword({ email: req.body?.email });
  // Always 200 — don't leak whether email exists
  res.json({ data: { sent: true } });
}

async function resetPassword(req, res) {
  await service.resetPassword({
    token: req.body?.token,
    new_password: req.body?.new_password,
  });
  res.json({ data: { ok: true } });
}

/**
 * GET /auth/me/permissions
 * Returns the calling user's effective permission grants for the active brand.
 * CEO gets a synthetic '*' grant. No extra permission required.
 */
async function mePermissions(req, res) {
  if (req.user.is_ceo) {
    return res.json({ data: [{ module: "*", action: "*", record_scope: "all" }] });
  }
  const { rows } = await permissionsRepo.findAllForRoles({ role_ids: req.user.role_ids });
  res.json({ data: rows });
}

async function changePassword(req, res) {
  await service.changePassword({
    user_id: req.user.user_id,
    current_password: req.body?.current_password,
    new_password: req.body?.new_password,
  });
  res.json({ data: { ok: true } });
}

async function getMe(req, res) {
  const data = await service.getMe({ user_id: req.user.user_id });
  res.json({ data });
}

async function updateMe(req, res) {
  const data = await service.updateMe({
    user_id: req.user.user_id,
    display_name: req.body?.display_name,
    phone: req.body?.phone,
  });
  res.json({ data });
}

async function uploadAvatar(req, res) {
  if (!req.file) throw new AppError('NO_FILE', 'No file uploaded', 422);
  const data = await service.uploadAvatar({
    user_id: req.user.user_id,
    buffer: req.file.buffer,
    mimetype: req.file.mimetype,
  });
  res.json({ data });
}

async function requestEmailChange(req, res) {
  await service.requestEmailChange({
    user_id: req.user.user_id,
    current_password: req.body?.current_password,
    new_email: req.body?.new_email,
  });
  res.json({ data: { sent: true } });
}

async function confirmEmailChange(req, res) {
  const data = await service.confirmEmailChange({
    user_id: req.user.user_id,
    otp: req.body?.otp,
  });
  res.json({ data });
}

module.exports = {
  login,
  loginPin,
  pinStatus,
  setPin,
  removePin,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  mePermissions,
  changePassword,
  getMe,
  updateMe,
  uploadAvatar,
  requestEmailChange,
  confirmEmailChange,
};
