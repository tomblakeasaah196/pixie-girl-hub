/**
 * Customer auth business logic. Access = short-lived JWT (typ:"customer", held
 * in memory by the website). Refresh = opaque random token, httpOnly cookie,
 * rotated on every refresh (old session revoked, new one created). Passwords
 * hashed with argon2 on shared.contacts.storefront_password_hash.
 */

"use strict";

const crypto = require("crypto");
const argon2 = require("argon2");
const jwt = require("jsonwebtoken");
const repo = require("./customer-auth.repo");
const { config } = require("../../config/env");
const { AppError } = require("../../utils/errors");
// Required as `emailService` (the register/login params are named `email`).
const emailService = require("../../services/email.service");

const VERIFY_TTL_MIN = 24 * 60; // 24h
const RESET_TTL_MIN = 60; // 1h

function newEmailToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function storefrontLink(brand, path) {
  const domain = await repo.storefrontDomain(brand);
  if (!domain) return null;
  const base = /^https?:\/\//.test(domain) ? domain : `https://${domain}`;
  return `${base.replace(/\/$/, "")}${path}`;
}

/** Best-effort: issue + email a verification link. Never throws to the caller. */
async function sendVerifyEmail({ brand, contact }) {
  try {
    if (!contact || !contact.email) return;
    const raw = newEmailToken();
    await repo.createEmailToken({
      contact_id: contact.contact_id,
      raw_token: raw,
      purpose: "verify_email",
      ttlMinutes: VERIFY_TTL_MIN,
    });
    const link = await storefrontLink(
      brand,
      `/auth?mode=verify&token=${encodeURIComponent(raw)}`,
    );
    if (!link) return;
    const name = contact.first_name || "there";
    await emailService.send({
      brand,
      to: contact.email,
      subject: "Confirm your email",
      text: `Hi ${name}, confirm your email: ${link}`,
      html: `<p>Hi ${name},</p><p>Please confirm your email address to finish setting up your account.</p><p><a href="${link}">Confirm my email</a></p><p>This link expires in 24 hours.</p>`,
    });
  } catch {
    // Email failures must never block registration.
  }
}

function accessToken(contact_id) {
  return jwt.sign({ sub: contact_id, typ: "customer" }, config.JWT_SECRET, {
    expiresIn: config.JWT_ACCESS_EXPIRES_IN || "15m",
  });
}

function newRefreshToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function register({
  brand,
  email,
  password,
  first_name,
  last_name,
  phone,
  user_agent,
  ip,
}) {
  if (!email || !password)
    throw new AppError(
      "MISSING_FIELDS",
      "Email and password are required.",
      422,
    );
  if (String(password).length < 8)
    throw new AppError(
      "WEAK_PASSWORD",
      "Please use a password of at least 8 characters.",
      422,
    );

  const existing = await repo.findContactByEmail(email);
  if (existing && existing.storefront_password_hash)
    throw new AppError(
      "EMAIL_IN_USE",
      "An account with this email already exists. Please sign in.",
      409,
    );

  const hash = await argon2.hash(password);
  let contact;
  if (existing) {
    // Known contact (e.g. from a guest order) claiming their account.
    await repo.setPasswordHash(existing.contact_id, hash);
    contact = await repo.getProfile(existing.contact_id);
  } else {
    contact = await repo.createCustomerContact({
      email,
      first_name,
      last_name,
      phone,
      password_hash: hash,
      brand,
    });
  }

  const refresh = newRefreshToken();
  await repo.createSession({
    contact_id: contact.contact_id,
    refresh_token: refresh,
    user_agent,
    ip,
  });
  await sendVerifyEmail({ brand, contact });
  return {
    contact,
    access_token: accessToken(contact.contact_id),
    refresh_token: refresh,
  };
}

async function login({ email, password, user_agent, ip }) {
  const c = await repo.findContactByEmail(email);
  if (!c || !c.storefront_password_hash)
    throw new AppError(
      "INVALID_CREDENTIALS",
      "Incorrect email or password.",
      401,
    );
  const ok = await argon2
    .verify(c.storefront_password_hash, password)
    .catch(() => false);
  if (!ok)
    throw new AppError(
      "INVALID_CREDENTIALS",
      "Incorrect email or password.",
      401,
    );

  const refresh = newRefreshToken();
  await repo.createSession({
    contact_id: c.contact_id,
    refresh_token: refresh,
    user_agent,
    ip,
  });
  const contact = await repo.getProfile(c.contact_id);
  return {
    contact,
    access_token: accessToken(c.contact_id),
    refresh_token: refresh,
  };
}

