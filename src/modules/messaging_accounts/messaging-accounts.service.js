/**
 * Messaging Accounts — business logic.
 *
 * Owns the lifecycle of each (platform, external_account_id) row that
 * tells the smartcomm webhook handler which brand an inbound belongs
 * to. Encrypts every secret at rest (AES-256-GCM), surfaces a masked
 * "first-4 + ****" view + a password-verified reveal endpoint so the
 * plaintext token never sits in the DOM. The provider "test" ping
 * uses the decrypted token to verify the config without sending a
 * real message.
 *
 * Design notes:
 *
 *   • Secrets live in *_enc columns (ciphertext) plus a plaintext
 *     *_first4 column for the masked pill. No plaintext is ever
 *     returned by list/get.
 *
 *   • `reveal(id, field, password)` verifies the caller's login
 *     password with argon2 against shared.users.password_hash, then
 *     decrypts + returns the requested plaintext. Every reveal is
 *     logged to shared.messaging_account_secret_reveals for audit.
 *
 *   • Failed-password attempts are audited so a brute-force sweep
 *     shows up in the security event feed.
 */

"use strict";

const axios = require("axios");
const argon2 = require("argon2");
const repo = require("./messaging-accounts.repo");
const crypto = require("../../services/encryption.service");
const smartcommRepo = require("../smartcomm/smartcomm.repo");
const staffRepo = require("../../shared/hr_payroll/staff.repo");
const { audit } = require("../../middleware/audit");
const { config } = require("../../config/env");
const {
  NotFoundError,
  AppError,
  ValidationError,
} = require("../../utils/errors");
const { logger } = require("../../config/logger");

// Fields the reveal endpoint understands. Whitelisted so a client
// can't ask for an arbitrary column.
const REVEALABLE_FIELDS = new Set([
  "access_token",
  "app_secret",
  "verify_token",
  "business_account_id",
  "smtp_password",
]);

const ENC_COLUMN = {
  access_token: "access_token_enc",
  app_secret: "app_secret_enc",
  verify_token: "verify_token_enc",
  business_account_id: "business_account_id_enc",
  smtp_password: "smtp_password_enc",
};

function first4(s) {
  const str = String(s || "");
  return str.length >= 4 ? str.slice(0, 4) : str;
}

/**
 * Turn a raw upsert input (plaintext secrets) into an encrypted
 * bundle safe to hand to the repo. Any field the caller didn't
 * supply is left null so the repo COALESCE keeps the existing value.
 */
function encryptIncomingSecrets(input) {
  const s = {};
  if (input.access_token) {
    s.access_token_enc = crypto.encrypt(input.access_token);
    s.access_token_first4 = first4(input.access_token);
  }
  if (input.app_secret) {
    s.app_secret_enc = crypto.encrypt(input.app_secret);
    s.app_secret_first4 = first4(input.app_secret);
  }
  if (input.verify_token) {
    s.verify_token_enc = crypto.encrypt(input.verify_token);
    s.verify_token_first4 = first4(input.verify_token);
  }
  if (input.business_account_id) {
    s.business_account_id_enc = crypto.encrypt(input.business_account_id);
    s.business_account_first4 = first4(input.business_account_id);
  }
  if (input.smtp_password) {
    s.smtp_password_enc = crypto.encrypt(input.smtp_password);
    s.smtp_password_first4 = first4(input.smtp_password);
  }
  return s;
}

function listAccounts({ brand }) {
  return repo.list({ brand });
}

async function getAccount({ id }) {
  const row = await repo.get({ id });
  if (!row) throw new NotFoundError("Messaging account");
  return row;
}

