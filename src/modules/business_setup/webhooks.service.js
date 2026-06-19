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
const { transaction, query } = require("../../config/database");
const requestContext = require("../../config/request-context");
const outbox = require("../../shared/outbox/outbox");
const paystack = require("../../services/paystack.service");
const opay = require("../../services/opay.service");
const nomba = require("../../services/nomba.service");
const stripe = require("../../services/stripe.service");
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

function verifyOpay(rawBody, headers) {
  return opay.verifyWebhookSignature(rawBody, headers || {});
}
function verifyNomba(rawBody, headers) {
  return nomba.verifyWebhookSignature(rawBody, headers || {});
}
// Stripe verifies + parses in one step (constructEvent over the raw body).
function verifyStripe(rawBody, headers) {
  if (!config.STRIPE_WEBHOOK_SECRET) return null;
  const sig = (headers || {})["stripe-signature"];
  if (!sig) return false;
  try {
    stripe.constructWebhookEvent(rawBody, sig);
    return true;
  } catch {
    return false;
  }
}

// Meta payload signature — both WhatsApp Cloud and Instagram Messenger
// sign with the App Secret via HMAC-SHA256 over the raw body and put the
// hex digest in `x-hub-signature-256: sha256=<hex>`. Same algo for both,
// different env vars holding the App Secret per integration.
function verifyMeta(secretEnvKey) {
  return (rawBody, headers) => {
    const secret = config[secretEnvKey];
    if (!secret) return null;
    const sig = (headers || {})["x-hub-signature-256"];
    if (!sig) return false;
    const expected =
      "sha256=" +
      crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    return safeEqual(expected, sig);
  };
}

// Cloudflare Email Routing posts to the inbound webhook via an Email
// Worker that signs the payload with a shared secret in
// `x-cf-email-signature: sha256=<hex>` (HMAC-SHA256 over the raw body).
// No secret configured = "logged but not processed" so an unverified
// stream can never leak into the inbox.
function verifyCloudflareEmail(rawBody, headers) {
  const secret = config.CF_EMAIL_INBOUND_SECRET;
  if (!secret) return null;
  const sig = (headers || {})["x-cf-email-signature"];
  if (!sig) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqual(expected, sig);
}

const VERIFIERS = {
  paystack: verifyPaystack,
  opay: verifyOpay,
  nomba: verifyNomba,
  stripe: verifyStripe,
  meta_whatsapp: verifyMeta("META_WA_APP_SECRET"),
  meta_instagram: verifyMeta("META_IG_APP_SECRET"),
  cloudflare_email: verifyCloudflareEmail,
};

