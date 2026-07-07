/**
 * Device-binding service (migration 000304).
 *
 * Each employee enrols their own device(s) once, verified by an email OTP sent
 * to their registered account email (no SMS — product decision 2026-07-07).
 * A clock punch from an un-enrolled device is FLAGGED, never blocked (see
 * hr_ops.selfClock). Cap: 2 active devices per employee; the CEO is uncapped.
 * Every enrol/remove is written to device_change_log and pushed to HR live so
 * the "Devices" view doubles as the HR notification surface.
 *
 * OTP challenges live in Redis (TTL'd), exactly like the email-change flow in
 * auth.service — nothing device-related is persisted until the code verifies.
 *
 * Transactions, audit and events live here; SQL lives in devices.repo.
 */

"use strict";

const repo = require("./devices.repo");
const hrRepo = require("./hr_ops.repo");
const staffRepo = require("./staff.repo");
const events = require("./hr.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { getClient: getRedis } = require("../../config/redis");
const emailService = require("../../services/email.service");
const { AppError, NotFoundError, ConflictError } = require("../../utils/errors");

const MAX_DEVICES = 2; // per employee; CEO is uncapped
const OTP_TTL_SECONDS = 600; // 10 minutes
const RESEND_MIN_SECONDS = 45; // throttle re-issues to the same address
const ENROLL_PREFIX = "deviceotp:enroll:";
const REMOVE_PREFIX = "deviceotp:remove:";

const DEVICE_TYPES = new Set(["mobile", "laptop", "desktop", "tablet", "other"]);

// ── helpers ────────────────────────────────────────────────
function newOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/** partially hide an address: p***s@gmail.com */
function maskEmail(email) {
  const [local, domain] = String(email || "").split("@");
  if (!domain) return "your registered email";
  const head = local.slice(0, 1);
  const tail = local.length > 1 ? local.slice(-1) : "";
  return `${head}${"*".repeat(Math.max(1, local.length - 2))}${tail}@${domain}`;
}

async function resolveProfile({ brand, user }) {
  const profile = await hrRepo.profileForUser({ brand, userId: user.user_id });
  if (!profile) throw new NotFoundError("Staff profile");
  return profile;
}

/** The employee's registered account email — where every device OTP is sent. */
async function accountEmail(user) {
  const acct = await staffRepo.findById(user.user_id);
  if (!acct || !acct.email) {
    throw new AppError(
      "NO_EMAIL_ON_FILE",
      "Your account has no email address on file. Ask HR to add one before enrolling a device.",
      422,
    );
  }
  return acct.email;
}

async function issueChallenge({ prefix, userId, email, payload, purpose }) {
  const redis = getRedis();
  const key = prefix + userId;
  const existing = await redis.get(key);
  if (existing) {
    try {
      const { issued_at } = JSON.parse(existing);
      if (issued_at && Date.now() - issued_at < RESEND_MIN_SECONDS * 1000) {
        throw new AppError(
          "OTP_THROTTLED",
          "We just sent a code. Please wait a moment before requesting another.",
          429,
        );
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      // malformed cache entry — fall through and overwrite
    }
  }
  const otp = newOtp();
  await redis.set(
    key,
    JSON.stringify({ ...payload, otp, issued_at: Date.now() }),
    "EX",
    OTP_TTL_SECONDS,
  );
  await emailService.send({
    to: email,
    subject: `Your device ${purpose} code — Pixie Girl Hub`,
    html: `<p>Hello,</p>
           <p>Your code to ${purpose} for attendance clock-in is:</p>
           <p style="font-size:30px;font-family:monospace;letter-spacing:0.4em;font-weight:bold;">${otp}</p>
           <p>This code expires in 10 minutes. If you did not request this, ignore this email and tell HR.</p>`,
    text: `Your Pixie Girl Hub device ${purpose} code: ${otp} (expires in 10 minutes)`,
  });
  return { sent_to: maskEmail(email), expires_in: OTP_TTL_SECONDS };
}

async function readChallenge({ prefix, userId, otp }) {
  const redis = getRedis();
  const key = prefix + userId;
  const raw = await redis.get(key);
  if (!raw) {
    throw new AppError(
      "OTP_EXPIRED",
      "That code has expired. Request a new one and try again.",
      400,
    );
  }
  const data = JSON.parse(raw);
  if (String(otp).trim() !== data.otp) {
    throw new AppError("OTP_INVALID", "Incorrect code. Check it and try again.", 400);
  }
  return { key, data };
}

// ── read ───────────────────────────────────────────────────
async function listMyDevices({ brand, user }) {
  const profile = await resolveProfile({ brand, user });
  const devices = await repo.listActiveByProfile({ profileId: profile.profile_id });
  return {
    data: devices,
    max_devices: user.is_ceo ? null : MAX_DEVICES,
    can_add: user.is_ceo || devices.length < MAX_DEVICES,
  };
}

// ── enrol (email OTP) ──────────────────────────────────────
async function startEnrollment({ brand, user, input }) {
  const label = String(input.device_label || "").trim();
  if (!label) {
    throw new AppError(
      "DEVICE_LABEL_REQUIRED",
      "Give this device a name (e.g. “My iPhone”) so you can recognise it later.",
      400,
    );
  }
  const deviceType = DEVICE_TYPES.has(input.device_type) ? input.device_type : "mobile";
  const fingerprint = String(input.device_fingerprint || "").trim();
  if (!fingerprint) {
    throw new AppError(
      "DEVICE_FINGERPRINT_REQUIRED",
      "We couldn't identify this device. Reload the page and try again.",
      400,
    );
  }

  const profile = await resolveProfile({ brand, user });

  const already = await repo.findActiveByFingerprint({
    profileId: profile.profile_id,
    fingerprint,
  });
  if (already) {
    throw new ConflictError("This device is already enrolled.");
  }
  if (!user.is_ceo) {
    const count = await repo.countActive({ profileId: profile.profile_id });
    if (count >= MAX_DEVICES) {
      throw new AppError(
        "DEVICE_CAP_REACHED",
        `You already have ${MAX_DEVICES} devices enrolled. Remove one before adding another.`,
        409,
      );
    }
  }

  const email = await accountEmail(user);
  return issueChallenge({
    prefix: ENROLL_PREFIX,
    userId: user.user_id,
    email,
    purpose: "enrollment",
    payload: { fingerprint, label, deviceType },
  });
}

async function verifyEnrollment({ brand, user, request_id, input, requestMeta = {} }) {
  const { key, data } = await readChallenge({
    prefix: ENROLL_PREFIX,
    userId: user.user_id,
    otp: input.otp,
  });

  return transaction(async (client) => {
    const profile = await hrRepo.profileForUser({
      client,
      brand,
      userId: user.user_id,
    });
    if (!profile) throw new NotFoundError("Staff profile");

    // Re-check under the transaction — the cache is stale by design.
    const already = await repo.findActiveByFingerprint({
      client,
      profileId: profile.profile_id,
      fingerprint: data.fingerprint,
    });
    if (already) throw new ConflictError("This device is already enrolled.");

    if (!user.is_ceo) {
      const count = await repo.countActive({ client, profileId: profile.profile_id });
      if (count >= MAX_DEVICES) {
        throw new AppError(
          "DEVICE_CAP_REACHED",
          `You already have ${MAX_DEVICES} devices enrolled. Remove one before adding another.`,
          409,
        );
      }
    }

    let device;
    try {
      device = await repo.insertDevice({
        client,
        business: profile.business,
        profileId: profile.profile_id,
        userId: user.user_id,
        fingerprint: data.fingerprint,
        label: data.label,
        deviceType: data.deviceType,
        ip: requestMeta.ip_address,
      });
    } catch (err) {
      if (err && err.code === "23505") {
        throw new ConflictError("This device is already enrolled.");
      }
      throw err;
    }

    await repo.logChange({
      client,
      business: profile.business,
      profileId: profile.profile_id,
      deviceId: device.device_id,
      action: "enrolled",
      label: device.device_label,
      fingerprint: data.fingerprint,
      actorUserId: user.user_id,
      note: `${device.device_label} enrolled`,
    });
    await audit({
      business: profile.business,
      user_id: user.user_id,
      action_key: "hr_payroll.device_enrolled",
      target_type: "staff_devices",
      target_id: device.device_id,
      after: { device_label: device.device_label, device_type: device.device_type },
      request_id,
    });
    await getRedis().del(key);

    events.emit("device_changed", {
      brand,
      profile_id: profile.profile_id,
      device_id: device.device_id,
      action: "enrolled",
    });
    return device;
  });
}

// ── remove (email OTP) ─────────────────────────────────────
async function startRemoval({ brand, user, deviceId }) {
  const profile = await resolveProfile({ brand, user });
  const device = await repo.findByIdForProfile({
    profileId: profile.profile_id,
    deviceId,
  });
  if (!device || !device.is_active) throw new NotFoundError("Device");

  const email = await accountEmail(user);
  return issueChallenge({
    prefix: REMOVE_PREFIX,
    userId: user.user_id,
    email,
    purpose: "removal",
    payload: { device_id: deviceId, label: device.device_label },
  });
}

async function verifyRemoval({ brand, user, request_id, input }) {
  const { key, data } = await readChallenge({
    prefix: REMOVE_PREFIX,
    userId: user.user_id,
    otp: input.otp,
  });
  if (input.device_id && input.device_id !== data.device_id) {
    throw new AppError("OTP_INVALID", "That code was for a different device.", 400);
  }

  return transaction(async (client) => {
    const profile = await hrRepo.profileForUser({
      client,
      brand,
      userId: user.user_id,
    });
    if (!profile) throw new NotFoundError("Staff profile");

    const removed = await repo.deactivateDevice({
      client,
      deviceId: data.device_id,
      profileId: profile.profile_id,
    });
    if (!removed) throw new NotFoundError("Device");

    await repo.logChange({
      client,
      business: profile.business,
      profileId: profile.profile_id,
      deviceId: removed.device_id,
      action: "removed",
      label: removed.device_label,
      fingerprint: removed.device_fingerprint,
      actorUserId: user.user_id,
      note: `${removed.device_label} removed`,
    });
    await audit({
      business: profile.business,
      user_id: user.user_id,
      action_key: "hr_payroll.device_removed",
      target_type: "staff_devices",
      target_id: removed.device_id,
      before: { device_label: removed.device_label },
      request_id,
    });
    await getRedis().del(key);

    events.emit("device_changed", {
      brand,
      profile_id: profile.profile_id,
      device_id: removed.device_id,
      action: "removed",
    });
    return { removed: true, device_id: removed.device_id };
  });
}

// ── HR & Staff views ───────────────────────────────────────
async function listAllDevices({ brand }) {
  return { data: await repo.listAllWithDevices({ brand }) };
}

async function listChangeFeed({ brand, limit }) {
  return { data: await repo.listChangeFeed({ brand, limit }) };
}

module.exports = {
  listMyDevices,
  startEnrollment,
  verifyEnrollment,
  startRemoval,
  verifyRemoval,
  listAllDevices,
  listChangeFeed,
  MAX_DEVICES,
};