async function upsertAccount({ brand, user, request_id, input }) {
  const secrets = encryptIncomingSecrets(input);
  const saved = await repo.upsert({
    brand,
    user_id: user.user_id,
    input,
    secrets,
  });
  // Invalidate smartcomm's in-memory lookup so the next webhook
  // doesn't see stale routing data.
  if (smartcommRepo.invalidateMessagingAccountCache) {
    smartcommRepo.invalidateMessagingAccountCache();
  }
  // Same idea for outbound: a saved SMTP relay change must take effect
  // on the very next send, not after a restart.
  if (saved.platform === "email_outbound") {
    try {
      require("../../services/email.service").invalidateTransporter(brand);
    } catch (err) {
      logger.warn(
        { err: err.message, brand },
        "email transporter cache invalidation failed",
      );
    }
  }
  // A freshly saved Instagram connection must carry the echo subscription
  // immediately — not after the next hourly watchdog tick. Fire-and-forget:
  // a slow Meta must never block the save.
  if (saved.platform === "instagram" && saved.is_active !== false) {
    ensureInstagramEchoSubscriptions().catch((err) =>
      logger.warn(
        { err: err.message, brand },
        "post-save instagram echo-subscription check failed",
      ),
    );
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
      secrets_rotated: Object.keys(secrets).length > 0,
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
  const existing = await repo.getRaw({ id });
  const row = await repo.remove({ id });
  if (!row) throw new NotFoundError("Messaging account");
  if (existing && existing.platform === "email_outbound") {
    try {
      require("../../services/email.service").invalidateTransporter(brand);
    } catch (err) {
      logger.warn(
        { err: err.message, brand },
        "email transporter cache invalidation failed",
      );
    }
  }
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
 * Password-verified reveal of a single secret field.
 *
 * @param {object} args
 * @param {string} args.brand
 * @param {object} args.user     — full req.user with .user_id
 * @param {string} args.request_id
 * @param {string} args.id       — messaging_account id
 * @param {string} args.field    — access_token | app_secret | verify_token | business_account_id
 * @param {string} args.password — caller's login password (argon2-verified)
 * @param {string} [args.source_ip]
 */
async function revealSecret({
  brand,
  user,
  request_id,
  id,
  field,
  password,
  source_ip,
}) {
  if (!REVEALABLE_FIELDS.has(field)) {
    throw new ValidationError(`Unknown secret field '${field}'`);
  }
  if (!password) {
    throw new ValidationError("Password required to reveal a secret");
  }

  // Look up the caller's own password hash. staffRepo.findById returns
  // the row including .password_hash.
  const caller = await staffRepo.findById(user.user_id);
  if (!caller || !caller.password_hash) {
    throw new AppError("AUTH_REQUIRED", "Re-authentication required", 401);
  }
  let ok = false;
  try {
    ok = await argon2.verify(caller.password_hash, password);
  } catch (err) {
    logger.warn(
      { err: err.message, user_id: user.user_id },
      "argon2 verify threw",
    );
    ok = false;
  }
  if (!ok) {
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "messaging_accounts.reveal_denied",
      target_type: "messaging_account",
      target_id: id,
      after: { field, reason: "invalid_password" },
      request_id,
    });
    throw new AppError("INVALID_PASSWORD", "Incorrect password", 401);
  }

  const row = await repo.getRaw({ id });
  if (!row) throw new NotFoundError("Messaging account");
  const enc = row[ENC_COLUMN[field]];
  if (!enc) {
    throw new AppError(
      "SECRET_NOT_SET",
      `No ${field.replace(/_/g, " ")} on file for this account`,
      404,
    );
  }
  let plaintext;
  try {
    plaintext = crypto.decrypt(enc);
  } catch (err) {
    logger.error({ err: err.message, account_id: id, field }, "decrypt failed");
    throw new AppError(
      "DECRYPT_FAILED",
      "Could not decrypt the stored secret. The encryption key may have been rotated.",
      500,
    );
  }

  await repo.recordReveal({
    account_id: id,
    user_id: user.user_id,
    field,
    source_ip,
    request_id,
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "messaging_accounts.reveal",
    target_type: "messaging_account",
    target_id: id,
    after: { field },
    request_id,
  });

  return { field, value: plaintext };
}

async function listReveals({ id }) {
  return repo.listReveals({ account_id: id });
}

/**
 * Test a configured account by pinging the provider. Doesn't send a
 * real message — just verifies the token can authenticate.
 *
 *   whatsapp  → GET /{phone_number_id}   (graph.facebook.com)
 *   instagram → GET /me                  (graph.instagram.com — IG Login)
 *   facebook  → GET /{page_id}           (graph.facebook.com)
 *   email     → DNS check on the inbound domain's MX record
 */
