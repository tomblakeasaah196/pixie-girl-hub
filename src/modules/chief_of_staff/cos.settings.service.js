/**
 * Chief of Staff (PR6) — settings business logic.
 *
 * Thin layer over cos.settings.repo: reads the effective settings (row or
 * defaults) and applies validated updates with an audit row. Settings are
 * per-user (the CEO's own Chief of Staff), so there is no brand scope on the
 * row itself — but writes are still audited under the caller's brand context.
 */

"use strict";

const repo = require("./cos.settings.repo");
const { audit } = require("../../middleware/audit");
const storage = require("../../services/storage.service");
const { compressUpload } = require("../../services/media-compression.service");

/** Effective settings for the user (saved row or defaults). */
function get({ user }) {
  return repo.get({ user_id: user.user_id });
}

/**
 * Apply a validated partial update (Zod-strict upstream). Materialises the row
 * on first write and audits the change.
 */
async function update({ user, brand, request_id, patch }) {
  const row = await repo.update({ user_id: user.user_id, patch });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "cos.settings.update",
    target_type: "cos_settings",
    target_id: user.user_id,
    after: patch,
    request_id,
  });
  return row;
}

/**
 * Store an uploaded image as the assistant's avatar and persist its URL on the
 * user's cos_settings row. Mirrors the /auth/me/avatar pipeline: HEIC→JPEG +
 * compress, deterministic storage key (so a re-upload overwrites the same file)
 * and a cache-busting ?v= so the new photo actually takes. Returns the versioned
 * URL for the client to swap in immediately.
 */
async function uploadAvatar({ user, brand, request_id, buffer, mimetype }) {
  const shrunk = await compressUpload({
    buffer,
    mimetype,
    originalname: "cos-avatar",
  });
  const ext =
    shrunk.mime_type === "image/png"
      ? "png"
      : shrunk.mime_type === "image/webp"
        ? "webp"
        : "jpg";
  const key = `cos-avatars/${user.user_id}.${ext}`;
  const stored = await storage.put(shrunk.buffer, {
    key,
    contentType: shrunk.mime_type,
  });
  const versioned = `${stored.public_url}?v=${Date.now()}`;
  const row = await repo.update({
    user_id: user.user_id,
    patch: { avatar_url: versioned },
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "cos.settings.avatar",
    target_type: "cos_settings",
    target_id: user.user_id,
    after: { avatar_url: versioned },
    request_id,
  });
  return { avatar_url: versioned, settings: row };
}

module.exports = { get, update, uploadAvatar };
