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
const { audit } = require("../../middleware/audit");
const iamRepo = require("../iam/iam.repo");

// ── Password-reset + one-time-code (OTP) helpers ───────────
const RESET_PREFIX = "pwreset:";
const RESET_CD_PREFIX = "pwreset:cd:";
const ACTIVATE_PREFIX = "activate:";
const ACTIVATE_CD_PREFIX = "activate:cd:";
const MIN_PASSWORD_LEN = 8;
const PIN_RE = /^\d{6}$/;
// One-time email codes (account activation + password reset).
const OTP_TTL_SEC = 10 * 60; // 10 minutes
const OTP_RESEND_COOLDOWN_SEC = 45;
const OTP_MAX_ATTEMPTS = 5;

/** Cryptographically-strong 6-digit numeric code (000000–999999). */
const genOtp = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");

/** Mask an email for display: "jane.doe@x.com" → "ja******@x.com". */
function maskEmail(email) {
  const [local, domain] = String(email || "").split("@");
  if (!domain) return "your email";
  const shown = local.slice(0, 2);
  return `${shown}${"*".repeat(Math.max(1, local.length - shown.length))}@${domain}`;
}

/** Email a single-use verification code (account activation or password reset). */
async function sendOtpEmail(to, code, purpose) {
  const line =
    purpose === "reset"
      ? "Use this code to reset your password:"
      : "Use this code to activate your account:";
  await emailService.send({
    to,
    subject: `${code} is your Pixie Girl Hub verification code`,
    html: `<p>Hello,</p>
           <p>${line}</p>
           <p style="font-size:30px;font-family:monospace;letter-spacing:0.4em;font-weight:bold;">${code}</p>
           <p>This code expires in 10 minutes and can be used once. If you didn't request it, ignore this email.</p>`,
    text: `Your Pixie Girl Hub verification code is ${code} (expires in 10 minutes, single use).`,
  });
}

/**
 * Enforce the password policy: ≥8 chars AND at least one uppercase,
 * one digit and one special (non-alphanumeric) character. Throws
 * WEAK_PASSWORD (422) on any miss. Shared by resetPassword() and the
 * create-admin script (kept in lock-step by re-deriving the same rule).
 */
function assertStrongPassword(pw) {
  if (
    !pw ||
    typeof pw !== "string" ||
    pw.length < MIN_PASSWORD_LEN ||
    !/[A-Z]/.test(pw) ||
    !/[0-9]/.test(pw) ||
    !/[^A-Za-z0-9]/.test(pw)
  ) {
    throw new AppError(
      "WEAK_PASSWORD",
      "Password must be at least 8 characters and include an uppercase letter, a number, and a special character",
      422,
    );
  }
}

/**
 * Reject trivially-guessable PINs: all-same-digit (e.g. 000000) and
 * ascending/descending runs (012345 / 123456 / 543210). The PIN must
 * already match /^\d{6}$/ before this is called.
 */
function isWeakPin(pin) {
  if (/^(\d)\1{5}$/.test(pin)) return true; // all same digit
  const seqUp = "0123456789".repeat(2);
  const seqDown = "9876543210".repeat(2);
  return seqUp.includes(pin) || seqDown.includes(pin);
}

/**
 * Issue an access (15m) + refresh (14d) token pair for a user and store
 * the refresh jti in redis so it's revocable. Returns the same shape the
 * login flow returns. Shared by login() and loginPin() so PIN login is
 * byte-for-byte identical to password login.
 */
async function issueTokens(user) {
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
      role_names: user.role_names || [],
      available_businesses: user.available_businesses || [],
      default_business_key: user.default_business_key || null,
      email_verified: !!user.email_verified,
    },
    access_token,
    refresh_token,
    expires_in: 45 * 60,
  };
}
/**
 * Record the login session row for the IAM "active sessions" view. Shared by
 * password and PIN login so both behave identically.
 *
 * Awaited (so the sessions list is consistent the moment login returns) with a
 * couple of quick retries to ride out a transient DB blip — but non-fatal: a
 * persistent failure is logged and login still succeeds. The session row is an
 * audit/visibility artefact; it must never be the reason a valid user can't get
 * in. (Previously this was fire-and-forget, so a failed insert silently dropped
 * the session with no retry.)
 */