async function testAccount({ id }) {
  const row = await repo.getRaw({ id });
  if (!row) throw new NotFoundError("Messaging account");
  const token = row.access_token_enc
    ? crypto.decrypt(row.access_token_enc)
    : null;
  const v = config.META_GRAPH_VERSION || "v21.0";

  try {
    if (
      row.platform === "whatsapp" ||
      row.platform === "instagram" ||
      row.platform === "facebook"
    ) {
      if (!token) {
        throw new AppError(
          "NO_TOKEN",
          "No access token saved for this account",
          422,
        );
      }
      // Instagram uses the "Instagram API with Instagram Login" family:
      // the saved token is an IG user token (IGAA…) that ONLY authenticates
      // against graph.instagram.com — sending it to graph.facebook.com 401s
      // with "Invalid OAuth access token". Ping the self node `me`, which
      // returns { user_id, username } without needing the exact account id.
      if (row.platform === "instagram") {
        const { data } = await axios.get(
          `https://graph.instagram.com/${v}/me?fields=user_id,username`,
          {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 15000,
          },
        );
        const providerId = (data && (data.user_id || data.id)) || null;
        // Auto-heal a mistyped provider id: inbound webhooks route by
        // matching entry.id against external_account_id, and Meta sends
        // the Graph user id (what /me just returned) — NOT the Business-
        // Manager asset id operators tend to paste. When they differ,
        // fix the row so inbound DMs are never dropped. Skipped if the
        // true id already belongs to another row (unique constraint).
        let healed = false;
        if (providerId && String(providerId) !== row.external_account_id) {
          const updated = await repo.updateExternalId({
            id: row.account_id,
            external_account_id: String(providerId),
          });
          healed = !!updated;
          logger.warn(
            {
              account_id: row.account_id,
              previous: row.external_account_id,
              corrected: String(providerId),
              healed,
            },
            healed
              ? "messaging_accounts.test corrected IG provider id"
              : "messaging_accounts.test: IG provider id mismatch NOT healed (id taken)",
          );
        }
        // Surface — and repair — the webhook-field subscription right in
        // the Test result: a dropped messages/reactions/seen subscription
        // becomes visible here instead of silently broken.
        let echo_sync = null;
        try {
          const res = await ensureEchoSubscriptionForToken({
            access_token: token,
          });
          echo_sync = {
            ok: res.ok,
            healed: res.healed,
            fields: res.fields,
            missing_before: res.missing_before,
            missing_after: res.missing_after,
          };
        } catch (subErr) {
          echo_sync = { ok: false, error: metaErrMessage(subErr) };
        }
        return {
          ok: true,
          platform: "instagram",
          provider_id: providerId,
          provider_name: (data && data.username) || null,
          healed,
          echo_sync,
        };
      }
      // WhatsApp + Facebook stay on graph.facebook.com. Field sets differ per
      // node type: the WhatsApp phone-number node has no `name` field (asking
      // for it 400s with error #100 — "nonexistent field"), it exposes
      // `verified_name` instead.
      const FIELDS = {
        whatsapp: "id,verified_name,display_phone_number",
        facebook: "id,name",
      };
      const url = `https://graph.facebook.com/${v}/${encodeURIComponent(row.external_account_id)}?fields=${FIELDS[row.platform]}`;
      const { data } = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000,
      });
      return {
        ok: true,
        platform: row.platform,
        provider_id: data && data.id,
        provider_name: (data && (data.verified_name || data.name)) || null,
      };
    }
    if (row.platform === "email") {
      const dns = require("dns").promises;
      const domain =
        String(row.external_account_id).split("@")[1] ||
        row.external_account_id;
      const records = await dns.resolveMx(domain);
      return {
        ok: true,
        platform: "email",
        mx_records: records.map((r) => ({
          exchange: r.exchange,
          priority: r.priority,
        })),
      };
    }
    if (row.platform === "email_outbound") {
      if (!row.smtp_host) {
        throw new AppError(
          "SMTP_NOT_CONFIGURED",
          "No SMTP host saved for this account",
          422,
        );
      }
      const nodemailer = require("nodemailer");
      const pass = row.smtp_password_enc
        ? crypto.decrypt(row.smtp_password_enc)
        : null;
      const port = row.smtp_port || 587;
      const secure = row.smtp_secure === true || port === 465;
      const transporter = nodemailer.createTransport({
        host: row.smtp_host,
        port,
        secure,
        auth: row.smtp_user ? { user: row.smtp_user, pass } : undefined,
      });
      await transporter.verify();
      // When inbound polling is on, also prove the IMAP login works —
      // reusing the same mailbox credentials — so a failed test names
      // whichever leg (send vs receive) is misconfigured.
      let imap = null;
      if (row.inbound_poll_enabled) {
        const cfg = buildImapConfig(row);
        if (!cfg) {
          imap = {
            ok: false,
            error:
              "Set an IMAP host (couldn't derive one from the SMTP host).",
          };
        } else {
          try {
            const { ImapFlow } = require("imapflow");
            const client = new ImapFlow({
              host: cfg.host,
              port: cfg.port,
              secure: cfg.secure,
              auth: { user: cfg.user, pass: cfg.pass },
              logger: false,
            });
            // Same requirement as the poller: imapflow can emit 'error' from
            // a raw socket callback outside this try/catch's awaited chain.
            // With no listener that throws synchronously and crashes the
            // process, so a slow/misconfigured server would take the whole
            // app down from an admin clicking "Test".
            client.on("error", (err) => {
              logger.warn(
                { host: cfg.host, err: err.message },
                "messaging_accounts.test: imap connection error",
              );
            });
            await client.connect();
            await client.logout();
            imap = { ok: true, host: `${cfg.host}:${cfg.port}` };
          } catch (e) {
            imap = { ok: false, error: e.message };
          }
        }
      }
      return {
        ok: true,
        platform: "email_outbound",
        provider_name: `${row.smtp_host}:${port}`,
        imap,
      };
    }
  } catch (err) {
    const status = err.response && err.response.status;
    // Meta returns a structured error body on the Graph node ping. Axios
    // collapses it to the opaque "Request failed with status code 400",
    // which tells the operator nothing. Surface Meta's own message +
    // code/subcode/fbtrace_id so a failed Test names the real cause —
    // e.g. "Invalid OAuth access token", "(#100) nonexistent field", or
    // "Unsupported get request … missing permissions" (wrong ID / scope).
    const metaErr =
      err.response && err.response.data && err.response.data.error;
    logger.warn(
      {
        platform: row.platform,
        status,
        err: err.message,
        meta_error: metaErr || null,
      },
      "messaging_accounts.test failed",
    );
    if (metaErr && metaErr.message) {
      const parts = [metaErr.message];
      if (metaErr.code) parts.push(`code ${metaErr.code}`);
      if (metaErr.error_subcode) parts.push(`subcode ${metaErr.error_subcode}`);
      if (metaErr.fbtrace_id) parts.push(`trace ${metaErr.fbtrace_id}`);
      throw new AppError(
        "PROVIDER_PING_FAILED",
        parts.join(" — "),
        status && status >= 400 && status < 500 ? status : 502,
      );
    }
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

// ── Instagram token auto-refresh (60-day IGAA expiry) ──────────
//
// "Instagram API with Instagram Login" long-lived tokens expire after
// ~60 days. Meta's refresh endpoint mints a fresh 60-day token from a
// valid one (must be ≥ 24h old), so a periodic sweep keeps every brand's
// IG connection alive with no operator involvement. Called daily by the
// ig-token-refresh scheduler in the worker.

const IG_REFRESH_MIN_AGE_DAYS = 7;

/**
 * Refresh the access token of every active Instagram account whose last
 * rotation is older than IG_REFRESH_MIN_AGE_DAYS. One account failing
 * (revoked token, network) never blocks the others. Returns a summary
 * for the scheduler log.
 */
async function refreshInstagramTokens() {
  const rows = await repo.listActiveByPlatform({ platform: "instagram" });
  const summary = { checked: rows.length, refreshed: 0, skipped: 0, failed: 0 };
  const cutoff = Date.now() - IG_REFRESH_MIN_AGE_DAYS * 24 * 60 * 60 * 1000;
  for (const row of rows) {
    if (!row.access_token_enc) {
      summary.skipped += 1;
      continue;
    }
    const rotatedAt = row.secrets_last_rotated_at
      ? new Date(row.secrets_last_rotated_at).getTime()
      : 0;
    if (rotatedAt > cutoff) {
      summary.skipped += 1; // fresh enough — nothing to do
      continue;
    }
    try {
      const token = crypto.decrypt(row.access_token_enc);
      const { data } = await axios.get(
        "https://graph.instagram.com/refresh_access_token",
        {
          params: { grant_type: "ig_refresh_token", access_token: token },
          timeout: 15000,
        },
      );
      if (!data || !data.access_token) {
        throw new Error("refresh_access_token returned no access_token");
      }
      const expires_at = data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000).toISOString()
        : null;
      await repo.rotateAccessToken({
        id: row.account_id,
        access_token_enc: crypto.encrypt(data.access_token),
        access_token_first4: first4(data.access_token),
        expires_at,
      });
      await audit({
        business: row.business,
        user_id: null,
        action_key: "messaging_accounts.token_auto_refresh",
        target_type: "messaging_account",
        target_id: row.account_id,
        after: { platform: "instagram", expires_at },
        request_id: null,
      });
      summary.refreshed += 1;
      logger.info(
        { account_id: row.account_id, business: row.business, expires_at },
        "instagram token auto-refreshed",
      );
    } catch (err) {
      summary.failed += 1;
      const metaErr =
        err.response && err.response.data && err.response.data.error;
      logger.error(
        {
          account_id: row.account_id,
          business: row.business,
          err: err.message,
          meta_error: metaErr || null,
        },
        "instagram token auto-refresh FAILED — token may expire; re-paste a fresh token in Messaging → Settings if this persists",
      );
    }
  }
  return summary;
}

