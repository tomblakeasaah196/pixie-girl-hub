/**
 * Meta WhatsApp Cloud API client (V2.2 §6.17).
 *
 * All outbound WhatsApp goes through this module. As of 000289 there
 * is NO .env fallback for the phone-number-id or access token — every
 * send resolves the per-brand config from shared.messaging_accounts
 * so the two brands never accidentally use the same number, and no
 * secret ever sits in .env.
 *
 * Callers must supply { brand } on every call. Missing/inactive brand
 * config → throws WA_NOT_CONFIGURED with a message the UI surfaces.
 *
 * Webhook-based: inbound messages arrive at
 * /api/webhooks/meta/whatsapp; outbound goes through here.
 */

"use strict";

const axios = require("axios");
const { config } = require("../config/env");
const { AppError } = require("../utils/errors");

const GRAPH = () => `https://graph.facebook.com/${config.META_GRAPH_VERSION || "v18.0"}`;

// Lazy-required to sidestep a circular init cost during module load —
// messaging_accounts.service requires whatsapp.service transitively.
function resolveSendConfig({ brand }) {
  if (!brand) {
    throw new AppError(
      "BRAND_REQUIRED",
      "WhatsApp send requires a brand context",
      400,
    );
  }
  const svc = require("../modules/messaging_accounts/messaging-accounts.service");
  return svc.resolveWhatsAppSendConfig({ brand });
}

/**
 * Send a free-form text message inside the 24h customer-care window.
 *
 * @param {object} args
 * @param {string} args.brand   — brand key (pixiegirl | faitlynhair)
 * @param {string} args.to      — E.164 phone number, no leading +
 * @param {string} args.body    — text body
 */
async function sendText({ brand, to, body }) {
  const cfg = await resolveSendConfig({ brand });
  const url = `${GRAPH()}/${cfg.phone_number_id}/messages`;
  return axios.post(
    url,
    { messaging_product: "whatsapp", to, type: "text", text: { body } },
    { headers: { Authorization: `Bearer ${cfg.access_token}` }, timeout: 15000 },
  );
}

/**
 * Send an approved template message (works outside the 24h window).
 *
 * @param {object} args
 * @param {string} args.brand
 * @param {string} args.to
 * @param {string} args.template_name
 * @param {string} [args.language_code]  — default 'en'
 * @param {Array}  [args.components]
 */
async function sendTemplate({
  brand,
  to,
  template_name,
  language_code,
  components,
}) {
  const cfg = await resolveSendConfig({ brand });
  const url = `${GRAPH()}/${cfg.phone_number_id}/messages`;
  return axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: template_name,
        language: { code: language_code || "en" },
        components,
      },
    },
    { headers: { Authorization: `Bearer ${cfg.access_token}` }, timeout: 15000 },
  );
}

/**
 * Send an image via a pre-hosted URL. Same brand resolution.
 */
async function sendImage({ brand, to, image_url, caption }) {
  const cfg = await resolveSendConfig({ brand });
  const url = `${GRAPH()}/${cfg.phone_number_id}/messages`;
  return axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: { link: image_url, caption },
    },
    { headers: { Authorization: `Bearer ${cfg.access_token}` }, timeout: 15000 },
  );
}

/**
 * True iff the given brand has an active WhatsApp row on file. Cheap
 * predicate used by delivery services that want to fall back to email
 * silently rather than raise a 412 to the operator.
 */
async function isConfigured({ brand }) {
  if (!brand) return false;
  try {
    await resolveSendConfig({ brand });
    return true;
  } catch {
    return false;
  }
}

module.exports = { sendText, sendTemplate, sendImage, isConfigured };