function extractExternalId(source, payload) {
  if (source === "paystack") {
    const d = payload && payload.data;
    if (d && d.id !== undefined && d.id !== null) return String(d.id);
    if (d && d.reference) return String(d.reference);
  }
  if (source === "opay") {
    const d = (payload && (payload.payload || payload.data)) || {};
    return (
      String(d.reference || d.orderNo || d.transactionId || payload.id || "") ||
      null
    );
  }
  if (source === "nomba") {
    const d = (payload && payload.data) || {};
    const tx = d.transaction || d.order || d;
    return (
      String(
        tx.transactionId ||
          tx.orderReference ||
          tx.merchantTxRef ||
          payload.id ||
          "",
      ) || null
    );
  }
  if (source === "stripe") {
    const obj = payload && payload.data && payload.data.object;
    if (obj && obj.id) return String(obj.id);
    if (payload && payload.id) return String(payload.id); // event id
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
  const amount_ngn = toCurrencyString(money(data.amount).dividedBy(100)); // kobo → NGN
  await recordGatewayPayment({
    brand,
    order_id,
    reference,
    amount_ngn,
    method: mapPaystackChannel(data.channel),
    provider: "paystack",
    webhook_id: log.webhook_id,
  });
}

/**
 * Gateway processing fee (NGN) from the brand's configured fee schedule
 * (business_config.payment_gateway_fees, §6.21/§6.25). NGN gateways:
 * min(amount*pct + fixed, cap_ngn). Stripe (INTL): amount*pct + fixed_usd×fx.
 * Returns a decimal string ("0" when no schedule entry).
 */
async function gatewayFeeNgn({ brand, provider, amount_ngn, fx_rate }) {
  let schedule = {};
  try {
    const { rows } = await query(
      `SELECT payment_gateway_fees FROM shared.business_config WHERE business_key = $1`,
      [brand],
    );
    schedule = (rows[0] && rows[0].payment_gateway_fees) || {};
  } catch {
    return "0";
  }
  const f = schedule[provider];
  if (!f) return "0";
  let fee = money(amount_ngn).times(money(f.pct || 0));
  if (f.fixed) fee = fee.plus(money(f.fixed));
  if (f.fixed_usd && fx_rate)
    fee = fee.plus(money(f.fixed_usd).times(money(fx_rate)));
  if (f.cap_ngn !== null && fee.gt(money(f.cap_ngn))) fee = money(f.cap_ngn);
  return toCurrencyString(fee);
}

/**
 * Shared tail: idempotently record a confirmed gateway payment against the
 * order under the brand's context, capturing the per-gateway processing fee
 * (§6.21/§6.6 — books to the gateway's 551x account via net_received) and, for
 * foreign-currency settlements (Stripe), the paid currency/amount/rate so the
 * realised-FX posting in addPayment fires. `amount_ngn` is a decimal string.
 */
async function recordGatewayPayment({
  brand,
  order_id,
  reference,
  amount_ngn,
  method,
  provider,
  webhook_id,
  paid_currency = null,
  paid_amount = null,
  fx_rate_used = null,
}) {
  if (!brand || !VALID_BRANDS.has(brand) || !order_id) {
    throw new Error(
      `${provider} ${reference}: missing/invalid metadata.brand/order_id — manual review`,
    );
  }
  const already = await salesRepo.paymentExistsByProviderRef({
    brand,
    order_id,
    provider_reference: reference,
  });
  if (already) return;

  const fee_ngn = await gatewayFeeNgn({
    brand,
    provider,
    amount_ngn,
    fx_rate: fx_rate_used,
  });

  await requestContext.run({ brand, userId: null }, async () => {
    const salesService = require("../sales/sales.service");
    await salesService.addPayment({
      brand,
      user: { user_id: null },
      request_id: `webhook:${webhook_id}`,
      id: order_id,
      input: {
        method,
        provider,
        provider_reference: reference,
        amount_ngn,
        fee_ngn,
        paid_currency,
        paid_amount,
        fx_rate_used,
        payment_path: "gateway",
        client_idempotency_key: `${provider}:${reference}`,
      },
    });
  });
  logger.info(
    { brand, order_id, reference, provider, fee_ngn },
    "gateway charge confirmed via webhook",
  );
}

const metaOf = (obj) => (obj && obj.metadata) || {};

async function confirmOpayCharge(log) {
  const evt = log.payload || {};
  const node = evt.payload || evt.data || evt;
  const reference = node.reference || node.orderNo;
  if (!reference) throw new Error("opay webhook missing reference");
  // Re-verify with OPay — never trust the payload alone.
  const res = await opay.verifyTransaction(reference);
  const data = (res && res.data) || {};
  const status = data.status || node.status;
  if (status !== "SUCCESS") return;
  const meta = { ...metaOf(node), ...metaOf(data) };
  const amount_ngn =
    meta.amount_ngn !== null && meta.amount_ngn !== undefined
      ? toCurrencyString(money(meta.amount_ngn))
      : toCurrencyString(
          money(
            data.amount && data.amount.total
              ? data.amount.total
              : node.amount || 0,
          ).dividedBy(100),
        );
  await recordGatewayPayment({
    brand: meta.brand,
    order_id: meta.order_id,
    reference,
    amount_ngn,
    method: "opay",
    provider: "opay",
    webhook_id: log.webhook_id,
  });
}

async function confirmNombaCharge(log) {
  const evt = log.payload || {};
  const d =
    (evt.data && (evt.data.transaction || evt.data.order || evt.data)) || {};
  const reference = d.orderReference || d.merchantTxRef;
  if (!reference) throw new Error("nomba webhook missing order reference");
  const res = await nomba.verifyTransaction(reference);
  const tx = (res && res.data && (res.data.transaction || res.data)) || {};
  const success = (tx.status || d.status || "").toLowerCase() === "success";
  if (!success) return;
  const meta = { ...metaOf(d), ...metaOf(tx) };
  const amount_ngn =
    meta.amount_ngn !== null && meta.amount_ngn !== undefined
      ? toCurrencyString(money(meta.amount_ngn))
      : toCurrencyString(money(tx.amount || d.amount || 0)); // Nomba is NGN major units
  // Nomba is POS-first (§6.21). Treat as a terminal payment unless the metadata
  // explicitly flags an online checkout (hybrid scenario).
  const method = meta.channel === "online" ? "nomba_online" : "nomba_terminal";
  await recordGatewayPayment({
    brand: meta.brand,
    order_id: meta.order_id,
    reference,
    amount_ngn,
    method,
    provider: "nomba",
    webhook_id: log.webhook_id,
  });
}

async function confirmStripeCharge(log) {
  const evt = log.payload || {};
  // Handle the terminal success events.
  if (
    evt.type !== "checkout.session.completed" &&
    evt.type !== "payment_intent.succeeded"
  )
    return;
  const obj = (evt.data && evt.data.object) || {};
  // For a session, the payment is captured only when payment_status === 'paid'.
  if (
    evt.type === "checkout.session.completed" &&
    obj.payment_status !== "paid"
  )
    return;
  // checkout.session.completed and payment_intent.succeeded both fire for the
  // same charge but carry different ids (cs_... vs pi_...). Normalise onto the
  // Payment Intent id so the two events dedupe to one payment instead of
  // double-crediting the order (P0-2).
  const reference =
    evt.type === "checkout.session.completed"
      ? obj.payment_intent || obj.id
      : obj.id;
  const meta = metaOf(obj);
  if (meta.amount_ngn === null)
    throw new Error(
      `stripe ${reference}: metadata.amount_ngn required — manual review`,
    );
  const amount_ngn = toCurrencyString(money(meta.amount_ngn));

  // Foreign-currency capture (§6.6): a Stripe session presents in its own
  // currency; record what the customer actually paid + the effective rate so
  // addPayment can post the realised-FX variance against the order's booked rate.
  let paid_currency = null;
  let paid_amount = null;
  let fx_rate_used = null;
  const cur = (obj.currency || "").toUpperCase();
  const minor =
    obj.amount_total !== null && obj.amount_total !== undefined
      ? obj.amount_total
      : obj.amount;
  if (cur && cur !== "NGN" && minor !== null) {
    // Zero-decimal currencies aside, Stripe amounts are in minor units.
    paid_currency = cur;
    paid_amount = toCurrencyString(money(minor).dividedBy(100));
    if (money(paid_amount).gt(0))
      fx_rate_used = money(amount_ngn).dividedBy(money(paid_amount)).toFixed(6);
  }

  await recordGatewayPayment({
    brand: meta.brand,
    order_id: meta.order_id,
    reference,
    amount_ngn,
    method: "stripe_card",
    provider: "stripe",
    webhook_id: log.webhook_id,
    paid_currency,
    paid_amount,
    fx_rate_used,
  });
}

const DISPATCH = {
  paystack: confirmPaystackCharge,
  opay: confirmOpayCharge,
  nomba: confirmNombaCharge,
  stripe: confirmStripeCharge,
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

/**
 * Hand a failed/unprocessed webhook batch off to the `webhooks-replay` queue.
 * Enqueues one job per replayable row (so each retries independently with the
 * queue's own backoff). Safe to call repeatedly — re-processing is idempotent
 * (recordGatewayPayment dedups on client_idempotency_key + provider reference).
 * Returns the webhook_ids that were enqueued.
 */
async function enqueueReplay({
  source = null,
  limit = 100,
  maxRetries = 25,
} = {}) {
  const { enqueue } = require("../../jobs/queue-producer");
  const rows = await repo.listReplayable({ source, limit, maxRetries });
  for (const r of rows) {
    await enqueue(
      "webhooks-replay",
      "replay",
      { webhook_id: r.webhook_id },
      // Stable jobId collapses duplicate enqueues for the same webhook while one
      // is still pending, so overlapping sweeps don't pile up.
      { jobId: `replay:${r.webhook_id}` },
    );
  }
  logger.info({ source, count: rows.length }, "enqueued webhook replay batch");
  return rows.map((r) => r.webhook_id);
}

module.exports = {
  receive,
  metaChallenge,
  register,
  onWebhookReceived,
  enqueueReplay,
};