// ── Instagram webhook-field self-healing ───────────────────────
//
// Per Meta's Messenger-Platform webhook reference, `message_echoes` is a
// MESSENGER-ONLY field: "For Instagram Messaging conversations, the
// message echo notifications are included with the `messages` webhook
// field subscription." On Instagram, an app-sent reply arrives as a
// normal `messages` event flagged `is_echo: true` — so `messages` is the
// one field the entire inbox (customer DMs AND app-reply echoes) hangs
// on. Never POST `message_echoes` here: it doesn't exist on Instagram,
// and an invalid field can make Meta reject the whole subscription
// update (subscribed_apps REPLACES the list, so a rejected update also
// means the valid fields you meant to add never land).
//
// The subscription lives on the professional account itself (POST
// /me/subscribed_apps) — outside our database, outside our deploys — and
// it drifts: an account reconnect or partial re-subscribe replaces the
// list. This watchdog re-reads the account's subscribed_fields and, when
// anything required is missing, re-subscribes with the union (never
// dropping fields someone added), verifies, audits, and tells the CEO it
// drifted. Runs hourly (ig-echo-watchdog), after the daily token sweep,
// on account save, and inside the Test button.

const REQUIRED_IG_WEBHOOK_FIELDS = Object.freeze([
  "messages", // customer DMs + app-reply echoes (is_echo rides this field)
  "message_reactions", // ❤️ badges on bubbles
  "messaging_seen", // customer read ticks
]);

// Meta's structured error message ("Invalid OAuth access token", …) beats
// axios's opaque "Request failed with status code 400" in every log line.
function metaErrMessage(err) {
  const metaErr = err.response && err.response.data && err.response.data.error;
  if (metaErr && metaErr.message) {
    const parts = [metaErr.message];
    if (metaErr.code) parts.push(`code ${metaErr.code}`);
    if (metaErr.error_subcode) parts.push(`subcode ${metaErr.error_subcode}`);
    return parts.join(" — ");
  }
  return err.message;
}

async function getInstagramSubscribedFields({ access_token }) {
  const v = config.META_GRAPH_VERSION || "v21.0";
  const { data } = await axios.get(
    `https://graph.instagram.com/${v}/me/subscribed_apps`,
    { headers: { Authorization: `Bearer ${access_token}` }, timeout: 15000 },
  );
  const apps = (data && data.data) || [];
  const fields = new Set();
  for (const app of apps) {
    for (const f of app.subscribed_fields || []) fields.add(String(f));
  }
  return { fields, app_count: apps.length };
}

async function subscribeInstagramFields({ access_token, fields }) {
  const v = config.META_GRAPH_VERSION || "v21.0";
  await axios.post(`https://graph.instagram.com/${v}/me/subscribed_apps`, null, {
    params: { subscribed_fields: fields.join(",") },
    headers: { Authorization: `Bearer ${access_token}` },
    timeout: 15000,
  });
}