async function refresh({ refresh_token, user_agent, ip }) {
  if (!refresh_token)
    throw new AppError("NO_REFRESH", "Session expired. Please sign in.", 401);
  const session = await repo.findLiveSession(refresh_token);
  if (!session)
    throw new AppError(
      "INVALID_REFRESH",
      "Session expired. Please sign in.",
      401,
    );
  // Rotate: revoke the presented token, issue a fresh one.
  await repo.revokeSession(refresh_token);
  const next = newRefreshToken();
  await repo.createSession({
    contact_id: session.contact_id,
    refresh_token: next,
    user_agent,
    ip,
  });
  return { access_token: accessToken(session.contact_id), refresh_token: next };
}

async function logout({ refresh_token }) {
  if (refresh_token) await repo.revokeSession(refresh_token);
  return { ok: true };
}

async function me({ contact_id }) {
  const contact = await repo.getProfile(contact_id);
  if (!contact) throw new AppError("NOT_FOUND", "Account not found.", 404);
  const loyalty_points = await repo.loyaltyPoints(contact_id);
  return { ...contact, loyalty_points };
}

function listOrders({ brand, contact_id }) {
  return repo.listOrders({ brand, contact_id });
}

// ── Email verification ─────────────────────────────────────
async function verifyEmail({ token }) {
  if (!token) throw new AppError("MISSING_TOKEN", "Verification link is invalid.", 422);
  const row = await repo.findLiveEmailToken({
    raw_token: token,
    purpose: "verify_email",
  });
  if (!row)
    throw new AppError(
      "INVALID_TOKEN",
      "This verification link is invalid or has expired.",
      400,
    );
  await repo.markEmailVerified(row.contact_id);
  await repo.consumeEmailToken(row.token_hash);
  return { ok: true };
}

// ── Password reset ─────────────────────────────────────────
// Always returns ok (don't reveal whether an email exists). When the email
// maps to a real account, we issue + send a reset link.
async function forgotPassword({ brand, email }) {
  try {
    const c = await repo.findContactByEmail(email);
    if (c) {
      const raw = newEmailToken();
      await repo.createEmailToken({
        contact_id: c.contact_id,
        raw_token: raw,
        purpose: "reset_password",
        ttlMinutes: RESET_TTL_MIN,
      });
      const link = await storefrontLink(
        brand,
        `/auth?mode=reset&token=${encodeURIComponent(raw)}`,
      );
      if (link) {
        const name = c.first_name || "there";
        await emailService.send({
          brand,
          to: c.email,
          subject: "Reset your password",
          text: `Hi ${name}, reset your password: ${link}`,
          html: `<p>Hi ${name},</p><p>We received a request to reset your password.</p><p><a href="${link}">Choose a new password</a></p><p>This link expires in 1 hour. If you didn't ask for this, you can ignore this email.</p>`,
        });
      }
    }
  } catch {
    // Never leak failures on the forgot path.
  }
  return { ok: true };
}

async function resetPassword({ token, password }) {
  if (!token) throw new AppError("MISSING_TOKEN", "Reset link is invalid.", 422);
  if (!password || String(password).length < 8)
    throw new AppError(
      "WEAK_PASSWORD",
      "Please use a password of at least 8 characters.",
      422,
    );
  const row = await repo.findLiveEmailToken({
    raw_token: token,
    purpose: "reset_password",
  });
  if (!row)
    throw new AppError(
      "INVALID_TOKEN",
      "This reset link is invalid or has expired.",
      400,
    );
  const hash = await argon2.hash(password);
  await repo.setPasswordHash(row.contact_id, hash);
  await repo.consumeEmailToken(row.token_hash);
  // Security: a password reset revokes all existing sessions for that contact.
  await repo.revokeAllSessions(row.contact_id);
  return { ok: true };
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  me,
  listOrders,
  verifyEmail,
  forgotPassword,
  resetPassword,
};
