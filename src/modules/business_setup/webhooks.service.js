/**
 * Inbound webhook pipeline (H-4 / R-3 / D-1).
 *
 * receive(source, …):
 *   1. Verify the signature on the RAW body (Paystack HMAC-SHA512 today; other
 *      gateways fall through to "logged but not processed" until their verifier
 *      + secret are configured — we never process an unverified payload).
 *   2. Persist to shared.webhook_log, deduped on (source, external_id).
 *   3. Enqueue a `webhook.received` event on the transactional outbox (atomic
 *      with the log insert) and return 200 fast.
 *
 * Processing happens post-commit in the outbox dispatcher (worker): re-verify
 * with the gateway API, resolve brand+order from the transaction metadata, and
 * confirm the payment idempotently. Nothing here trusts the payload alone.
 */

"use strict";

const crypto = require("crypto");
const { config } = require("../../config/env");
const { VALID_BRANDS } = require("../../config/brands");
const { transaction } = require("../../config/database");
const requestContext = require("../../config/request-context");
const outbox = require("../../shared/outbox/outbox");
const paystack = require("../../services/paystack.service");
const salesRepo = require("../sales/sales.repo");
const { money, toCurrencyString } = require("../../utils/money");
const { logger } = require("../../config/logger");
const repo = require("./webhooks.repo");

// event_outbox.business is NOT NULL; webhooks aren't brand-scoped at receive
// time (the brand is resolved later from transaction metadata).
const SYSTEM_BRAND = "__system__";

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ── Signature verifiers ───────────────────────────────────
// Return true (valid), false (present but invalid), or null (no verifier
// configured for this source → cannot verify, do not process).
function verifyPaystack(rawBody, headers) {
  const secret = config.PAYSTACK_SECRET_KEY;
  if (!secret) return null;
  const sig = headers["x-paystack-signature"];
  if (!sig) return false;
  const hash = crypto
    .createHmac("sha512", secret)
    .update(rawBody)
    .digest("hex");
  return safeEqual(hash, sig);
}

const VERIFIERS = {
  paystack: verifyPaystack,
  // opay / nomba / stripe / meta_* : add verifier + secret to enable processing.
};

function extractExternalId(source, payload) {
  if (source === "paystack") {
    const d = payload && payload.data;
    if (d && d.id !== undefined && d.id !== null) return String(d.id);
    if (d && d.reference) return String(d.reference);
  }
  if (payload && payload.id) return String(payload.id);
  return null;
}

/**
 * Meta GET verification handshake. Echo hub.challenge iff the verify token
 * matches the configured token for the channel.
 */
function metaChallenge(source, q) {
  const token =
    source === "meta_whatsapp"
      ? config.META_WA_VERIFY_TOKEN
      : config.META_GRAPH_VERIFY_TOKEN;
  if (
    token &&
    q["hub.mode"] === "subscribe" &&
    q["hub.verify_token"] === token
  ) {
    return { ok: true, challenge: q["hub.challenge"] };
  }
  return { ok: false };
}

async function receive(source, { rawBody, headers, ip }) {
  const verifier = VERIFIERS[source];
  const verdict = verifier ? verifier(rawBody, headers || {}) : null;

  let payload = {};
  try {
    payload = JSON.parse((rawBody && rawBody.toString("utf8")) || "{}");
  } catch {
    payload = {
      raw: (rawBody && rawBody.toString("utf8").slice(0, 5000)) || "",
    };
  }
  const event_type = payload.event || payload.type || null;
  const external_id = extractExternalId(source, payload);

  // Verifier exists and the signature is invalid → reject, log for audit.
  if (verifier && verdict === false) {
    await repo.insertLog(null, {
      source,
      event_type,
      external_id,
      payload,
      signature_valid: false,
      source_ip: ip,
    });
    logger.warn({ source, external_id }, "webhook rejected: invalid signature");
    return { status: 401, body: { error: "INVALID_SIGNATURE" } };
  }

  const signature_valid = verdict === true;
  const result = await transaction(async (client) => {
    const log = await repo.insertLog(client, {
      source,
      event_type,
      external_id,
      payload,
      signature_valid,
      source_ip: ip,
    });
    if (log.duplicate) return { duplicate: true };
    // Only verified events are routed into processing.
    if (signature_valid) {
      await outbox.enqueue(client, {
        business: SYSTEM_BRAND,
        event_type: "webhook.received",
        payload: { webhook_id: log.webhook_id, source, type: event_type },
        dedup_key: `webhook:${source}:${external_id || log.webhook_id}`,
      });
    }
    return { duplicate: false };
  });

  return { status: 200, body: { received: true, duplicate: result.duplicate } };
}

// ── Processing (runs post-commit in the outbox dispatcher) ─
function mapPaystackChannel(channel) {
  if (channel === "card") return "paystack_card";
  if (channel === "ussd") return "paystack_ussd";
  return "paystack_transfer";
}

async function confirmPaystackCharge(log) {
  const evt = log.payload || {};
  if (evt.event !== "charge.success") return; // only successful charges
  const reference = evt.data && evt.data.reference;
  if (!reference) throw new Error("paystack charge.success missing reference");

  // Re-verify with Paystack — never trust the payload alone.
  const verify = await paystack.verifyTransaction(reference);
  const data = verify && verify.data;
  if (!data || data.status !== "success") return;

  const brand = data.metadata && data.metadata.brand;
  const order_id = data.metadata && data.metadata.order_id;
  if (!brand || !VALID_BRANDS.has(brand) || !order_id) {
    throw new Error(
      `paystack ${reference}: missing/invalid metadata.brand/order_id — manual review`,
    );
  }

  // Idempotency: skip if this gateway reference is already recorded on the order.
  const already = await salesRepo.paymentExistsByProviderRef({
    brand,
    order_id,
    provider_reference: reference,
  });
  if (already) return;

  const amountNgn = money(data.amount).dividedBy(100); // kobo → NGN
  const method = mapPaystackChannel(data.channel);

  // Confirm under the real brand's context (RLS/audit GUCs).
  await requestContext.run({ brand, userId: null }, async () => {
    const salesService = require("../sales/sales.service");
    await salesService.addPayment({
      brand,
      user: { user_id: null },
      request_id: `webhook:${log.webhook_id}`,
      id: order_id,
      input: {
        method,
        provider: "paystack",
        provider_reference: reference,
        amount_ngn: toCurrencyString(amountNgn),
        payment_path: "gateway",
        client_idempotency_key: `paystack:${reference}`,
      },
    });
  });
  logger.info(
    { brand, order_id, reference },
    "paystack charge confirmed via webhook",
  );
}

const DISPATCH = {
  paystack: confirmPaystackCharge,
};

async function onWebhookReceived({ webhook_id }) {
  const log = await repo.findById(webhook_id);
  if (!log || log.processed) return; // already handled
  try {
    const handler = DISPATCH[log.source];
    if (handler) await handler(log);
    await repo.markProcessed(webhook_id, { error_message: null });
  } catch (err) {
    await repo.markProcessed(webhook_id, {
      error_message: String((err && err.message) || err),
    });
    throw err; // let the outbox retry with backoff
  }
}

let registered = false;
function register() {
  if (registered) return;
  registered = true;
  outbox.register("webhook.received", "webhook-dispatch", onWebhookReceived);
  logger.info(
    "webhook subscribers registered (outbox webhook.received → dispatch)",
  );
}

register();

module.exports = { receive, metaChallenge, register, onWebhookReceived };
