/**
 * Geoapify Settings — business logic.
 *
 * One platform-wide API key, encrypted at rest (AES-256-GCM), masked to its
 * first 4 characters in every response, revealed only after the caller's
 * login password is re-verified (argon2 against shared.users.password_hash —
 * same re-auth as messaging_accounts / apify_settings), with every reveal
 * logged. See apify-settings.service.js for the pattern this mirrors.
 *
 * resolveActiveApiKey() is what src/services/geoapify.service.js calls (via
 * a lazy require, to avoid a top-level circular dependency — this module
 * requires geoapify.service.js for testConnection) to source the key that
 * used to live in GEOAPIFY_API_KEY.
 */

"use strict";

const argon2 = require("argon2");
const repo = require("./geoapify-settings.repo");
const crypto = require("../../services/encryption.service");
const geoapifyClient = require("../../services/geoapify.service");
const staffRepo = require("../../shared/hr_payroll/staff.repo");
const { audit } = require("../../middleware/audit");
const { AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");

function first4(s) {
  const str = String(s || "");
  return str.length >= 4 ? str.slice(0, 4) : str;
}

async function getSettings() {
  return repo.get();
}

async function upsertSettings({ user, request_id, input }) {
  const fields = {};
  if (input.api_key) {
    fields.api_key_enc = crypto.encrypt(input.api_key);
    fields.api_key_first4 = first4(input.api_key);
    fields.secrets_last_rotated_at = new Date().toISOString();
  }
  if (input.is_active !== undefined) fields.is_active = input.is_active;
  if (input.notes !== undefined) fields.notes = input.notes;

  const saved = await repo.upsert({ user_id: user.user_id, fields });
  // A freshly saved/rotated key must take effect immediately, not after the
  // geoapify.service in-process cache's TTL expires.
  geoapifyClient.invalidateKeyCache();
  await audit({
    business: null,
    user_id: user.user_id,
    action_key: "geoapify_settings.upsert",
    target_type: "geoapify_settings",
    target_id: saved.setting_id,
    after: { is_active: saved.is_active, secrets_rotated: !!fields.api_key_enc },
    request_id,
  });
  return saved;
}

/**
 * Password-verified reveal of the stored API key. Field is always
 * "api_key" — kept as an explicit param (not hardcoded in the controller)
 * so the shape matches messaging_accounts / apify_settings' reveal contract.
 */
async function revealSecret({ user, request_id, field, password, source_ip }) {
  if (field !== "api_key") {
    throw new AppError("VALIDATION_ERROR", `Unknown secret field '${field}'`, 400);
  }
  if (!password) {
    throw new AppError("VALIDATION_ERROR", "Password required to reveal a secret", 400);
  }

  const caller = await staffRepo.findById(user.user_id);
  if (!caller || !caller.password_hash) {
    throw new AppError("AUTH_REQUIRED", "Re-authentication required", 401);
  }
  let ok = false;
  try {
    ok = await argon2.verify(caller.password_hash, password);
  } catch (err) {
    logger.warn({ err: err.message, user_id: user.user_id }, "argon2 verify threw");
    ok = false;
  }
  if (!ok) {
    const existing = await repo.getRaw();
    await audit({
      business: null,
      user_id: user.user_id,
      action_key: "geoapify_settings.reveal_denied",
      target_type: "geoapify_settings",
      target_id: existing ? existing.setting_id : null,
      after: { field, reason: "invalid_password" },
      request_id,
    });
    throw new AppError("INVALID_PASSWORD", "Incorrect password", 401);
  }

  const row = await repo.getRaw();
  if (!row || !row.api_key_enc) {
    throw new AppError("SECRET_NOT_SET", "No Geoapify API key on file", 404);
  }
  let plaintext;
  try {
    plaintext = crypto.decrypt(row.api_key_enc);
  } catch (err) {
    logger.error({ err: err.message }, "geoapify_settings: decrypt failed");
    throw new AppError(
      "DECRYPT_FAILED",
      "Could not decrypt the stored key. The encryption key may have been rotated.",
      500,
    );
  }

  await repo.recordReveal({
    setting_id: row.setting_id,
    user_id: user.user_id,
    field,
    source_ip,
    request_id,
  });
  await audit({
    business: null,
    user_id: user.user_id,
    action_key: "geoapify_settings.reveal",
    target_type: "geoapify_settings",
    target_id: row.setting_id,
    after: { field },
    request_id,
  });
  return { field, value: plaintext };
}

async function listReveals() {
  const row = await repo.getRaw();
  if (!row) return [];
  return repo.listReveals({ setting_id: row.setting_id });
}

async function testConnection() {
  const row = await repo.getRaw();
  if (!row || !row.api_key_enc) {
    throw new AppError("NO_TOKEN", "No Geoapify API key saved", 422);
  }
  const apiKey = crypto.decrypt(row.api_key_enc);
  try {
    const result = await geoapifyClient.testConnection({ apiKey });
    await repo.recordTestResult({
      setting_id: row.setting_id,
      ok: true,
      message: result.sample_address ? `Connected — resolved "${result.sample_address}"` : "Connected",
    });
    return { ok: true, platform: "geoapify", ...result };
  } catch (err) {
    await repo.recordTestResult({
      setting_id: row.setting_id,
      ok: false,
      message: err.message,
    });
    throw err;
  }
}

/**
 * Internal resolver — decrypted key or null if not configured/inactive.
 * Called by src/services/geoapify.service.js (via a lazy require) to
 * replace what used to be a direct process.env.GEOAPIFY_API_KEY read.
 * NOT exported over HTTP.
 */
async function resolveActiveApiKey() {
  const row = await repo.getRaw();
  if (!row || !row.is_active || !row.api_key_enc) return null;
  return crypto.decrypt(row.api_key_enc);
}

module.exports = {
  getSettings,
  upsertSettings,
  revealSecret,
  listReveals,
  testConnection,
  resolveActiveApiKey,
};