/**
 * Check one token's webhook-field subscription and repair it if any
 * required field is missing. POSTing subscribed_apps REPLACES the list,
 * so the repair always sends the union of current + required.
 * Returns { ok, healed, fields, missing_before, missing_after }.
 */
async function ensureEchoSubscriptionForToken({ access_token }) {
  const before = await getInstagramSubscribedFields({ access_token });
  const missing = REQUIRED_IG_WEBHOOK_FIELDS.filter(
    (f) => !before.fields.has(f),
  );
  if (!missing.length) {
    return {
      ok: true,
      healed: false,
      fields: [...before.fields],
      missing_before: [],
      missing_after: [],
    };
  }
  const union = [
    ...new Set([...before.fields, ...REQUIRED_IG_WEBHOOK_FIELDS]),
  ];
  await subscribeInstagramFields({ access_token, fields: union });
  // Trust nothing — re-read and confirm the field actually stuck.
  const after = await getInstagramSubscribedFields({ access_token });
  const still = REQUIRED_IG_WEBHOOK_FIELDS.filter((f) => !after.fields.has(f));
  return {
    ok: still.length === 0,
    healed: still.length === 0,
    fields: [...after.fields],
    missing_before: missing,
    missing_after: still,
  };
}

// One CEO notification per (type, business) per day — the hourly watchdog
// must never turn a persistent Meta outage into an hourly notification storm.
async function notifyCeoOnce({ business, type, title, body, priority }) {
  const { query } = require("../../config/database");
  const { rows } = await query(
    `SELECT user_id FROM shared.users WHERE is_ceo = true ORDER BY created_at LIMIT 1`,
  );
  const ceo = rows[0];
  if (!ceo) return;
  const { rows: recent } = await query(
    `SELECT 1 FROM shared.notifications
      WHERE user_id = $1 AND type = $2 AND business = $3
        AND created_at > now() - interval '24 hours'
      LIMIT 1`,
    [ceo.user_id, type, business],
  );
  if (recent.length) return;
  const notifications = require("../../services/notifications.service");
  await notifications.notify({
    user_id: ceo.user_id,
    business,
    type,
    title,
    body,
    priority,
    action_url: "/messaging",
  });
}

/**
 * Verify + repair the webhook-field subscription of EVERY active
 * Instagram account. Never throws for a single account — one brand's
 * broken token must not stop the other brand's check. Returns a summary
 * for the scheduler log.
 */
async function ensureInstagramEchoSubscriptions() {
  const rows = await repo.listActiveByPlatform({ platform: "instagram" });
  const summary = { checked: 0, ok: 0, healed: 0, failed: 0 };
  for (const row of rows) {
    if (!row.access_token_enc) continue; // token sweep already screams about this
    summary.checked += 1;
    try {
      const token = crypto.decrypt(row.access_token_enc);
      const res = await ensureEchoSubscriptionForToken({ access_token: token });
      if (res.healed) {
        summary.healed += 1;
        logger.warn(
          {
            account_id: row.account_id,
            business: row.business,
            missing_before: res.missing_before,
            fields: res.fields,
          },
          "instagram webhook subscription had drifted — re-subscribed",
        );
        await audit({
          business: row.business,
          user_id: null,
          action_key: "messaging_accounts.echo_subscription_healed",
          target_type: "messaging_account",
          target_id: row.account_id,
          after: { missing_before: res.missing_before, fields: res.fields },
          request_id: null,
        });
        // `messages` carries the whole inbox — customer DMs AND app-reply
        // echoes (is_echo). reactions/seen only affect badges and ticks;
        // don't tell the CEO the inbox was down when it wasn't.
        const inboxWasDown = res.missing_before.includes("messages");
        await notifyCeoOnce({
          business: row.business,
          type: "ig_echo_sync_healed",
          priority: "high",
          title: inboxWasDown
            ? "Instagram message sync was off — fixed automatically"
            : "Instagram webhook subscriptions restored",
          body: inboxWasDown
            ? `${row.business}: Meta had dropped the 'messages' webhook subscription, so customer ` +
              "DMs and app-sent replies were not syncing into Messaging. It has been re-subscribed " +
              "automatically. Anything sent while it was off can be recovered with the Instagram " +
              "history backfill."
            : `${row.business}: Meta had dropped the '${res.missing_before.join("', '")}' webhook ` +
              "subscription(s), so read receipts and customer reactions were not updating in " +
              "Messaging. Re-subscribed automatically. (Messages and app-sent replies were " +
              "unaffected — they ride the 'messages' field, which was intact.)",
        });
      } else if (res.ok) {
        summary.ok += 1;
      } else {
        // POST accepted but the field didn't stick — Meta-side problem
        // (permission not granted / app not Live). Louder than a heal.
        summary.failed += 1;
        logger.error(
          {
            account_id: row.account_id,
            business: row.business,
            missing_after: res.missing_after,
          },
          "instagram webhook re-subscribe did NOT stick — check the Meta app's Instagram webhook product + instagram_business_manage_messages permission",
        );
        await notifyCeoOnce({
          business: row.business,
          type: "ig_echo_sync_broken",
          priority: "urgent",
          title: "Instagram webhook sync is broken (needs Meta attention)",
          body:
            `${row.business}: the '${res.missing_after.join("', '")}' webhook subscription could not be restored — ` +
            "Meta accepted the request but the field did not stick. Parts of Instagram " +
            "messaging sync will stay broken until this is fixed in the Meta App Dashboard " +
            "(Webhooks → Instagram; check instagram_business_manage_messages access).",
        });
      }
    } catch (err) {
      summary.failed += 1;
      const msg = metaErrMessage(err);
      logger.error(
        { account_id: row.account_id, business: row.business, err: msg },
        "instagram echo-subscription check failed",
      );
      await notifyCeoOnce({
        business: row.business,
        type: "ig_echo_sync_broken",
        priority: "urgent",
        title: "Instagram webhook subscription check failed",
        body:
          `${row.business}: could not verify/restore the Instagram webhook subscriptions ` +
          `(${msg}). DM sync, app-reply echoes, read receipts or reactions may be affected. ` +
          "Open Messaging → Settings and Test the Instagram connection.",
      }).catch(() => {});
    }
  }
  return summary;
}