async function recordLoginSession(user, { ip, user_agent }) {
  const sessionExpiry = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  const payload = {
    session_id: uuidv4(),
    user_id: user.user_id,
    ip_address: ip || null,
    user_agent: user_agent || null,
    device_label: null,
    expires_at: sessionExpiry.toISOString(),
  };
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await iamRepo.createSession(payload);
      return;
    } catch (err) {
      if (attempt === 3) {
        logger.error(
          { err: err.message, user_id: user.user_id },
          "session record create failed after retries",
        );
        return;
      }
      await new Promise((r) => setTimeout(r, attempt * 150));
    }
  }
}

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
    audit({
      business: user.default_business_key || "system",
      user_id: user.user_id,
      action_key: "login",
      target_type: "users",
      target_id: user.user_id,
      metadata: { success: "false", reason: "invalid_password" },
      ip,
      user_agent,
      user_name: user.display_name || user.email,
      module: "auth",
    });
    throw new AppError("INVALID_CREDENTIALS", "Invalid email or password", 401);
  }
  await staffRepo.recordSuccessfulLogin(user.user_id, { ip, user_agent });

  const result = await issueTokens(user);

  await recordLoginSession(user, { ip, user_agent });

  audit({
    business: user.default_business_key || "system",
    user_id: user.user_id,
    action_key: "login",
    target_type: "users",
    target_id: user.user_id,
    metadata: { success: "true", method: "password" },
    ip,
    user_agent,
    user_name: user.display_name || user.email,
    module: "auth",
  });

  return result;
}

/**
 * PIN login — a second, low-friction factor for returning staff on
 * shared/kiosk devices. Identical token output to login(): same active/
 * locked checks, same recordable failure counter (locks at 5), same
 * { user, access_token, refresh_token, expires_in } shape.
 */
async function loginPin({ email, pin, ip, user_agent }) {
  if (!email || !pin || !PIN_RE.test(String(pin)))
    throw new AppError(
      "INVALID_CREDENTIALS",
      "Email and 6-digit PIN required",
      400,
    );

  const user = await staffRepo.findByEmail(String(email).toLowerCase());
  // Generic message until the account is confirmed to exist + be active
  // (no enumeration of which emails have accounts/PINs).
  if (!user)
    throw new AppError("INVALID_CREDENTIALS", "Invalid email or PIN", 401);
  if (user.status === "locked")
    throw new AppError(
      "USER_LOCKED",
      "Account locked. Contact administrator",
      423,
    );
  if (user.status !== "active")
    throw new AppError("USER_INACTIVE", "Account not active", 401);
  if (!user.pin_hash)
    throw new AppError("PIN_NOT_SET", "No PIN set for this account", 400);

  const ok = await argon2.verify(user.pin_hash, String(pin));
  if (!ok) {
    await staffRepo.recordPinFail(user.user_id);
    audit({
      business: user.default_business_key || "system",
      user_id: user.user_id,
      action_key: "login",
      target_type: "users",
      target_id: user.user_id,
      metadata: { success: "false", reason: "invalid_pin" },
      ip,
      user_agent,
      user_name: user.display_name || user.email,
      module: "auth",
    });
    throw new AppError("INVALID_CREDENTIALS", "Invalid email or PIN", 401);
  }
  await staffRepo.recordPinSuccess(user.user_id, { ip, user_agent });

  const result = await issueTokens(user);

  await recordLoginSession(user, { ip, user_agent });

  audit({
    business: user.default_business_key || "system",
    user_id: user.user_id,
    action_key: "login",
    target_type: "users",
    target_id: user.user_id,
    metadata: { success: "true", method: "pin" },
    ip,
    user_agent,
    user_name: user.display_name || user.email,
    module: "auth",
  });

  return result;
}

/**
 * Set (or replace) the caller's own login PIN. Enforces a 6-digit format
 * and rejects trivially-guessable values (all-same / sequential).
 */
