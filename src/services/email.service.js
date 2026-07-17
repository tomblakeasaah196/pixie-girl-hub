/**
 * Email sender (V2.2 §6.16 — Nodemailer over transactional SMTP, no Klaviyo).
 * Used by: email campaigns, transactional notifications, retention workflows.
 *
 * Sends via the single configured SMTP relay (SMTP_*). The per-brand identity
 * comes from the FROM address (business_config.email_from_address), not from a
 * separate SMTP host.
 *
 * Reply-To rule (EMAIL_TWO_WAY_SETUP): every outbound message carries a
 * conversational `Reply-To: sales@<brand-domain>` — even transactional mail
 * whose From is `noreply@` — so a customer's reply lands on the monitored
 * mailbox that Cloudflare Email Routing forwards into our inbound webhook and
 * threads back into the conversation. A caller-supplied reply_to always wins.
 */

"use strict";

const nodemailer = require("nodemailer");
const { config } = require("../config/env");
const { query } = require("../config/database");
const { logger } = require("../config/logger");
const { AppError } = require("../utils/errors");

// One cached transporter per resolved config ("global" or a brand key).
// Cache is cleared whenever Messaging Settings saves a new/changed
// email_outbound row (see messaging-accounts.service.js upsertAccount),
// same pattern smartcomm uses to bust its own in-memory lookup.
const transporters = new Map();

/** Resolve a brand's SMTP block from the environment, or null for the default. */
function brandSmtpFromEnv(brand) {
  if (!brand) return null;
  const key = String(brand)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const host = process.env[`SMTP_${key}_HOST`];
  if (!host) return null;
  return {
    host,
    port: Number(process.env[`SMTP_${key}_PORT`] || 587),
    secure: process.env[`SMTP_${key}_SECURE`] === "true",
    user: process.env[`SMTP_${key}_USER`],
    pass: process.env[`SMTP_${key}_PASSWORD`],
  };
}

/**
 * Resolve a brand's SMTP relay, preferring the per-brand
 * "email_outbound" row configured in Messaging Settings (Connections →
 * Outbound Email) over the legacy SMTP_<BRAND>_* env vars. Required so
 * an operator can rotate/point a brand's outbound relay from the UI
 * without an engineer editing .env and restarting the app.
 *
 * Lazily required to dodge any require-cycle risk between the two
 * modules — messaging-accounts.service.js never imports this file.
 */
async function brandSmtp(brand) {
  if (!brand) return null;
  try {
    const messagingAccounts = require("../modules/messaging_accounts/messaging-accounts.service");
    const dbConfig = await messagingAccounts.resolveOutboundEmailConfig({ brand });
    if (dbConfig) {
      return {
        host: dbConfig.host,
        port: dbConfig.port,
        secure: dbConfig.secure,
        user: dbConfig.user,
        pass: dbConfig.pass,
        // Carry the operator-configured sender identity through — getSender
        // needs it so the From matches a mailbox this relay is allowed to
        // send as (strict relays 553-reject a mismatched sender).
        from_email: dbConfig.from_email,
        from_name: dbConfig.from_name,
        reply_to: dbConfig.reply_to,
      };
    }
  } catch (err) {
    logger.warn(
      { err: err.message, brand },
      "brandSmtp: DB-configured SMTP lookup failed, falling back to env",
    );
  }
  return brandSmtpFromEnv(brand);
}

/** Invalidate a brand's cached transporter — call after Messaging Settings
 *  saves a changed email_outbound row so the next send picks it up. */
function invalidateTransporter(brand) {
  transporters.delete(brand ? `brand:${brand}` : "global");
}

/**
 * Nodemailer options for the default (non-brand) relay.
 *
 * TLS matters: hardcoding plaintext (the old `ignoreTLS: true`) meant that even
 * after SMTP_HOST was pointed at a real relay, credentials went in the clear and
 * providers that mandate STARTTLS on 587 rejected the connection. So:
 *   • loopback dev relay (MailHog/Mailpit/sendmail on localhost) → plaintext, no TLS
 *   • port 465 or SMTP_SECURE=true                                → implicit TLS
 *   • anything else (e.g. a real relay on 587)                    → require STARTTLS
 */
