/**
 * Nomba gateway client (V2.2 §5.1) — NGN gateway (also POS terminals).
 *
 * OAuth client-credentials → access token (cached per client_id until ~expiry):
 *   - initializePayment: create an online checkout order (redirect link).
 *   - verifyTransaction: server-side lookup by order reference.
 *   - verifyWebhookSignature: HMAC-SHA256 of the raw body keyed on the client
 *     secret, compared to the `x-nomba-signature` header.
 *
 * Each function accepts an optional `creds` ({ client_id, client_secret,
 * account_id }) resolved per-brand; omitted → env fallback.
 */

"use strict";

const crypto = require("crypto");
const axios = require("axios");
const { config } = require("../config/env");
const { AppError } = require("../utils/errors");

const tokenCache = new Map(); // client_id → { token, expiresAt }

function keys(creds) {
  return {
    client_id: (creds && creds.client_id) || config.NOMBA_CLIENT_ID,
    client_secret: (creds && creds.client_secret) || config.NOMBA_API_KEY,
    account_id: (creds && creds.account_id) || config.NOMBA_ACCOUNT_ID,
  };
}

function isConfigured(creds) {
  const k = keys(creds);
  return Boolean(k.client_id && k.client_secret && k.account_id);
}
function ensure(creds) {
  if (!isConfigured(creds))
    throw new AppError(
      "NOMBA_NOT_CONFIGURED",
      "Nomba keys are not configured",
      503,
    );
}

function http(k) {
  return axios.create({
    baseURL: config.NOMBA_BASE_URL,
    headers: { accountId: k.account_id },
    timeout: 20000,
  });
}

async function getToken(k) {
  const cached = tokenCache.get(k.client_id);
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;
  const { data } = await http(k).post("/v1/auth/token/issue", {
    grant_type: "client_credentials",
    client_id: k.client_id,
    client_secret: k.client_secret,
  });
  const body = data && data.data ? data.data : data;
  const token = body.access_token || body.accessToken;
  const expiresAt = body.expiresAt
    ? new Date(body.expiresAt).getTime()
    : Date.now() + (Number(body.expires_in) || 3600) * 1000;

  tokenCache.set(k.client_id, { token, expiresAt });
  return token;
}

async function authed(method, url, body, creds) {
  ensure(creds);
  const k = keys(creds);
  const token = await getToken(k);
  const { data } = await http(k).request({
    method,
    url,
    data: body,
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
}

/**
 * Create an online checkout order. `amount_ngn` in NGN major units (Nomba uses
 * decimal NGN, not kobo). Returns Nomba's response (checkoutLink in data).
 */
async function initializePayment({
  reference,
  amount_ngn,
  email,
  callback_url,
  creds,
}) {
  return authed(
    "post",
    "/v1/checkout/order",
    {
      order: {
        orderReference: reference,
        callbackUrl: callback_url,
        customerEmail: email,
        amount: Number(amount_ngn),
        currency: "NGN",
      },
    },
    creds,
  );
}

/**
 * Push a charge to a physical Nomba POS terminal (PD §6.21 — Nomba is the
 * in-store POS gateway). `amount_ngn` in NGN major units. The terminal prompts
 * the customer to tap/insert; the result arrives via webhook (confirmed as
 * method 'nomba_terminal'). metadata carries { brand, order_id, amount_ngn,
 * channel:'pos' } for confirmation. NOTE: verify the exact terminal endpoint/
 * payload against your Nomba account's POS API before go-live.
 */
async function requestTerminalPayment({
  terminal_id,
  amount_ngn,
  reference,
  creds,
}) {
  return authed(
    "post",
    `/v1/terminals/payment-request/${encodeURIComponent(terminal_id)}`,
    {
      merchantTxRef: reference,
      amount: Number(amount_ngn),
      currency: "NGN",
    },
    creds,
  );
}

/** Look up a transaction/order by our reference. */
async function verifyTransaction(reference, creds) {
  return authed(
    "get",
    `/v1/checkout/transaction?idType=ORDER_REFERENCE&id=${encodeURIComponent(reference)}`,
    undefined,
    creds,
  );
}

/**
 * Verify an inbound webhook: HMAC-SHA256 over the raw body keyed on the client
 * secret, compared to the x-nomba-signature header. true | false | null.
 */
function verifyWebhookSignature(rawBody, headers = {}, creds) {
  const secret = (creds && creds.client_secret) || config.NOMBA_API_KEY;
  if (!secret) return null;

  const sig = headers["nomba-signature"] || headers["nomba-sig-value"] || null;
  const timestamp = headers["nomba-timestamp"] || null;
  if (!sig || !timestamp) return false;

  let payload;
  try {
    payload = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
  } catch {
    return false;
  }

  const data = payload.data || {};
  const merchant = data.merchant || {};
  const transaction = data.transaction || {};

  let responseCode = transaction.responseCode || "";
  if (responseCode === "null") responseCode = "";

  const hashInput = [
    payload.event_type || "",
    payload.requestId || "",
    merchant.userId || "",
    merchant.walletId || "",
    transaction.transactionId || "",
    transaction.type || "",
    transaction.time || "",
    responseCode,
    timestamp,
  ].join(":");

  const computed = crypto
    .createHmac("sha256", secret)
    .update(hashInput)
    .digest("base64");

  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(sig));
  } catch {
    return false;
  }
}

module.exports = {
  isConfigured,
  initializePayment,
  requestTerminalPayment,
  verifyTransaction,
  verifyWebhookSignature,
};