async function setPin({ user_id, pin }) {
  const value = String(pin ?? "");
  if (!PIN_RE.test(value))
    throw new AppError("INVALID_PIN", "PIN must be 6 digits", 422);
  if (isWeakPin(value))
    throw new AppError(
      "WEAK_PIN",
      "PIN is too easy to guess — avoid repeated or sequential digits",
      422,
    );
  const pin_hash = await argon2.hash(value);
  await staffRepo.setPin(user_id, pin_hash);
}

/** Remove the caller's own login PIN. */
async function removePin({ user_id }) {
  await staffRepo.clearPin(user_id);
}

/** Whether the caller currently has a PIN set. */
async function getPinStatus({ user_id }) {
  const user = await staffRepo.findById(user_id);
  return { pin_set: !!(user && user.pin_hash) };
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
    expires_in: 45 * 60,
  };
}

async function logout({ refresh_token, user_id, ip, user_agent }) {
  if (!refresh_token) return;
  try {
    const payload = jwt.verify(refresh_token, config.JWT_SECRET);
    const redis = getRedis();
    await redis.del(`refresh:${payload.jti}`);
    if (user_id) {
      audit({
        business: "system",
        user_id,
        action_key: "logout",
        target_type: "users",
        target_id: user_id,
        ip,
        user_agent,
        module: "auth",
      });
    }
  } catch {
    // ignore — already invalid
  }
}

/**
 * Begin a password reset with a one-time email code. Stores a single-use
 * 6-digit OTP in redis (TTL OTP_TTL_SEC) keyed by email and emails it.
 * ALWAYS resolves without revealing whether the email exists or is active —
 * the controller returns 200 regardless (no account enumeration). A short
 * resend cooldown blunts email-bombing.
 */
async function forgotPassword({ email: rawEmail }) {
  if (!rawEmail || typeof rawEmail !== "string") return;
  const email = rawEmail.toLowerCase().trim();
  const user = await staffRepo.findByEmail(email);
  // Only issue a code for a real, active account — but never disclose that.
  if (!user || user.status !== "active") return;

  const redis = getRedis();
  const cdKey = RESET_CD_PREFIX + email;
  if (await redis.get(cdKey)) return; // one was just sent — silently ignore

  const otp = genOtp();
  await redis.set(
    RESET_PREFIX + email,
    JSON.stringify({ otp, user_id: user.user_id, attempts: 0 }),
    "EX",
    OTP_TTL_SEC,
  );
  await redis.set(cdKey, "1", "EX", OTP_RESEND_COOLDOWN_SEC);

  try {
    await sendOtpEmail(user.email, otp, "reset");
  } catch (err) {
    // Best-effort: the code is stored; surfacing the email failure would leak
    // that the address exists. Log it for ops; the user can retry.
    logger.error({ err: err.message }, "password reset email send failed");
  }
}

/**
 * Complete a password reset with the emailed OTP. Verifies the code for the
 * given email, sets the new argon2 password, consumes the code (single-use),
 * and revokes every existing session so any leaked/old credentials stop
 * working. Wrong codes are counted; too many burn the code.
 */
async function resetPassword({ email: rawEmail, otp, new_password }) {
  const email = String(rawEmail || "")
    .toLowerCase()
    .trim();
  if (!email || !otp)
    throw new AppError("INVALID_RESET_CODE", "Invalid or expired code", 400);
  assertStrongPassword(new_password);

  const redis = getRedis();
  const key = RESET_PREFIX + email;
  const raw = await redis.get(key);
  if (!raw)
    throw new AppError("INVALID_RESET_CODE", "Invalid or expired code", 400);

  const data = JSON.parse(raw);
  if (String(otp).trim() !== data.otp) {
    data.attempts = (data.attempts || 0) + 1;
    if (data.attempts >= OTP_MAX_ATTEMPTS) {
      await redis.del(key);
      throw new AppError(
        "TOO_MANY_ATTEMPTS",
        "Too many incorrect codes. Request a new one.",
        429,
      );
    }
    const ttl = await redis.ttl(key);
    await redis.set(
      key,
      JSON.stringify(data),
      "EX",
      ttl > 0 ? ttl : OTP_TTL_SEC,
    );
    throw new AppError("INVALID_RESET_CODE", "Invalid or expired code", 400);
  }

  const userId = data.user_id;
  const password_hash = await argon2.hash(new_password, hashOptions);
  await staffRepo.updatePassword(userId, password_hash);
  await redis.del(key); // single-use
  await revokeAllSessions(redis, userId);
}