// ── WhatsApp business profile (display picture, about, …) ──────
//
// The profile is the "business card" a customer sees in the chat
// header. It's owned by the phone number, so we resolve the account
// row → brand and hand off to whatsapp.service, which talks to Meta.
// The display picture is uploaded via Meta's resumable upload, which
// needs the numeric Meta App ID — public config we keep in the row's
// metadata.app_id (no secret, no migration).

function assertWhatsApp(row) {
  if (!row) throw new NotFoundError("Messaging account");
  if (row.platform !== "whatsapp") {
    throw new AppError(
      "NOT_WHATSAPP",
      "Business profile is only available for WhatsApp accounts",
      400,
    );
  }
  return row;
}

/**
 * Normalise any staff-supplied image into a WhatsApp-ready display
 * picture: a square JPEG. Meta only accepts JPEG for the profile photo
 * and renders it in a circle, so we cover-crop to 640×640 (well within
 * Meta's 5MB / min-192px limits) and re-encode. HEIC (iPhone default)
 * is decoded first so a phone photo just works.
 */
async function toProfilePictureJpeg(file) {
  const sharp = require("sharp");
  const {
    normalizeImageInput,
  } = require("../../services/media-compression.service");
  const normalized = await normalizeImageInput(file); // HEIC → JPEG bytes
  return sharp(normalized.buffer, { failOn: "none" })
    .rotate() // honour EXIF orientation
    .resize(640, 640, { fit: "cover", position: sharp.strategy.attention })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

/**
 * Read a WhatsApp account's business profile from Meta. Also returns
 * the stored app_id so the UI can tell whether a picture upload will
 * work without a round-trip.
 */
async function getWhatsAppProfile({ id }) {
  const row = assertWhatsApp(await repo.getRaw({ id }));
  const wa = require("../../services/whatsapp.service");
  const profile = await wa.getBusinessProfile({ brand: row.business });
  const app_id = (row.metadata && row.metadata.app_id) || null;
  return { ...profile, app_id };
}

/**
 * Update the text fields of a WhatsApp business profile. `profile`
 * carries only the keys the operator changed (about, address,
 * description, email, vertical, websites).
 */
async function updateWhatsAppProfile({ brand, user, request_id, id, profile }) {
  const row = assertWhatsApp(await repo.getRaw({ id }));
  const wa = require("../../services/whatsapp.service");
  const result = await wa.updateBusinessProfile({
    brand: row.business,
    profile,
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "messaging_accounts.whatsapp_profile_update",
    target_type: "messaging_account",
    target_id: id,
    after: { fields: Object.keys(profile || {}) },
    request_id,
  });
  return result;
}

/**
 * Set the WhatsApp display picture from an uploaded image. Persists the
 * App ID (if newly supplied) so it's remembered for next time, converts
 * the image to a square JPEG, then uploads + writes the handle.
 */
async function setWhatsAppProfilePicture({
  brand,
  user,
  request_id,
  id,
  file,
  app_id,
}) {
  const row = assertWhatsApp(await repo.getRaw({ id }));
  if (!file || !file.buffer) {
    throw new ValidationError("An image file is required");
  }
  const storedAppId = (row.metadata && row.metadata.app_id) || null;
  const cleaned = app_id ? String(app_id).trim() : "";
  if (cleaned && !/^\d{1,32}$/.test(cleaned)) {
    throw new ValidationError("Meta App ID must be numeric");
  }
  // App ID is optional — whatsapp.service auto-derives it from the access
  // token. A manually-entered id (or a previously-remembered one) is only
  // a hint, used if the automatic lookup ever fails.
  const hintAppId = cleaned || storedAppId || null;

  const buffer = await toProfilePictureJpeg(file);
  const wa = require("../../services/whatsapp.service");
  const { app_id: usedAppId } = await wa.setProfilePicture({
    brand: row.business,
    app_id: hintAppId,
    buffer,
    mime_type: "image/jpeg",
    filename: "profile.jpg",
  });

  // Remember whichever App ID actually worked so we never ask again.
  if (usedAppId && usedAppId !== storedAppId) {
    await repo.setAppId({ id, app_id: usedAppId });
  }

  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "messaging_accounts.whatsapp_profile_picture",
    target_type: "messaging_account",
    target_id: id,
    after: { bytes: buffer.length, app_id: usedAppId },
    request_id,
  });

  // Return the refreshed profile so the UI can show the new picture.
  // profile_picture_url reflecting the new image confirms Meta applied
  // it; if it's still empty the client shows a "may take a moment" note.
  const profile = await wa.getBusinessProfile({ brand: row.business });
  return {
    ...profile,
    app_id: usedAppId,
    picture_applied: !!profile.profile_picture_url,
  };
}

