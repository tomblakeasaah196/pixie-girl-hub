/**
 * Settings module — service. Audit on every write; Socket.IO
 * `settings:updated` broadcast so open browsers refetch.
 *
 * Secrets are handled write-only: the plaintext is encrypted with the
 * AES-256-GCM encryption.service and never read back. This is the
 * secure alternative to writing API keys into .env at runtime.
 */

"use strict";

const repo = require("./settings.repo");
const crypto = require("../../services/encryption.service");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError } = require("../../utils/errors");

const A = (brand, user_id, action_key, target_type, target_id, metadata, request_id) =>
  audit({ business: brand, user_id, action_key, target_type, target_id, metadata, request_id });

function emitSettingsUpdated(payload) {
  try {
    require("../../config/socket").getIo().emit("settings:updated", payload);
  } catch (_) {
    /* socket not initialised — non-fatal */
  }
}

// ── document_templates ───────────────────────────────────
const listTemplates = ({ brand, doc_type }) =>
  repo.listTemplates({ client: null, brand, doc_type });

async function createTemplate({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const row = await repo.createTemplate({ client, brand, row: input, user_id: user?.user_id });
    await A(brand, user?.user_id, "settings.document_template.create", "document_template", row.template_id, { doc_type: row.doc_type }, request_id);
    emitSettingsUpdated({ tile: "document-templates", brand });
    return row;
  });
}
async function updateTemplate({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const existing = await repo.getTemplate({ client, brand, id });
    if (!existing) throw new NotFoundError("Template not found");
    const row = await repo.updateTemplate({ client, brand, id, patch: input, user_id: user?.user_id });
    await A(brand, user?.user_id, "settings.document_template.update", "document_template", id, { fields: Object.keys(input) }, request_id);
    emitSettingsUpdated({ tile: "document-templates", brand });
    return row;
  });
}
async function setDefaultTemplate({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const row = await repo.setDefaultTemplate({ client, brand, id });
    if (!row) throw new NotFoundError("Template not found");
    await A(brand, user?.user_id, "settings.document_template.set_default", "document_template", id, { doc_type: row.doc_type }, request_id);
    emitSettingsUpdated({ tile: "document-templates", brand });
    return row;
  });
}
async function deleteTemplate({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const ok = await repo.deleteTemplate({ client, brand, id });
    if (!ok) throw new NotFoundError("Template not found");
    await A(brand, user?.user_id, "settings.document_template.delete", "document_template", id, {}, request_id);
    emitSettingsUpdated({ tile: "document-templates", brand });
    return { deleted: true };
  });
}

// ── notification_preferences (per-user, self) ────────────
const listNotificationPrefs = ({ user }) =>
  repo.listNotificationPrefs({ client: null, user_id: user.user_id });

async function upsertNotificationPref({ user, request_id, input }) {
  return transaction(async (client) => {
    const row = await repo.upsertNotificationPref({ client, user_id: user.user_id, row: input });
    await A(null, user?.user_id, "settings.notification_pref.update", "notification_preference", row.pref_id, { channel: row.channel, category: row.category, enabled: row.enabled }, request_id);
    return row;
  });
}

// ── scheduled_reports ────────────────────────────────────
const listReports = ({ brand }) => repo.listReports({ client: null, brand });

async function createReport({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const row = await repo.createReport({ client, brand, row: input, user_id: user?.user_id });
    await A(brand, user?.user_id, "settings.scheduled_report.create", "scheduled_report", row.report_id, { name: row.name, cadence: row.cadence }, request_id);
    emitSettingsUpdated({ tile: "scheduled-reports", brand });
    return row;
  });
}
async function updateReport({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const existing = await repo.getReport({ client, brand, id });
    if (!existing) throw new NotFoundError("Report not found");
    const row = await repo.updateReport({ client, brand, id, patch: input });
    await A(brand, user?.user_id, "settings.scheduled_report.update", "scheduled_report", id, { fields: Object.keys(input) }, request_id);
    emitSettingsUpdated({ tile: "scheduled-reports", brand });
    return row;
  });
}
async function deleteReport({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const ok = await repo.deleteReport({ client, brand, id });
    if (!ok) throw new NotFoundError("Report not found");
    await A(brand, user?.user_id, "settings.scheduled_report.delete", "scheduled_report", id, {}, request_id);
    emitSettingsUpdated({ tile: "scheduled-reports", brand });
    return { deleted: true };
  });
}

// ── integration_secrets (write-only) ─────────────────────
// Returns only safe metadata — never the secret itself.
const listSecrets = ({ brand }) => repo.listSecrets({ client: null, brand });

async function setSecret({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const secret_enc = crypto.encrypt(input.secret);
    const last4 = String(input.secret).slice(-4);
    const row = await repo.upsertSecret({
      client,
      brand,
      row: { provider: input.provider, key_name: input.key_name, secret_enc, last4 },
      user_id: user?.user_id,
    });
    await A(brand, user?.user_id, "settings.integration_secret.set", "integration_secret", row.secret_id, { provider: input.provider, key_name: input.key_name, sensitive: true }, request_id);
    return row; // never includes secret_enc
  });
}
async function deleteSecret({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const ok = await repo.deleteSecret({ client, brand, id });
    if (!ok) throw new NotFoundError("Secret not found");
    await A(brand, user?.user_id, "settings.integration_secret.delete", "integration_secret", id, { sensitive: true }, request_id);
    return { deleted: true };
  });
}

// ── business_policies ────────────────────────────────────
// Settings owns content + editing here. Studio reads `is_published`
// rows separately to decide what shows on the public website.
const listPolicies = ({ brand, policy_type, status }) =>
  repo.listPolicies({ client: null, brand, policy_type, status });

async function createPolicy({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const row = await repo.createPolicy({ client, brand, row: input, user_id: user?.user_id });
    await A(brand, user?.user_id, "settings.policy.create", "business_policy", row.policy_id, { slug: row.slug, policy_type: row.policy_type }, request_id);
    emitSettingsUpdated({ tile: "policies", brand });
    return row;
  });
}
async function updatePolicy({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const existing = await repo.getPolicy({ client, brand, id });
    if (!existing) throw new NotFoundError("Policy not found");
    // Bump version on body change so the renderer always reads the
    // latest published copy and an audit reviewer can diff revisions.
    const patch = { ...input };
    if (patch.body_html !== undefined && patch.body_html !== existing.body_html) {
      patch.version = (existing.version || 1) + 1;
    }
    const row = await repo.updatePolicy({ client, brand, id, patch, user_id: user?.user_id });
    await A(brand, user?.user_id, "settings.policy.update", "business_policy", id, { fields: Object.keys(input), is_published: row.is_published }, request_id);
    emitSettingsUpdated({ tile: "policies", brand });
    return row;
  });
}
async function deletePolicy({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const ok = await repo.deletePolicy({ client, brand, id });
    if (!ok) throw new NotFoundError("Policy not found");
    await A(brand, user?.user_id, "settings.policy.delete", "business_policy", id, {}, request_id);
    emitSettingsUpdated({ tile: "policies", brand });
    return { deleted: true };
  });
}

module.exports = {
  listTemplates,
  createTemplate,
  updateTemplate,
  setDefaultTemplate,
  deleteTemplate,
  listNotificationPrefs,
  upsertNotificationPref,
  listReports,
  createReport,
  updateReport,
  deleteReport,
  listSecrets,
  setSecret,
  deleteSecret,
  listPolicies,
  createPolicy,
  updatePolicy,
  deletePolicy,
};
