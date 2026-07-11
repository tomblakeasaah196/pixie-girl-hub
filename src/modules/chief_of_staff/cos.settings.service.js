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

module.exports = { get, update };
