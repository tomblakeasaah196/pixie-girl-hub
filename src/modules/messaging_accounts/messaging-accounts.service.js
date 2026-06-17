/**
 * Messaging Accounts — business logic.
 *
 * Owns the lifecycle of each (platform, external_account_id) row that
 * tells the smartcomm webhook handler which brand an inbound belongs
 * to. Encrypts access tokens at rest, surfaces a "test" action that
 * pings the provider so the CEO can verify the config without sending
 * a real message.
 */

"use strict";

const axios = require("axios");
const repo = require("./messaging-accounts.repo");
const crypto = require("../../services/encryption.service");
const smartcommRepo = require("../smartcomm/smartcomm.repo");
const { audit } = require("../../middleware/audit");
const { config } = require("../../config/env");
const { NotFoundError, AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");

function listAccounts({ brand }) {
  return repo.list({ brand });
}

async function getAccount({ id }) {
  const row = await repo.get({ id });
  if (!row) throw new NotFoundError("Messaging account");
  // Strip ciphertext from the return value — the admin UI only ever
  // sees the `has_access_token` boolean.
  delete row.access_token_enc;
  return row;
}

async function upsertAccount({ brand, user, request_id, input }) {
  const access_token_enc = input.access_token
    ? crypto.encrypt(input.access_token)
    : null;
  const saved = await repo.upsert({
    brand,
    user_id: user.user_id,
    input,
    access_token_enc,
  });
  // Invalidate smartcomm's in-memory lookup so the next webhook
  // doesn't see stale routing data.
  if (smartcommRepo.invalidateMessagingAccountCache) {
    smartcommRepo.invalidateMessagingAccountCache();
  }
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "messaging_accounts.upsert",
    target_type: "messaging_account",
    target_id: saved.account_id,
    after: {
      platform: saved.platform,
      external_account_id: saved.external_account_id,
      is_active: saved.is_active,
      access_token_set: !!access_token_enc,
    },
    request_id,
  });
  return saved;
}

async function setActive({ brand, user, request_id, id, is_active }) {
  const row = await repo.setActive({ id, is_active });
  if (!row) throw new NotFoundError("Messaging account");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "messaging_accounts.set_active",
    target_type: "messaging_account",
    target_id: id,
    after: { is_active },
    request_id,
  });
  return row;
}

async function removeAccount({ brand, user, request_id, id }) {
  const row = await repo.remove({ id });
  if (!row) throw new NotFoundError("Messaging account");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "messaging_accounts.delete",
    target_type: "messaging_account",
    target_id: id,
    request_id,
  });
}

/**
 * Test a configured account by pinging the provider. Doesn't send a
 * real message — just verifies the token can authenticate.
 *
 *   whatsapp  → GET /{phone_number_id}     (Meta Graph)
 *   instagram → GET /{ig_business_id}      (Meta Graph)
 *   facebook  → GET /{page_id}             (Meta Graph)
 *   email     → DNS check on the inbound domain's MX record
 */
async function testAccount({ id }) {
  const row = await repo.getRaw({ id });
  if (!row) throw new NotFoundError("Messaging account");
  const token = row.access_token_enc ? crypto.decrypt(row.access_token_enc) : null;
  const v = config.META_GRAPH_VERSION || "v21.0";

  try {
    if (row.platform === "whatsapp" || row.platform === "instagram" || row.platform === "facebook") {
      if (!token) {
        throw new AppError(
          "NO_TOKEN",
          "No access token saved for this account",
          422,
        );
      }
      const url = `https://graph.facebook.com/${v}/${encodeURIComponent(row.external_account_id)}?fields=id,name`;
      const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000,
      });
      return {
        ok: true,
        platform: row.platform,
        provider_id: data && data.id,
        provider_name: data && data.name,
      };
    }
    if (row.platform === "email") {
      // For email we don't have a meaningful API ping; we resolve the
      // domain's MX record as a sanity check so the CEO knows DNS is
      // pointing at Cloudflare (or wherever the inbound mailbox lives).
      const dns = require("dns").promises;
      const domain = String(row.external_account_id).split("@")[1] || row.external_account_id;
      const records = await dns.resolveMx(domain);
      return {
        ok: true,
        platform: "email",
        mx_records: records.map((r) => ({ exchange: r.exchange, priority: r.priority })),
      };
    }
  } catch (err) {
    const status = err.response && err.response.status;
    logger.warn(
      { err: err.message, platform: row.platform, status },
      "messaging_accounts.test failed",
    );
    throw new AppError(
      err.code || "PROVIDER_PING_FAILED",
      err.message || "Provider check failed",
      status && status >= 400 && status < 500 ? status : 502,
    );
  }
  throw new AppError(
    "UNSUPPORTED_PLATFORM",
    `Test not implemented for ${row.platform}`,
    400,
  );
}

module.exports = {
  listAccounts,
  getAccount,
  upsertAccount,
  setActive,
  removeAccount,
  testAccount,
};