async function changePassword({ user_id, current_password, new_password }) {
  const user = await staffRepo.findById(user_id);
  if (!user) throw new AppError("USER_NOT_FOUND", "User not found", 404);
  const ok = await argon2.verify(user.password_hash, current_password);
  if (!ok)
    throw new AppError(
      "INVALID_CREDENTIALS",
      "Current password is incorrect",
      401,
    );
  assertStrongPassword(new_password);
  const hash = await argon2.hash(new_password, hashOptions);
  await staffRepo.updatePassword(user_id, hash);
}

async function getMe({ user_id }) {
  const user = await staffRepo.findByIdWithProfile(user_id);
  if (!user) throw new AppError("USER_NOT_FOUND", "User not found", 404);
  return {
    user_id: user.user_id,
    email: user.email,
    display_name: user.display_name,
    avatar_url: user.avatar_url || null,
    phone: user.phone || null,
    job_title: user.job_title || null,
    department: user.department || null,
    employee_number: user.employee_number || null,
    is_ceo: user.is_ceo,
    email_verified: !!user.email_verified,
  };
}

// ── Email account activation (one-time verification) ───────

/**
 * Send a one-time activation code to the caller's own account email.
 * Rate-limited so it can't email-bomb. Returns { already: true } if the
 * account is already verified (idempotent — the banner is already gone).
 */
async function sendActivation({ user_id }) {
  const user = await staffRepo.findById(user_id);
  if (!user) throw new AppError("USER_NOT_FOUND", "User not found", 404);
  if (user.email_verified) {
    return { already: true, email_masked: maskEmail(user.email) };
  }

  const redis = getRedis();
  const cdKey = ACTIVATE_CD_PREFIX + user_id;
  if (await redis.get(cdKey)) {
    throw new AppError(
      "OTP_THROTTLED",
      "A code was just sent. Please wait a moment before requesting another.",
      429,
    );
  }

  const otp = genOtp();
  await redis.set(ACTIVATE_PREFIX + user_id, otp, "EX", OTP_TTL_SEC);
  await redis.set(cdKey, "1", "EX", OTP_RESEND_COOLDOWN_SEC);
  await sendOtpEmail(user.email, otp, "activate");

  return { sent: true, email_masked: maskEmail(user.email) };
}

/** Confirm the activation code and mark the account's email verified. */
async function confirmActivation({ user_id, otp }) {
  const redis = getRedis();
  const key = ACTIVATE_PREFIX + user_id;
  const stored = await redis.get(key);
  if (!stored)
    throw new AppError(
      "INVALID_OTP",
      "Verification code expired or not found. Request a new one.",
      400,
    );
  if (String(otp || "").trim() !== stored)
    throw new AppError("INVALID_OTP", "Incorrect verification code", 401);

  await redis.del(key); // single-use
  await staffRepo.setEmailVerified(user_id);

  audit({
    business: "system",
    user_id,
    action_key: "email_verified",
    target_type: "users",
    target_id: user_id,
    module: "auth",
  });

  return { verified: true };
}

async function updateMe({ user_id, display_name, phone }) {
  const updates = {};
  if (display_name !== undefined)
    updates.display_name =
      String(display_name).trim().slice(0, 120) || undefined;
  if (phone !== undefined)
    updates.phone = String(phone).trim().slice(0, 40) || undefined;
  await staffRepo.updateUserProfile(user_id, updates);
  return getMe({ user_id });
}

const storage = require("../../services/storage.service");
const { compressUpload } = require("../../services/media-compression.service");

async function uploadAvatar({ user_id, buffer, mimetype }) {
  // Optimise the avatar (and convert HEIC → JPEG) before storage.
  const shrunk = await compressUpload({
    buffer,
    mimetype,
    originalname: "avatar",
  });
  const ext =
    shrunk.mime_type === "image/png"
      ? "png"
      : shrunk.mime_type === "image/webp"
        ? "webp"
        : "jpg";
  const key = `avatars/${user_id}.${ext}`;
  const stored = await storage.put(shrunk.buffer, {
    key,
    contentType: shrunk.mime_type,
  });
  await staffRepo.updateUserProfile(user_id, { avatar_url: stored.public_url });
  return { avatar_url: stored.public_url };
}

