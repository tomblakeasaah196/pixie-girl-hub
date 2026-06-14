/**
 * SMS client (Twilio). Env-driven and OFF by default — mirrors the other
 * external integrations (FX, embeddings): when no credentials are configured,
 * `send()` returns { skipped: true } so callers can degrade gracefully rather
 * than throw. WhatsApp (Meta) remains the primary channel; SMS is a fallback
 * used by retention workflows.
 *
 *   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM
 */

"use strict";

const { config } = require("../config/env");
const { logger } = require("../config/logger");

function isConfigured() {
  return Boolean(
    config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && config.TWILIO_FROM,
  );
}

/**
 * Send one SMS. Returns { skipped:true } when unconfigured, else { sid }.
 * @param {{to:string, body:string}} args
 */
async function send({ to, body }) {
  if (!isConfigured()) {
    logger.warn("sms.send skipped — Twilio not configured");
    return { skipped: true };
  }
  if (!to) return { skipped: true };
  // Lazy require so the SDK only loads when SMS is actually used.
  const twilio = require("twilio")(
    config.TWILIO_ACCOUNT_SID,
    config.TWILIO_AUTH_TOKEN,
  );
  const res = await twilio.messages.create({
    from: config.TWILIO_FROM,
    to,
    body: body || "",
  });
  return { sid: res.sid };
}

module.exports = { isConfigured, send };
