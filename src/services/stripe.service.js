/**
 * Stripe gateway client (V2.2 §5.1) — international card payments.
 *
 * Wraps the official `stripe` SDK (already a dependency):
 *   - createCheckoutSession: a hosted-checkout redirect for an order.
 *   - retrieveSession / retrievePaymentIntent: server-side status.
 *   - constructWebhookEvent: signature-verified event from the raw body +
 *     `stripe-signature` header (STRIPE_WEBHOOK_SECRET).
 *
 * Env-gated: lazily instantiated; calls throw a clean 503 until
 * STRIPE_SECRET_KEY is set. Amounts are in the currency's minor unit.
 */

"use strict";

const { config } = require("../config/env");
const { AppError } = require("../utils/errors");

// Per-secret-key Stripe instances (env key or a per-brand resolved key).
const instances = new Map();

function secretKey(creds) {
  return (creds && creds.secret_key) || config.STRIPE_SECRET_KEY;
}
function isConfigured(creds) {
  return Boolean(secretKey(creds));
}
function client(creds) {
  const key = secretKey(creds);
  if (!key)
    throw new AppError(
      "STRIPE_NOT_CONFIGURED",
      "Stripe key is not configured",
      503,
    );
  if (!instances.has(key)) {
    const Stripe = require("stripe");
    instances.set(key, Stripe(key));
  }
  return instances.get(key);
}

/**
 * Hosted Checkout Session for an order. `amount_minor` in the currency's
 * smallest unit. metadata MUST carry brand + order_id for webhook resolution.
 */
async function createCheckoutSession({
  reference,
  amount_minor,
  currency = "usd",
  email,
  success_url,
  cancel_url,
  product_name = "Order payment",
  metadata = {},
  creds,
}) {
  return client(creds).checkout.sessions.create({
    mode: "payment",
    client_reference_id: reference,
    customer_email: email,
    success_url,
    cancel_url,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency,
          unit_amount: Number(amount_minor),
          product_data: { name: product_name },
        },
      },
    ],
    payment_intent_data: { metadata },
    metadata,
  });
}

async function retrieveSession(sessionId, creds) {
  return client(creds).checkout.sessions.retrieve(sessionId, {
    expand: ["payment_intent"],
  });
}

async function retrievePaymentIntent(paymentIntentId, creds) {
  return client(creds).paymentIntents.retrieve(paymentIntentId);
}

/**
 * Verify + parse a webhook. Returns the Stripe.Event, or throws on bad
 * signature. `rawBody` must be the exact bytes; `signature` is the
 * `stripe-signature` header. `creds.webhook_secret` overrides the env secret.
 */
function constructWebhookEvent(rawBody, signature, creds) {
  const webhookSecret =
    (creds && creds.webhook_secret) || config.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret)
    throw new AppError(
      "STRIPE_WEBHOOK_NOT_CONFIGURED",
      "STRIPE_WEBHOOK_SECRET is not set",
      503,
    );
  return client(creds).webhooks.constructEvent(
    rawBody,
    signature,
    webhookSecret,
  );
}

module.exports = {
  isConfigured,
  createCheckoutSession,
  retrieveSession,
  retrievePaymentIntent,
  constructWebhookEvent,
};
