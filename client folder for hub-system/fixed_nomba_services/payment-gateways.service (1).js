/**
 * Per-brand payment gateway credential resolver.
 *
 * For gateways that support multiple accounts per brand (Nomba, Stripe, …),
 * this module reads the brand's configured credentials from `shared.business_config`
 * (column `payment_gateways`) and returns the correct { client_id, client_secret,
 * account_id, webhook_signature_key } object for the requested provider.
 *
 * If no per-brand config exists, falls back to the global env vars.
 *
 * `webhook_signature_key` is the separate secret you set in the Nomba dashboard
 * under Developer → Webhook Setup. It is NOT the same as client_secret.
 */

"use strict";

const { config } = require("../../config/env");
const { query } = require("../../config/database");
const { logger } = require("../../config/logger");

const PROVIDERS = ["nomba", "stripe", "paystack", "opay"];

/**
 * Resolve credentials for a given brand + provider.
 *
 * @param {{ brand: string, provider: string }} opts
 * @returns {object|null} creds – { client_id, client_secret, account_id,
 *                              webhook_signature_key } or null if not configured
 */
async function resolveCredentials({ brand, provider }) {
  if (!brand || !provider) return null;

  // 1. Try per-brand config first (shared.business_config.payment_gateways)
  try {
    const { rows } = await query(
      `SELECT payment_gateways FROM shared.business_config WHERE business_key = $1`,
      [brand],
    );
    const gateways = (rows[0] && rows[0].payment_gateways) || {};
    const gw = gateways[provider];
    if (gw && gw.enabled && gw.client_id) {
      return {
        client_id:              gw.client_id,
        client_secret:          gw.client_secret || null,
        account_id:             gw.account_id  || null,
        webhook_signature_key:  gw.webhook_signature_key || null,
      };
    }
  } catch (err) {
    logger.warn(
      { brand, provider, err: err.message },
      "per-brand gateway config read failed; falling back to env vars",
    );
  }

  // 2. Fallback: global env vars
  if (provider === "nomba") {
    if (!config.NOMBA_CLIENT_ID) return null;
    return {
      client_id:             config.NOMBA_CLIENT_ID,
      client_secret:         config.NOMBA_API_KEY || null,
      account_id:            config.NOMBA_ACCOUNT_ID || null,
      webhook_signature_key: config.NOMBA_WEBHOOK_SIG_KEY || null,
    };
  }

  // Add other providers here as needed…
  return null;
}

/**
 * Return the webhook signature key for a brand (used directly by verifyNomba
 * without doing a DB lookup per request — call this at startup or cache it).
 */
async function getWebhookSigKey(brand) {
  const creds = await resolveCredentials({ brand, provider: "nomba" });
  return creds && creds.webhook_signature_key ? creds.webhook_signature_key : null;
}

module.exports = {
  resolveCredentials,
  getWebhookSigKey,
};
