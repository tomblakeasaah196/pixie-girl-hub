/**
 * Platform Settings — service.
 *
 * Wraps the repo with the cross-cutting concerns that aren't its
 * job: transaction + audit on every write, and a Socket.IO
 * broadcast on appearance changes so every open browser re-themes
 * the moment the admin clicks Save (no F5 needed).
 */

"use strict";

const repo = require("./platform-settings.repo");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");

function emitBrandingUpdated(payload) {
  // Socket.IO is wired late in app boot; if a write lands during a
  // cold start (e.g. seed migration replay in tests) we simply skip
  // the broadcast rather than crash the request.
  try {
    const { getIo } = require("../../config/socket");
    getIo().emit("branding:updated", payload);
  } catch (_) {
    /* socket not initialised yet — non-fatal */
  }
}

async function getPlatformSettings() {
  return repo.getPlatformSettings({ client: null });
}

async function updatePlatformSettings({ user, request_id, input }) {
  return transaction(async (client) => {
    const before = await repo.getPlatformSettings({ client });
    const after = await repo.updatePlatformSettings({
      client,
      patch: input,
      user_id: user?.user_id,
    });
    await audit({
      // Platform-level, not tied to any one brand — '*' is the
      // canonical "all brands" marker the audit log understands.
      business: "*",
      user_id: user?.user_id,
      action_key: "platform_settings.update",
      target_type: "platform_settings",
      target_id: after?.settings_id || null,
      metadata: { fields: Object.keys(input) },
      request_id,
    });
    emitBrandingUpdated({ scope: "platform", updated_at: after?.updated_at });
    return after;
  });
}

async function listFonts() {
  return repo.listFonts({ client: null, activeOnly: true });
}

async function getPublicBranding() {
  return repo.getPublicBranding({ client: null });
}

module.exports = {
  getPlatformSettings,
  updatePlatformSettings,
  listFonts,
  getPublicBranding,
  emitBrandingUpdated,
};