function defaultTransportOptions() {
  const host = config.SMTP_HOST;
  const port = config.SMTP_PORT;
  const isLocal = /^(localhost|127\.0\.0\.1|::1)$/i.test(
    String(host || "").trim(),
  );
  const secure = config.SMTP_SECURE || port === 465;
  const opts = {
    host,
    port,
    secure,
    auth: config.SMTP_USER
      ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD }
      : undefined,
  };
  if (isLocal) {
    opts.ignoreTLS = true; // no cert on a loopback relay — don't try STARTTLS
  } else if (!secure) {
    opts.requireTLS = true; // real relay on 587 → never submit in cleartext
  }
  return opts;
}

async function getTransporter(brand) {
  const bs = await brandSmtp(brand);
  const cacheKey = bs ? `brand:${brand}` : "global";
  if (transporters.has(cacheKey)) return transporters.get(cacheKey);

  const t = bs
    ? nodemailer.createTransport({
        host: bs.host,
        port: bs.port,
        secure: bs.secure,
        auth: bs.user ? { user: bs.user, pass: bs.pass } : undefined,
      })
    : nodemailer.createTransport(defaultTransportOptions());
  transporters.set(cacheKey, t);
  return t;
}

async function getSender(brand) {
  // Resolve the brand's outbound relay first — it carries the authenticated
  // SMTP user plus any operator-set From/Reply-To (Messaging Settings →
  // Connections → Outbound Email). Null when the brand uses the default relay.
  const bs = await brandSmtp(brand);
  const smtpUser = bs && bs.user ? bs.user : null;

  let cfg = {};
  if (brand) {
    try {
      const { rows } = await query(
        `SELECT email_from_address, display_name,
                support_email, support_email_display_name
         FROM shared.business_config
         WHERE business_key = $1 AND is_active = true
         LIMIT 1`,
        [brand],
      );
      if (rows.length) cfg = rows[0];
    } catch (err) {
      logger.error({ err }, "email sender lookup failed");
    }
  }

  // The From address MUST be a mailbox the authenticated SMTP user is allowed
  // to send as, or strict relays reject the whole message with
  // 553 "Sender address rejected: not owned by user". So prefer, in order:
  //   1. the From explicitly configured on the outbound connection,
  //   2. the authenticated SMTP user itself (always accepted by its own relay),
  //   3. only then the business_config address (often a noreply@ the relay
  //      does NOT own — the exact cause of the bounced invoices/receipts).
  // Deliberately NO hardcoded final fallback: sender identity lives in the
  // DB (Messaging → Settings → Outbound Email, Business Setup) or the
  // SMTP_FROM_EMAIL env var. A baked-in domain would silently outlive a
  // brand domain change and bounce every send from a retired domain.
  const fromEmail =
    (bs && bs.from_email) ||
    smtpUser ||
    cfg.email_from_address ||
    config.SMTP_FROM_EMAIL ||
    null;
  const fromName =
    (bs && bs.from_name) ||
    cfg.display_name ||
    config.SMTP_FROM_NAME ||
    brand ||
    "Pixie Girl Hub";
  // Reply-To = the monitored mailbox; falls back to the From address
  // (never to noreply, which can't receive).
  const replyTo =
    (bs && bs.reply_to) ||
    cfg.support_email ||
    cfg.email_from_address ||
    null;
  const replyToName = cfg.support_email_display_name || cfg.display_name || null;

  return { fromEmail, fromName, replyTo, replyToName };
}

/** Conversational reply address: `sales@<domain-of-from-address>` so customer
 *  replies always reach a monitored, webhook-ingested mailbox. */
function replyToFor(fromEmail) {
  const domain = (fromEmail || "").split("@")[1];
  return domain ? `sales@${domain}` : null;
}

/**
 * Turn caller-supplied attachment specs into the shape Nodemailer's
 * `attachments` array expects. Two forms are accepted:
 *   • `{ filename, storage_key, content_type }` — a file already in local
 *     storage (a message attachment / generated PDF). Only the KEY rides
 *     the queue (never the bytes — that would bloat Redis); the bytes are
 *     loaded here, at send time, straight from storage.
 *   • a ready Nodemailer object (`{ filename, content }`, `{ path }`,
 *     `{ href }`) — passed through untouched.
 *
 * A missing stored file throws rather than sending a mail that silently
 * omits the PDF/photo the customer was promised — the operator then sees
 * the send fail and can re-attach, instead of the file vanishing quietly.
 */
