/**
 * Paystack gateway client (V2.2 §5.1, §6.21).
 * Local NGN gateway. Paired with OPay as primary/fallback.
 *
 * Each function accepts an optional `creds` ({ secret_key }) resolved per-brand
 * from payment-gateways.service; when omitted it falls back to the env key, so
 * single-tenant/env setups keep working unchanged.
 */

"use strict";

const axios = require("axios");
const { config } = require("../config/env");

function clientFor(creds) {
  const key = (creds && creds.secret_key) || config.PAYSTACK_SECRET_KEY;
  return axios.create({
    baseURL: "https://api.paystack.co",
    headers: { Authorization: `Bearer ${key}` },
  });
}

function isConfigured(creds) {
  return Boolean((creds && creds.secret_key) || config.PAYSTACK_SECRET_KEY);
}

async function initializeTransaction({
  email,
  amount_kobo,
  reference,
  callback_url,
  metadata,
  creds,
}) {
  const { data } = await clientFor(creds).post("/transaction/initialize", {
    email,
    amount: amount_kobo,
    reference,
    callback_url,
    metadata,
  });
  return data;
}

async function verifyTransaction(reference, creds) {
  const { data } = await clientFor(creds).get(
    `/transaction/verify/${reference}`,
  );
  return data;
}

/**
 * Charge a previously-authorized card off-session (recurring billing, §6.23.5).
 * Amount in kobo. Returns the Paystack response (data.status, data.data).
 */
async function chargeAuthorization({
  authorization_code,
  email,
  amount_kobo,
  reference,
  metadata,
  creds,
}) {
  const { data } = await clientFor(creds).post(
    "/transaction/charge_authorization",
    {
      authorization_code,
      email,
      amount: amount_kobo,
      reference,
      metadata,
    },
  );
  return data;
}

module.exports = {
  isConfigured,
  initializeTransaction,
  verifyTransaction,
  chargeAuthorization,
};
