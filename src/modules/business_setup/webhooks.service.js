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

/**
 * Verify a Nomba webhook signature.
 *
 * Nomba's signature key is a SEPARATE secret from the API client_secret.
 * It is set in the Nomba dashboard (Developer → Webhook Setup) and must be
 * stored in env as NOMBA_WEBHOOK_SIG_KEY (plus per-brand overrides).
 *
 * This function tries each configured webhook signature key (per-brand + legacy
 * fallback). If any key produces a valid signature → accept.
 * If all keys are present-but-invalid → reject (401).
 * If no keys are configured → return null (log only, do not process).
 */
function verifyNomba(rawBody, headers) {
  // Collect all configured webhook signature keys:
  // 1. Per-brand env vars (same naming convention as API keys)
  // 2. Generic env var
  // NOTE: these are WEBHOOK SIG KEYS, not API client_secrets.
  const sigKeys = [
    config.PIXIE_NOMBA_WEBHOOK_SIG_KEY,
    config.FAITLYN_NOMBA_WEBHOOK_SIG_KEY,
    config.NOMBA_WEBHOOK_SIG_KEY,
  ].filter(Boolean);

  if (!sigKeys.length) {
    // No webhook signature key configured — log only, do NOT process.
    // This is the safe default: an unverified payload must never be acted on.
    logger.warn(
      "Nomba webhook: no webhook signature key configured; " +
      "set NOMBA_WEBHOOK_SIG_KEY (or brand-specific override) to enable verification",
    );
    return null;
  }

  let invalid = false;
  for (const key of sigKeys) {
    const r = nomba.verifyWebhookSignature(rawBody, headers || {}, {
      webhook_signature_key: key,
    });
    if (r === true) return true;   // valid for this key → accept immediately
    if (r === false) invalid = true;
  }
  return invalid ? false : null;
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
      String(d.reference || d.orderNo || d.transactionId || payload.id || "")
        || null
    );
  }
  if (source === "nomba") {
    // Nomba's inbound webhook payload structure (per official docs):
    //   payload.event_type  – string, e.g. "payment_success"
    //   payload.requestId   – UUID
    //   payload.data.merchant    – { userId, walletId, walletBalance }
    //   payload.data.transaction – { transactionId, sessionId, type, time, … }
    //   payload.data.customer    – { bankCode, senderName, … }
    //
    // The unique identifiers Nomba sends are:
    //   - data.transaction.transactionId (Nomba's internal ID)
    //   - data.transaction.sessionId    (Nomba's session ID)
    //   - payload.requestId            (unique per webhook event)
    //
    // Our outbound orderReference/merchantTxRef may appear in some flows
    // (e.g. checkout callbacks) but are NOT guaranteed in all Nomba event
    // types. Use requestId as the primary external_id for dedup.
    const d   = (payload && payload.data) || {};
    const tx  = d.transaction || {};
    const ext = String(
      tx.transactionId ||
        tx.sessionId     ||   // Nomba session ID (reliable)
        payload.requestId ||   // unique per webhook event (always present)
        tx.orderReference ||
        tx.merchantTxRef  ||
        payload.id         ||
        "",
    );
    return ext || null;
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
  // Nomba uses `event_type`; Stripe/others use `type`; Paystack uses `event`.
  const event_type =
    payload.event || payload.type || payload.event_type || null;
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
  const dataOrder = (evt.data && evt.data.order) || {};
  const dataTx = (evt.data && evt.data.transaction) || {};
  const dataTerminal = (evt.data && evt.data.terminal) || {};

  // For online_checkout (USD via Stripe): orderReference in order, currency/amount in order
  // For terminal (NGN): everything in transaction. Prefer order.orderReference.
  const reference = dataOrder.orderReference || dataTx.transactionId || dataTx.sessionId || dataTx.merchantTxRef;

  // ── Determine the event type (Nomba sends this as event_type) ──────
  const evtType = String(evt.event_type || evt.type || "").toLowerCase();
  const isPaymentSuccess = evtType === "payment_success";

  if (!reference && !isPaymentSuccess) {
    // Not a recognised payment event and we have no reference → nothing to do.
    return;
  }

  // ── Salary payout webhook (HR) ──────────────────────────
  // Disbursement sends merchantTxRef = `PAY-<payslip_id>`, so a payout/transfer
  // event references PAY-… regardless of the exact Nomba event name. Reconcile
  // the payslip status and stop (it's not an order charge).
  const isPayout =
    reference && (
      /^pay-/i.test(String(reference)) ||
      evtType.includes("payout") ||
      evtType.includes("transfer")
    );
  if (isPayout) {
    const payrollSvc = require("../../shared/hr_payroll/payroll.service");
    const st = String(dataTx.status || evtType || "").toLowerCase();
    await payrollSvc.reconcilePayout({
      reference: String(reference),
      success: st.includes("success") || st.includes("complete"),
      failed:
        st.includes("fail") || st.includes("declin") || st.includes("revers"),
      provider_ref: dataTx.transactionId || dataTx.sessionId || dataTx.id || null,
    });
    return;
  }

  // ── For payment_success events, we MUST process even if reference is ──
  //     only in the transaction object (which we re-verify via API below).
  if (!reference && !isPaymentSuccess) return;

  // Per-brand Nomba: discover the owning brand by re-verifying against each
  // configured account (only the owner returns the transaction).
  const gateways = require("./payment-gateways.service");
  let res = null;
  const orderMeta = dataOrder.metadata || dataOrder.orderMetaData || {};
  const txMeta = dataTx.metadata || {};
  const meta = { ...txMeta, ...orderMeta };

  let resolvedBrand = meta.brand || null;

  // If brand not in metadata, extract from order number pattern in reference.
  // "nomba-FLH-SO-0037-mqsyyrps" → FLH → faitlynhair
  // "nomba-PXG-SO-0001-..." → PXG → pixiegirl
  if (!resolvedBrand && reference && reference.includes("-")) {
    const brandMatch = reference.match(/-(FLH|PXG)-/);
    if (brandMatch) {
      resolvedBrand = brandMatch[1] === "FLH" ? "faitlynhair" : "pixiegirl";
    }
  }

  const tryBrands = resolvedBrand ? [resolvedBrand] : VALID_BRANDS;
  for (const b of tryBrands) {
    const creds = await gateways.resolveCredentials({
      brand: b,
      provider: "nomba",
    });
    if (!creds) continue;
    try {
      const r = await nomba.verifyTransaction(reference, creds);
      const tx0 = (r && r.data && (r.data.transaction || r.data)) || {};
      if (tx0.status || tx0.orderReference || tx0.id) {
        res = r;
        resolvedBrand = b;
        break;
      }
    } catch {
      // not this brand's transaction — try the next
    }
  }

  // If we couldn't verify via API but the event_type is payment_success,
  // trust the webhook payload (Nomba already signed it) and proceed.
  const tx       = (res && res.data && (res.data.transaction || res.data)) || dataTx;
  const evtIsSuccess = isPaymentSuccess || (tx.status || "").toLowerCase() === "success";

  if (!evtIsSuccess) {
    // Not a success event — nothing to confirm (e.g. payment_failed).
    return;
  }

  // Nomba is POS-first (§6.21). Treat as a terminal payment unless the metadata
  // explicitly flags an online checkout (hybrid scenario).
  const method = meta.channel === "online" ? "nomba_online" : "nomba_terminal";

  // Resolve the order row. We need it both to recover order_id when the payload
  // carried no metadata AND to derive the NGN amount for a foreign-currency
  // settlement (below) — for a USD charge Nomba's order.amount is in DOLLARS, so it
  // must never be treated as the Naira figure.
  let order_id = meta.order_id;
  let order = null;
  if (resolvedBrand) {
    if (order_id) {
      order = await salesRepo.findById({ brand: resolvedBrand, id: order_id });
    } else {
      // Recover the order from the reference (`nomba-<order_number>-<ts>`).
      const noPrefix = String(reference || "").replace(/^nomba-/, "");
      const cut = noPrefix.lastIndexOf("-");
      const orderNumber = cut > 0 ? noPrefix.slice(0, cut) : noPrefix;
      if (orderNumber) {
        order = await salesRepo.findByOrderNumber({
          brand: resolvedBrand,
          order_number: orderNumber,
        });
        if (order) order_id = order.order_id;
      }
    }
  }

  // ── Settlement currency and amount ──
  // For online_checkout (USD via Stripe): currency and amount in dataOrder
  // For terminal (NGN): in dataTx. Foreign currency → book realised FX variance.
  const isOnlineCheckout = (dataTx.type || "").toLowerCase() === "online_checkout";
  const settledCurrency = isOnlineCheckout
    ? String(dataOrder.currency || "").toUpperCase()
    : String(tx.currency || dataTx.currency || "").toUpperCase();

  let amount_ngn;
  let paid_currency = null;
  let paid_amount = null;
  let fx_rate_used = null;

  if (settledCurrency && settledCurrency !== "NGN") {
    if (!order)
      throw new Error(
        `nomba ${reference}: cannot resolve order for ${settledCurrency} settlement — manual review`,
      );
    const outstanding = money(order.total_ngn).minus(
      money(order.amount_paid_ngn || 0),
    );
    amount_ngn = toCurrencyString(
      outstanding.gt(0) ? outstanding : money(order.total_ngn),
    );
    paid_currency = settledCurrency;
    // For online_checkout, amount is in dataOrder; for terminal, Nomba uses
    // data.transaction.transactionAmount (not the non-existent tx.amount).
    const txAmount = isOnlineCheckout
      ? dataOrder.amount
      : (dataTx.transactionAmount || tx.amount || dataTx.amount || 0);
    paid_amount = toCurrencyString(money(txAmount));
    if (money(paid_amount).gt(0))
      fx_rate_used = money(amount_ngn).dividedBy(money(paid_amount)).toFixed(6);
  } else {
    // Nomba sends the NGN figure under different keys depending on the path:
    //   • online checkout / bank transfer → data.order.amount      (dataOrder.amount)
    //   • POS / terminal                  → data.transaction.transactionAmount
    // The legacy tx.amount / dataTx.amount fields do not exist in Nomba's
    // payload, so they resolved to 0 and tripped the database check constraint
    // sales_order_payments_amount_ngn_check, silently blocking confirmation.
    const nombaNgnAmount = isOnlineCheckout
      ? dataOrder.amount
      : dataTx.transactionAmount;
    amount_ngn =
      meta.amount_ngn !== null && meta.amount_ngn !== undefined
        ? toCurrencyString(money(meta.amount_ngn))
        : toCurrencyString(money(nombaNgnAmount || 0)); // Nomba NGN major units
  }

  // ── Fallback 1: unmatched in-store terminal payment ──────────
  // A POS/terminal payment that arrived with no usable order reference
  // (no merchantTxRef, or one that didn't resolve to an order) cannot be
  // auto-confirmed. Park it in the reconciliation queue for staff to match
  // by amount + terminal + time, instead of throwing it into an endless
  // retry loop. Online-checkout payments are NOT parked — a missing order
  // there is a real error and should surface. Returning normally marks the
  // webhook processed so the replay sweep leaves it alone.
  if (method === "nomba_terminal" && !order_id) {
    const posRepo = require("../pos/pos.repo");
    const nombaTerminalId = dataTerminal.terminalId || null;
    // Recover the owning brand from the terminal registry when the reference
    // didn't give us one (POS payloads carry no brand otherwise).
    let reconBrand = resolvedBrand;
    if (!reconBrand && nombaTerminalId) {
      for (const b of VALID_BRANDS) {
        const term = await posRepo.findTerminalByNombaId({
          brand: b,
          nomba_terminal_id: nombaTerminalId,
        });
        if (term) {
          reconBrand = b;
          break;
        }
      }
    }
    await posRepo.enqueueReconciliation({
      row: {
        webhook_id: log.webhook_id,
        provider: "nomba",
        resolved_brand: reconBrand || null,
        nomba_terminal_id: nombaTerminalId,
        alias_account_name:
          tx.aliasAccountName || dataTx.aliasAccountName || null,
        amount_ngn,
        transaction_time: tx.time || dataTx.time || null,
        provider_reference:
          reference || tx.transactionId || dataTx.transactionId || null,
        raw_payload: evt,
      },
    });
    logger.warn(
      {
        webhook_id: log.webhook_id,
        nomba_terminal_id: nombaTerminalId,
        amount_ngn,
        resolved_brand: reconBrand || null,
      },
      "nomba terminal payment parked for manual reconciliation (no order reference)",
    );
    return;
  }

  await recordGatewayPayment({
    brand: meta.brand || resolvedBrand,
    order_id,
    reference: reference || tx.transactionId || tx.sessionId,
    amount_ngn,
    method,
    provider: "nomba",
    webhook_id: log.webhook_id,
    paid_currency,
    paid_amount,
    fx_rate_used,
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
  // Exposed so POS terminal reconciliation can confirm a manually-matched
  // payment through the same idempotent, fee-aware path the webhook uses.
  recordGatewayPayment,
};