async function resolveAttachments(list) {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  const storage = require("./storage.service");
  const out = [];
  for (const a of list) {
    if (!a) continue;
    if (a.storage_key) {
      let content;
      try {
        content = await storage.get(a.storage_key);
      } catch {
        throw new AppError(
          "EMAIL_ATTACHMENT_MISSING",
          `Attachment "${a.filename || a.storage_key}" could not be read from storage — the file may have been removed. Re-attach it and try again.`,
          422,
        );
      }
      out.push({
        filename: a.filename || "attachment",
        content,
        contentType: a.content_type || a.contentType || undefined,
      });
    } else if (a.content || a.path || a.href) {
      out.push(a);
    }
  }
  return out.length ? out : undefined;
}

async function send({
  to,
  cc,
  subject,
  html,
  text,
  from_email,
  from_name,
  reply_to,
  headers,
  attachments,
  brand,
}) {
  const t = await getTransporter(brand);
  const sender = await getSender(brand);
  const fromEmail = from_email || sender.fromEmail;
  if (!fromEmail) {
    throw new AppError(
      "EMAIL_FROM_UNCONFIGURED",
      `No outbound sender address is configured${brand ? ` for ${brand}` : ""}. ` +
        "Set the From address in Messaging → Settings → Outbound Email " +
        "(or the brand's email address in Business Setup).",
      412,
    );
  }
  const replyTo = reply_to || sender.replyTo || replyToFor(fromEmail);
  const resolvedAttachments = await resolveAttachments(attachments);

  return t.sendMail({
    to,
    // Nodemailer accepts a string, comma-list, or array for cc — pass an
    // array of addresses straight through; omit entirely when there's none.
    cc: cc && cc.length ? cc : undefined,
    from: `${from_name || sender.fromName} <${fromEmail}>`,
    replyTo: replyTo || undefined,
    subject,
    html,
    text,
    headers,
    attachments: resolvedAttachments,
  });
}

/**
 * Point out — at BOOT, non-fatally — an SMTP config that cannot plausibly
 * deliver to real customers, so a placeholder relay screams here instead of
 * silently swallowing every transactional email at send time (which is exactly
 * how "are clients even getting our mail?" goes unnoticed for months).
 *
 * Zero network: this only inspects the config shape. `smtp:doctor` does the
 * live connect + test send. Warnings only in staging/production — a dev box
 * on localhost:25 (MailHog etc.) is legitimate and shouldn't nag.
 */
function checkConfigAtBoot() {
  const prod = ["production", "staging"].includes(config.NODE_ENV);
  const host = config.SMTP_HOST;
  const port = config.SMTP_PORT;
  const hasAuth = Boolean(config.SMTP_USER && config.SMTP_PASSWORD);
  const problems = [];

  if (!host) {
    problems.push("SMTP_HOST is not set — every outbound email will fail.");
  } else if (/^(localhost|127\.0\.0\.1|::1)$/i.test(String(host).trim())) {
    problems.push(
      `SMTP_HOST is '${host}' — mail is handed to a LOCAL mail server that ` +
        "usually doesn't exist on an app host (→ ECONNREFUSED). Point SMTP_* " +
        "at a real relay (e.g. Zoho/Google/SendGrid/Mailgun/SES).",
    );
  }
  if (port === 25) {
    problems.push(
      "SMTP_PORT is 25 — most cloud/VPS hosts block outbound port 25 and " +
        "unauthenticated port-25 mail is widely rejected. Use 587 (STARTTLS) " +
        "or 465 (TLS) with credentials.",
    );
  }
  if (host && !/^(localhost|127\.0\.0\.1|::1)$/i.test(String(host).trim()) && !hasAuth) {
    problems.push(
      "SMTP_USER/SMTP_PASSWORD are blank — a public relay will reject " +
        "unauthenticated submission.",
    );
  }

  if (problems.length && prod) {
    logger.warn(
      { host, port, hasAuth, problems },
      "⚠ SMTP looks misconfigured — outbound email is unlikely to be delivered. " +
        "Run `npm run smtp:doctor` to confirm.",
    );
  } else if (problems.length) {
    logger.info(
      { host, port, hasAuth },
      "SMTP config is dev-shaped (localhost/port25/no-auth) — fine locally; " +
        "must be a real relay in staging/production.",
    );
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Live connectivity check — opens the SMTP connection and (when auth is set)
 * authenticates, WITHOUT sending. Used by `smtp:doctor`. Resolves
 * { ok, error } instead of throwing so callers can report cleanly.
 */
async function verifyConnection(brand) {
  try {
    const t = await getTransporter(brand);
    await t.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message, code: err.code };
  }
}

module.exports = { send, checkConfigAtBoot, verifyConnection, invalidateTransporter };
