/**
 * Email delivery receipts — turning an ESP's webhook into a row on the
 * outbound comms ledger.
 *
 * Why this exists: we send over SMTP, not a provider API. That keeps the relay
 * swappable, but it means a delivery webhook arrives with no idea which of our
 * sends it belongs to. Two correlation keys solve it, in order:
 *
 *   1. `message_ref` — an unguessable token we mint per send and inject as a
 *      provider-specific metadata header (see `refHeaders`). Every major ESP
 *      echoes its own metadata field back on every event for that message.
 *   2. the SMTP `Message-ID` — already stored as `provider_ref` on the send
 *      row. The fallback for a provider that echoes only that (or for mail
 *      sent before the ref existed).
 *
 * Each adapter does two jobs and nothing else:
 *   `verify(rawBody, headers)` → true | false | null   (null = not configured)
 *   `parse(payload, headers)`  → normalised event[]
 *
 * A normalised event is:
 *   { provider, provider_event_id, status, message_ref, provider_ref,
 *     recipient, event_at, error }
 *
 * Adding a provider means adding one entry to PROVIDERS and one line to
 * `refHeaders`. Nothing else in the codebase changes.
 */

"use strict";

const crypto = require("crypto");
const { config } = require("../config/env");
const { logger } = require("../config/logger");