// ── Email change (authed, OTP to new address) ─────────────
const EMAIL_CHANGE_PREFIX = "emailchange:";
const EMAIL_CHANGE_TTL = 600; // 10 minutes

async function requestEmailChange({ user_id, current_password, new_email }) {
  const user = await staffRepo.findById(user_id);
  if (!user) throw new AppError("USER_NOT_FOUND", "User not found", 404);

  const ok = await argon2.verify(user.password_hash, current_password);
  if (!ok)
    throw new AppError(
      "INVALID_CREDENTIALS",
      "Current password is incorrect",
      401,
    );

  const email = String(new_email || "")
    .toLowerCase()
    .trim();
  if (!email || !/.+@.+\..+/.test(email))
    throw new AppError("INVALID_EMAIL", "Enter a valid email address", 422);
  if (email === user.email)
    throw new AppError(
      "SAME_EMAIL",
      "That is already your current email address",
      422,
    );

  const existing = await staffRepo.findByEmail(email);
  if (existing)
    throw new AppError(
      "EMAIL_TAKEN",
      "That email address is already in use",
      409,
    );

  const otp = String(Math.floor(100000 + Math.random() * 900000));
  const redis = getRedis();
  await redis.set(
    EMAIL_CHANGE_PREFIX + user_id,
    JSON.stringify({ otp, new_email: email }),
    "EX",
    EMAIL_CHANGE_TTL,
  );

  await emailService.send({
    to: email,
    subject: "Verify your new email — Pixie Girl Hub",
    html: `<p>Hello,</p>
           <p>Your verification code for the email change is:</p>
           <p style="font-size:30px;font-family:monospace;letter-spacing:0.4em;font-weight:bold;">${otp}</p>
           <p>This code expires in 10 minutes. If you did not request this, ignore this email.</p>`,
    text: `Your Pixie Girl Hub email-change code: ${otp} (expires in 10 minutes)`,
  });
}

async function confirmEmailChange({ user_id, otp }) {
  const redis = getRedis();
  const key = EMAIL_CHANGE_PREFIX + user_id;
  const raw = await redis.get(key);
  if (!raw)
    throw new AppError(
      "INVALID_OTP",
      "Verification code expired or not found",
      400,
    );

  const { otp: storedOtp, new_email } = JSON.parse(raw);
  if (String(otp).trim() !== storedOtp)
    throw new AppError("INVALID_OTP", "Incorrect verification code", 400);

  // Read the old email before overwriting it.
  const user = await staffRepo.findById(user_id);
  const old_email = user?.email;

  await redis.del(key);
  await staffRepo.updateEmail(user_id, new_email);

  // Notify the old address so the account owner can act if this was unauthorised.
  if (old_email) {
    emailService
      .send({
        to: old_email,
        subject: "Your Pixie Girl Hub email address was changed",
        html: `<p>Hello,</p>
             <p>The email address on your Pixie Girl Hub account was just changed to
             <strong>${new_email}</strong>.</p>
             <p>If you made this change, you can ignore this message.</p>
             <p>If you did <strong>not</strong> make this change, please contact your
             administrator immediately to secure your account.</p>`,
        text: `Your Pixie Girl Hub account email was changed to ${new_email}. If you did not do this, contact your administrator immediately.`,
      })
      .catch((err) =>
        logger.error(
          { err: err.message },
          "email-change notification to old address failed",
        ),
      );
  }

  return { email: new_email };
}

module.exports = {
  login,
  loginPin,
  refresh,
  logout,
  forgotPassword,
  resetPassword,
  setPin,
  removePin,
  getPinStatus,
  assertStrongPassword,
  changePassword,
  getMe,
  updateMe,
  uploadAvatar,
  requestEmailChange,
  confirmEmailChange,
  sendActivation,
  confirmActivation,
};
