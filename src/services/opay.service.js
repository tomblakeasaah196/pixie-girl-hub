/**
 * OPay gateway client (V2.2 §5.1, §6.21) — NGN gateway, Paystack's primary/
 * fallback pair.
 *
 * Cashier flow:
 *   - initializePayment: create a checkout the customer is redirected to.
 *   - verifyTransaction: server-side status query (never trust a callback alone).
 *   - verifyWebhookSignature: HMAC-SHA512 of the payload with the merchant
 *     secret (private key), compared to the `sha512` OPay sends.
 *
 * Each function accepts an optional `creds` ({ public_key, private_key,
 * merchant_id }) resolved per-brand; omitted → env fallback. Calls throw a
 * clean 503 until keys are set. Amounts are in NGN minor units (kobo).
 */

"use strict";

const crypto = require("crypto");
const axios = require("axios");
const { config } = require("../config/env");
const { AppError } = require("../utils/errors");

function keys(creds) {
  return {
    public_key: (creds && creds.public_key) || config.OPAY_PUBLIC_KEY,
    private_key: (creds && creds.private_key) || config.OPAY_PRIVATE_KEY,
    merchant_id: (creds && creds.merchant_id) || config.OPAY_MERCHANT_ID,
  };
}

function isConfigured(creds) {
  const k = keys(creds);
  return Boolean(k.public_key && k.private_key && k.merchant_id);
}
function ensure(creds) {
  if (!isConfigured(creds))
    throw new AppError(
      "OPAY_NOT_CONFIGURED",
      "OPay keys are not configured",
      503,
    );
}

function sign(bodyStr, privateKey) {
  return crypto.createHmac("sha512", privateKey).update(bodyStr).digest("hex");
}

/**
 * Create a Cashier checkout. `amount_kobo` in NGN minor units.
 * Returns OPay's response (data.data.cashierUrl is the redirect link).
 */
async function initializePayment({
  reference,
  amount_kobo,
  email,
  callback_url,
  return_url,
  metadata,
  creds,
}) {
  ensure(creds);
  const k = keys(creds);
  const body = {
    country: "NG",
    reference,
    amount: { total: Number(amount_kobo), currency: "NGN" },
    returnUrl: return_url,
    callbackUrl: callback_url,
    customerEmail: email,
    payMethods: ["account", "qrcode", "bankCard", "bankTransfer"],
    productList: [],
    metadata: metadata || {},
  };
  const { data } = await axios.post(
    `${config.OPAY_BASE_URL}/api/v1/international/cashier/create`,
    body,
    {
      headers: {
        Authorization: `Bearer ${k.public_key}`,
        MerchantId: k.merchant_id,
        Signature: sign(JSON.stringify(body), k.private_key),
        "Content-Type": "application/json",
      },
      timeout: 20000,
    },
  );
  return data;
}

/** Server-side status query for a reference. */
async function verifyTransaction(reference, creds) {
  ensure(creds);
  const k = keys(creds);
  const body = { country: "NG", reference };
  const { data } = await axios.post(
    `${config.OPAY_BASE_URL}/api/v1/international/cashier/status`,
    body,
    {
      headers: {
        Authorization: `Bearer ${k.private_key}`,
        MerchantId: k.merchant_id,
        Signature: sign(JSON.stringify(body), k.private_key),
        "Content-Type": "application/json",
      },
      timeout: 20000,
    },
  );
  return data;
}

/**
 * Verify an inbound webhook. OPay includes a `sha512` HMAC of the payload
 * (keyed on the secret). Returns true | false | null (not configured).
 */
function verifyWebhookSignature(rawBody, headers = {}, creds) {
  const privateKey = (creds && creds.private_key) || config.OPAY_PRIVATE_KEY;
  if (!privateKey) return null;
  let parsed = {};
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return false;
  }
  const provided =
    parsed.sha512 || parsed.signature || headers["x-opay-signature"] || null;
  if (!provided) return false;
  const { sha512, signature, ...rest } = parsed;
  void sha512;
  void signature;
  const computed = crypto
    .createHmac("sha512", privateKey)
    .update(JSON.stringify(rest.payload ?? rest))
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(String(computed)),
      Buffer.from(String(provided)),
    );
  } catch {
    return false;
  }
}

module.exports = {
  isConfigured,
  initializePayment,
  verifyTransaction,
  verifyWebhookSignature,
};
