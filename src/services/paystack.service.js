/**
 * Paystack gateway client (V2.2 §5.1, §6.21).
 * Local NGN gateway. Paired with Opay as primary/fallback.
 */

"use strict";

const axios = require("axios");
const { config } = require("../config/env");

const client = axios.create({
  baseURL: "https://api.paystack.co",
  headers: { Authorization: `Bearer ${config.PAYSTACK_SECRET_KEY}` },
});

async function initializeTransaction({
  email,
  amount_kobo,
  reference,
  callback_url,
  metadata,
}) {
  const { data } = await client.post("/transaction/initialize", {
    email,
    amount: amount_kobo,
    reference,
    callback_url,
    metadata,
  });
  return data;
}

async function verifyTransaction(reference) {
  const { data } = await client.get(`/transaction/verify/${reference}`);
  return data;
}

/**
 * Charge a previously-authorized card off-session (recurring billing, §6.23.5).
 * `authorization_code` comes from a prior successful charge on the customer's
 * card. Amount in kobo. Returns the Paystack response (data.status, data.data).
 */
async function chargeAuthorization({
  authorization_code,
  email,
  amount_kobo,
  reference,
  metadata,
}) {
  const { data } = await client.post("/transaction/charge_authorization", {
    authorization_code,
    email,
    amount: amount_kobo,
    reference,
    metadata,
  });
  return data;
}

module.exports = {
  initializeTransaction,
  verifyTransaction,
  chargeAuthorization,
};