// ── Internal resolver helpers (used by whatsapp.service etc.) ──

/**
 * Resolve a brand's active WhatsApp config for outbound sends.
 * Returns { phone_number_id, access_token } or throws WA_NOT_CONFIGURED.
 * NOT exported over HTTP — internal only.
 */
async function resolveWhatsAppSendConfig({ brand }) {
  const row = await repo.findActiveByBrand({ brand, platform: "whatsapp" });
  if (!row) {
    throw new AppError(
      "WA_NOT_CONFIGURED",
      `WhatsApp isn't configured for ${brand}. Open Messaging → Settings and connect a phone number.`,
      412,
    );
  }
  if (!row.access_token_enc) {
    throw new AppError(
      "WA_NO_TOKEN",
      `WhatsApp for ${brand} has no access token on file. Rotate the token in Messaging → Settings.`,
      412,
    );
  }
  return {
    account_id: row.account_id,
    phone_number_id: row.external_account_id,
    access_token: crypto.decrypt(row.access_token_enc),
    business_account_id: row.business_account_id_enc
      ? crypto.decrypt(row.business_account_id_enc)
      : null,
  };
}

/**
 * Resolve a brand's active Instagram config for outbound sends.
 * Returns { access_token, ig_business_account_id } or throws
 * IG_NOT_CONFIGURED. Internal only — never over HTTP.
 */
async function resolveInstagramSendConfig({ brand }) {
  const row = await repo.findActiveByBrand({ brand, platform: "instagram" });
  if (!row) {
    throw new AppError(
      "IG_NOT_CONFIGURED",
      `Instagram isn't configured for ${brand}. Open Messaging → Settings and connect the IG Business Account.`,
      412,
    );
  }
  if (!row.access_token_enc) {
    throw new AppError(
      "IG_NO_TOKEN",
      `Instagram for ${brand} has no access token on file. Rotate the token in Messaging → Settings.`,
      412,
    );
  }
  return {
    account_id: row.account_id,
    ig_business_account_id: row.external_account_id,
    access_token: crypto.decrypt(row.access_token_enc),
  };
}

/**
 * Build the exact DNS records + webhook wiring an operator needs to
 * finish inbound email setup, computed for a specific mailbox/domain
 * instead of making an engineer copy them by hand out of
 * docs/EMAIL_TWO_WAY_SETUP.md. Mirrors that runbook's Step 2 + Step 5
 * so both stay in sync — if you change one, check the other.
 *
 * @param {object} args
 * @param {string} args.external_account_id — the inbound mailbox, e.g. sales@brand.com
 */
function getInboundDnsRecords({ external_account_id }) {
  const domain = String(external_account_id || "").split("@")[1] || "";
  // Inbound is handled by IMAP polling on the brand's Outbound Email
  // connection (reusing the SMTP mailbox) — no DNS records, no webhook, no
  // Cloudflare. This payload just guides the operator to that toggle and
  // pre-fills the IMAP details for a Hostinger-hosted mailbox.
  const imapHost = domain ? `imap.${domain}` : "";
  return {
    mode: "imap",
    domain,
    imap: {
      // Both brands are on Hostinger, whose IMAP host is imap.hostinger.com.
      // The poller also auto-derives smtp.<host> → imap.<host> when left
      // blank, so this is a hint, not a hard requirement.
      host: "imap.hostinger.com",
      host_derived: imapHost,
      port: 993,
      security: "SSL/TLS",
      username: external_account_id || "the full mailbox address",
    },
    instructions: [
      "Open this brand's Outbound Email connection under Connections above.",
      'Tick "Poll this mailbox for customer replies (IMAP)".',
      "Leave IMAP host blank to auto-derive it from the SMTP host, or enter imap.hostinger.com. Port 993, TLS on.",
      "It reuses the SMTP username + password already saved — no new credentials to enter.",
      "Hit Test (it checks SMTP send and IMAP login), then Save.",
      "Reply to a test email and confirm it appears in the inbox within ~2 minutes.",
    ],
  };
}

/**
 * Resolve a brand's outbound SMTP relay for sending, preferring the
 * per-brand row configured in Messaging Settings over the legacy
 * SMTP_* / SMTP_<BRAND>_* environment variables. Returns null if
 * nothing is configured anywhere so callers can fall back cleanly.
 */
// Derive the IMAP host from the SMTP host when the operator didn't set
// one explicitly. Hostinger (and most providers) mirror smtp.<domain> ↔
// imap.<domain>, so this covers the common case; anything non-standard
// requires an explicit imap_host and returns null here.
function deriveImapHost(smtpHost) {
  if (!smtpHost) return null;
  return /^smtp\./i.test(smtpHost)
    ? smtpHost.replace(/^smtp\./i, "imap.")
    : null;
}