/** Provider event → our ledger vocabulary. Anything unmapped is ignored. */
const STATUS = {
  delivered: "delivered",
  opened: "opened",
  bounced: "bounced",
  complained: "complained",
  failed: "failed",
};

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Normalise an ESP timestamp (seconds, millis, or ISO) to an ISO string. */
function toIso(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const n = Number(value);
    // Seconds vs milliseconds: anything below ~year 2286 in seconds.
    const ms = n > 1e11 ? n : n * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Strip the angle brackets SMTP Message-IDs are usually quoted in. */
function bareMessageId(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  return s.replace(/^</, "").replace(/>$/, "") || null;
}

// ── Correlation headers ──────────────────────────────────────
/**
 * The headers to put on an outbound SMTP message so the ESP echoes our
 * `message_ref` back on every event it reports for that message.
 *
 * We set ALL of them on every send, deliberately. Providers ignore metadata
 * headers they don't recognise, and the relay can be repointed from Messaging
 * Settings without an engineer remembering to change the header set — the
 * alternative is a silent loss of receipts the day someone switches ESP.
 *
 * `X-Entity-Ref-ID` doubles as the generic/no-op case: it is also the header
 * that stops Gmail threading unrelated transactional mail together.
 */
function refHeaders(messageRef) {
  if (!messageRef) return {};
  return {
    "X-Entity-Ref-ID": messageRef,
    // SendGrid: unique_args are echoed on every event.
    "X-SMTPAPI": JSON.stringify({ unique_args: { comms_ref: messageRef } }),
    // Mailgun: surfaced on events as `user-variables`.
    "X-Mailgun-Variables": JSON.stringify({ comms_ref: messageRef }),
    // Postmark: surfaced as `Metadata`.
    "X-PM-Metadata-comms_ref": messageRef,
    // SES: surfaced on SNS notifications as `mail.tags`. Tag values are
    // restricted to [A-Za-z0-9_-], which is why the ref is minted url-safe.
    "X-SES-MESSAGE-TAGS": `comms_ref=${messageRef}`,
  };
}

/** Mint a url-safe correlation token (SES tag values forbid anything else). */
function newMessageRef() {
  return crypto.randomBytes(16).toString("base64url");
}

// ── SendGrid ─────────────────────────────────────────────────
// Event Webhook. Signed with ECDSA over (timestamp + rawBody) using the
// verification key from the SendGrid dashboard. Batched: one POST, many events.
function verifySendgrid(rawBody, headers) {
  const key = config.SENDGRID_WEBHOOK_PUBLIC_KEY;
  if (!key) return null;
  const sig = headers["x-twilio-email-event-webhook-signature"];
  const ts = headers["x-twilio-email-event-webhook-timestamp"];
  if (!sig || !ts) return false;
  try {
    // SendGrid publishes a base64 DER ECDSA public key; Node wants PEM.
    const pem = key.includes("BEGIN PUBLIC KEY")
      ? key
      : `-----BEGIN PUBLIC KEY-----\n${key.replace(/\s+/g, "").match(/.{1,64}/g).join("\n")}\n-----END PUBLIC KEY-----\n`;
    return crypto
      .createVerify("sha256")
      .update(Buffer.concat([Buffer.from(String(ts)), rawBody]))
      .verify(pem, Buffer.from(String(sig), "base64"));
  } catch (err) {
    logger.warn({ err: err.message }, "sendgrid webhook: signature check failed");
    return false;
  }
}

const SENDGRID_STATUS = {
  delivered: STATUS.delivered,
  open: STATUS.opened,
  bounce: STATUS.bounced,
  blocked: STATUS.bounced,
  dropped: STATUS.failed,
  spamreport: STATUS.complained,
  // 'processed' and 'deferred' are in-flight noise — we already recorded the
  // send ourselves, and a deferral is not an outcome.
};

function parseSendgrid(payload) {
  const events = Array.isArray(payload) ? payload : [payload];
  const out = [];
  for (const e of events) {
    if (!e || typeof e !== "object") continue;
    const status = SENDGRID_STATUS[String(e.event || "").toLowerCase()];
    if (!status) continue;
    out.push({
      provider: "sendgrid",
      // sg_event_id is unique per event and stable across redeliveries.
      provider_event_id: e.sg_event_id || null,
      status,
      message_ref: e.comms_ref || null,
      provider_ref: bareMessageId(e["smtp-id"]),
      recipient: e.email || null,
      event_at: toIso(e.timestamp),
      error: e.reason || e.response || null,
    });
  }
  return out;
}

// ── Mailgun ──────────────────────────────────────────────────
// HMAC-SHA256 over (timestamp + token) with the webhook signing key.
function verifyMailgun(rawBody, headers, payload) {
  const key = config.MAILGUN_WEBHOOK_SIGNING_KEY;
  if (!key) return null;
  const sig = (payload && payload.signature) || {};
  if (!sig.timestamp || !sig.token || !sig.signature) return false;
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${sig.timestamp}${sig.token}`)
    .digest("hex");
  return safeEqual(expected, sig.signature);
}

const MAILGUN_STATUS = {
  delivered: STATUS.delivered,
  opened: STATUS.opened,
  complained: STATUS.complained,
  // 'failed' splits on severity: permanent is a bounce, temporary is a
  // deferral the provider will retry — not an outcome worth recording.
};

function parseMailgun(payload) {
  const d = (payload && payload["event-data"]) || {};
  const event = String(d.event || "").toLowerCase();
  let status = MAILGUN_STATUS[event] || null;
  if (event === "failed") {
    if (String(d.severity || "").toLowerCase() === "permanent") {
      status = STATUS.bounced;
    } else {
      return []; // temporary — Mailgun will retry; nothing to report yet
    }
  }
  if (!status) return [];
  const vars = d["user-variables"] || {};
  return [
    {
      provider: "mailgun",
      provider_event_id: d.id || null,
      status,
      message_ref: vars.comms_ref || null,
      provider_ref: bareMessageId(
        (d.message && d.message.headers && d.message.headers["message-id"]) ||
          null,
      ),
      recipient: d.recipient || null,
      event_at: toIso(d.timestamp),
      error:
        (d["delivery-status"] && d["delivery-status"].message) ||
        d.reason ||
        null,
    },
  ];
}

// ── Postmark ─────────────────────────────────────────────────
// Postmark does not sign webhooks. The documented approach is a secret in the
// URL (basic auth or a token) — we take a bearer-ish shared secret header the
// operator sets on the webhook URL as `?token=` (checked in the route) or as a
// custom header. Verified here against POSTMARK_WEBHOOK_SECRET.
function verifyPostmark(_rawBody, headers) {
  const secret = config.POSTMARK_WEBHOOK_SECRET;
  if (!secret) return null;
  const given = headers["x-postmark-webhook-token"] || headers["x-webhook-token"];
  if (!given) return false;
  return safeEqual(secret, given);
}

const POSTMARK_STATUS = {
  Delivery: STATUS.delivered,
  Open: STATUS.opened,
  Bounce: STATUS.bounced,
  SpamComplaint: STATUS.complained,
};

function parsePostmark(payload) {
  const type = payload && (payload.RecordType || payload.Type);
  const status = POSTMARK_STATUS[type];
  if (!status) return [];
  const meta = payload.Metadata || {};
  return [
    {
      provider: "postmark",
      // Postmark has no per-event id; MessageID + record type is unique per
      // outcome (a message delivers once, bounces once, is complained once).
      // Opens can repeat — the ledger records only the first (see applyEvents).
      provider_event_id: payload.MessageID
        ? `${payload.MessageID}:${type}`
        : null,
      status,
      message_ref: meta.comms_ref || null,
      provider_ref: bareMessageId(payload.MessageID),
      recipient: payload.Recipient || payload.Email || null,
      event_at: toIso(
        payload.DeliveredAt || payload.ReceivedAt || payload.BouncedAt,
      ),
      error: payload.Description || payload.Details || null,
    },
  ];
}

// ── Amazon SES (via SNS) ─────────────────────────────────────
// SNS signs with an RSA signature over a canonical string, verified against a
// certificate SNS publishes. The cert fetch is a network call, so we accept
// the simpler documented alternative: a shared secret on the subscription URL
// (checked in the route) plus a topic-ARN allowlist. Set SES_SNS_TOPIC_ARN.
function verifySes(_rawBody, headers, payload) {
  const expected = config.SES_SNS_TOPIC_ARN;
  if (!expected) return null;
  const arn = (payload && payload.TopicArn) || headers["x-amz-sns-topic-arn"];
  if (!arn) return false;
  return safeEqual(expected, arn);
}

const SES_STATUS = {
  Delivery: STATUS.delivered,
  Open: STATUS.opened,
  Bounce: STATUS.bounced,
  Complaint: STATUS.complained,
};

function parseSes(payload) {
  // SNS wraps the SES notification as a JSON string in `Message`.
  let note = payload;
  if (payload && typeof payload.Message === "string") {
    try {
      note = JSON.parse(payload.Message);
    } catch {
      return [];
    }
  }
  const type = note && (note.eventType || note.notificationType);
  const status = SES_STATUS[type];
  if (!status) return [];
  const mail = note.mail || {};
  // SES tags arrive as { comms_ref: ['<value>'] }.
  const tags = mail.tags || {};
  const ref = Array.isArray(tags.comms_ref) ? tags.comms_ref[0] : tags.comms_ref;
  const bounce = note.bounce || {};
  return [
    {
      provider: "ses",
      provider_event_id: mail.messageId ? `${mail.messageId}:${type}` : null,
      status,
      message_ref: ref || null,
      provider_ref: bareMessageId(
        (mail.commonHeaders && mail.commonHeaders.messageId) || null,
      ),
      recipient: (mail.destination && mail.destination[0]) || null,
      event_at: toIso(mail.timestamp || note.timestamp),
      error:
        (bounce.bouncedRecipients &&
          bounce.bouncedRecipients[0] &&
          bounce.bouncedRecipients[0].diagnosticCode) ||
        bounce.bounceSubType ||
        null,
    },
  ];
}

// ── Resend ───────────────────────────────────────────────────
// Svix-style signing: HMAC-SHA256 over `${id}.${timestamp}.${body}` with a
// base64 secret prefixed `whsec_`. The header can carry several
// space-separated `v1,<sig>` values during a secret rotation.
function verifyResend(rawBody, headers) {
  const secret = config.RESEND_WEBHOOK_SECRET;
  if (!secret) return null;
  const id = headers["svix-id"] || headers["webhook-id"];
  const ts = headers["svix-timestamp"] || headers["webhook-timestamp"];
  const sigHeader = headers["svix-signature"] || headers["webhook-signature"];
  if (!id || !ts || !sigHeader) return false;
  // Reject a replayed delivery outside a 5-minute window.
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) return false;
  try {
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    const expected = crypto
      .createHmac("sha256", key)
      .update(`${id}.${ts}.${rawBody.toString("utf8")}`)
      .digest("base64");
    return String(sigHeader)
      .split(" ")
      .some((part) => {
        const value = part.includes(",") ? part.split(",")[1] : part;
        return value && safeEqual(expected, value);
      });
  } catch (err) {
    logger.warn({ err: err.message }, "resend webhook: signature check failed");
    return false;
  }
}

const RESEND_STATUS = {
  "email.delivered": STATUS.delivered,
  "email.opened": STATUS.opened,
  "email.bounced": STATUS.bounced,
  "email.complained": STATUS.complained,
  // email.sent / email.delivery_delayed are in-flight noise.
};

function parseResend(payload, headers) {
  const status = RESEND_STATUS[String(payload && payload.type)];
  if (!status) return [];
  const d = (payload && payload.data) || {};
  const to = Array.isArray(d.to) ? d.to[0] : d.to;
  const hdrs = Array.isArray(d.headers) ? d.headers : [];
  const findHeader = (name) => {
    const row = hdrs.find(
      (h) => h && String(h.name || "").toLowerCase() === name,
    );
    return row ? row.value : null;
  };
  return [
    {
      provider: "resend",
      // Svix message id is stable across the provider's own redeliveries.
      provider_event_id:
        (headers && (headers["svix-id"] || headers["webhook-id"])) ||
        (d.email_id ? `${d.email_id}:${payload.type}` : null),
      status,
      message_ref: findHeader("x-entity-ref-id"),
      provider_ref: bareMessageId(d.email_id || findHeader("message-id")),
      recipient: to || null,
      event_at: toIso(payload.created_at || d.created_at),
      error: (d.bounce && (d.bounce.message || d.bounce.subType)) || null,
    },
  ];
}

/**
 * SNS won't send a single SES notification until the HTTPS subscription is
 * confirmed, and it confirms by POSTing a `SubscriptionConfirmation` carrying a
 * one-shot `SubscribeURL` that must be visited.
 *
 * Auto-confirming means making an outbound request on the strength of an
 * inbound payload, so it is gated twice: the payload must already have passed
 * `verifySes` (its TopicArn equals our configured ARN), and the URL must be
 * https on an amazonaws.com host. Anything else is logged for a human rather
 * than fetched — a mis-signed confirmation is not worth an SSRF.
 */
async function confirmSnsSubscription(payload) {
  if (!payload || payload.Type !== "SubscriptionConfirmation") return false;
  const url = String(payload.SubscribeURL || "");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const allowed =
    parsed.protocol === "https:" &&
    (host === "amazonaws.com" || host.endsWith(".amazonaws.com"));
  if (!allowed) {
    logger.warn(
      { host },
      "SES webhook: refusing to auto-confirm an SNS subscription off an unexpected host",
    );
    return false;
  }
  try {
    const res = await fetch(url, { method: "GET" });
    logger.info(
      { ok: res.ok, status: res.status, topic: payload.TopicArn },
      "SES webhook: SNS subscription confirmed",
    );
    return res.ok;
  } catch (err) {
    logger.error(
      { err: err.message, subscribe_url: url },
      "SES webhook: SNS subscription confirmation failed — visit SubscribeURL manually",
    );
    return false;
  }
}

const PROVIDERS = {
  sendgrid: { verify: verifySendgrid, parse: parseSendgrid },
  mailgun: { verify: verifyMailgun, parse: parseMailgun },
  postmark: { verify: verifyPostmark, parse: parsePostmark },
  ses: { verify: verifySes, parse: parseSes },
  resend: { verify: verifyResend, parse: parseResend },
};

const isProvider = (name) =>
  Object.prototype.hasOwnProperty.call(PROVIDERS, String(name));

/**
 * Verify one provider's webhook.
 * @returns {boolean|null} true valid · false invalid · null not configured
 */
function verify(provider, rawBody, headers, payload) {
  const p = PROVIDERS[provider];
  if (!p) return null;
  return p.verify(rawBody, headers || {}, payload || {});
}

/** Parse a provider payload into normalised events (never throws). */
function parse(provider, payload, headers) {
  const p = PROVIDERS[provider];
  if (!p) return [];
  try {
    return p.parse(payload || {}, headers || {}) || [];
  } catch (err) {
    logger.warn(
      { err: err.message, provider },
      "email receipts: payload parse failed",
    );
    return [];
  }
}

/** Which ESPs currently have a signing secret configured. */
function configuredProviders() {
  return Object.keys(PROVIDERS).filter(
    (name) => PROVIDERS[name].verify(Buffer.alloc(0), {}, {}) !== null,
  );
}

module.exports = {
  PROVIDERS,
  STATUS,
  isProvider,
  verify,
  parse,
  refHeaders,
  newMessageRef,
  configuredProviders,
  confirmSnsSubscription,
  // Exported for tests.
  toIso,
  bareMessageId,
};