// Build a ready-to-use IMAP config from a raw email_outbound row,
// reusing the SMTP username + decrypted password (same Hostinger
// mailbox). Returns null when the row can't produce a usable config.
function buildImapConfig(row) {
  if (!row || !row.smtp_user || !row.smtp_password_enc) return null;
  const host = row.imap_host || deriveImapHost(row.smtp_host);
  if (!host) return null;
  return {
    account_id: row.account_id,
    business: row.business,
    host,
    port: row.imap_port || 993,
    secure: row.imap_secure !== false, // default TLS
    user: row.smtp_user,
    pass: crypto.decrypt(row.smtp_password_enc),
    // The address customer replies arrive `to` — used as the inbound
    // event's external_account_id so threads route to the right brand.
    mailbox: row.external_account_id || row.smtp_user,
    last_uid: row.imap_last_uid ? Number(row.imap_last_uid) : 0,
    uidvalidity: row.imap_uidvalidity ? Number(row.imap_uidvalidity) : null,
  };
}

/** Single brand's inbound IMAP config, or null when polling is off. */
async function resolveInboundImapConfig({ brand }) {
  const row = await repo.findActiveByBrand({
    brand,
    platform: "email_outbound",
  });
  if (!row || !row.inbound_poll_enabled) return null;
  return buildImapConfig(row);
}

/** Every brand with inbound IMAP polling enabled — used by the poller. */
async function listInboundImapConfigs() {
  const rows = await repo.listActiveInboundImap();
  return rows.map(buildImapConfig).filter(Boolean);
}

async function resolveOutboundEmailConfig({ brand }) {
  const row = await repo.findActiveByBrand({
    brand,
    platform: "email_outbound",
  });
  if (!row || !row.smtp_host) return null;
  return {
    account_id: row.account_id,
    host: row.smtp_host,
    port: row.smtp_port || 587,
    secure: row.smtp_secure === true || row.smtp_port === 465,
    user: row.smtp_user || null,
    pass: row.smtp_password_enc ? crypto.decrypt(row.smtp_password_enc) : null,
    from_email: row.from_email || null,
    from_name: row.from_name || null,
    reply_to: row.reply_to_email || null,
  };
}

/**
 * Resolve inbound WhatsApp secrets from an incoming payload's
 * phone_number_id — used by the webhook signature verifier + the
 * GET verify handshake.
 * Returns { brand, app_secret, verify_token } or null if not found.
 */
async function resolveWhatsAppInboundSecrets({ external_account_id }) {
  const row = await repo.findByExternalId({
    platform: "whatsapp",
    external_account_id,
  });
  if (!row) return null;
  return {
    brand: row.business,
    app_secret: row.app_secret_enc ? crypto.decrypt(row.app_secret_enc) : null,
    verify_token: row.verify_token_enc
      ? crypto.decrypt(row.verify_token_enc)
      : row.webhook_verify_token || null,
  };
}

/**
 * Read the number's voice-calling settings from Meta (Cloud API Calling).
 * { status: 'ENABLED'|'DISABLED', call_icon_visibility?, … }.
 */
async function getWhatsAppCalling({ id }) {
  const row = assertWhatsApp(await repo.getRaw({ id }));
  const calling = require("../../services/whatsapp-calling.service");
  return calling.getCallingSettings({ brand: row.business });
}

/**
 * Toggle voice calling on the number. Enabling shows the call icon in the
 * customer's chat header; inbound calls then land in the Hub (calls module).
 */
async function updateWhatsAppCalling({
  brand,
  user,
  request_id,
  id,
  enabled,
  icon_visibility,
}) {
  const row = assertWhatsApp(await repo.getRaw({ id }));
  const calling = require("../../services/whatsapp-calling.service");
  const result = await calling.updateCallingSettings({
    brand: row.business,
    enabled,
    icon_visibility,
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "messaging_accounts.whatsapp_calling_update",
    target_type: "messaging_account",
    target_id: id,
    after: { enabled, icon_visibility: icon_visibility || null },
    request_id,
  });
  return result;
}

module.exports = {
  listAccounts,
  getAccount,
  upsertAccount,
  setActive,
  removeAccount,
  testAccount,
  revealSecret,
  listReveals,
  refreshInstagramTokens,
  // Instagram webhook-subscription watchdog (messages/reactions/seen self-heal):
  ensureInstagramEchoSubscriptions,
  ensureEchoSubscriptionForToken,
  getInstagramSubscribedFields,
  REQUIRED_IG_WEBHOOK_FIELDS,
  // WhatsApp business profile:
  getWhatsAppProfile,
  updateWhatsAppProfile,
  setWhatsAppProfilePicture,
  // WhatsApp voice calling (Cloud API Calling):
  getWhatsAppCalling,
  updateWhatsAppCalling,
  getInboundDnsRecords,
  // internal — for whatsapp.service + webhooks:
  resolveWhatsAppSendConfig,
  resolveWhatsAppInboundSecrets,
  // internal — for instagram.service:
  resolveInstagramSendConfig,
  // internal — for email.service.js outbound sends:
  resolveOutboundEmailConfig,
  // internal — for the inbound IMAP poller:
  resolveInboundImapConfig,
  listInboundImapConfigs,
  updateImapCursor: (args) => repo.updateImapCursor(args),
};
