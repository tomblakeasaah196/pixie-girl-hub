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
 * Send a video via a pre-hosted URL.
 */
async function sendVideo({ brand, to, video_url, caption }) {
  const cfg = await resolveSendConfig({ brand });
  const url = `${GRAPH()}/${cfg.phone_number_id}/messages`;
  return axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "video",
      video: { link: video_url, caption },
    },
    { headers: { Authorization: `Bearer ${cfg.access_token}` }, timeout: 15000 },
  );
}

/**
 * Send a document (PDF, etc.) via a pre-hosted URL. Meta requires the
 * `filename` field to render a sensible name in the customer's client —
 * without it WhatsApp shows a generic/garbled name.
 */
async function sendDocument({ brand, to, document_url, filename, caption }) {
  const cfg = await resolveSendConfig({ brand });
  const url = `${GRAPH()}/${cfg.phone_number_id}/messages`;
  return axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: { link: document_url, filename, caption },
    },
    { headers: { Authorization: `Bearer ${cfg.access_token}` }, timeout: 15000 },
  );
}

/**
 * Send a voice note / audio clip via a pre-hosted URL. Meta's `audio`
 * type has no caption field — the sound is the whole message.
 */
async function sendAudio({ brand, to, audio_url }) {
  const cfg = await resolveSendConfig({ brand });
  const url = `${GRAPH()}/${cfg.phone_number_id}/messages`;
  return axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "audio",
      audio: { link: audio_url },
    },
    { headers: { Authorization: `Bearer ${cfg.access_token}` }, timeout: 15000 },
  );
}

// ── Message-template management (Meta Business Management API) ──
//
// These operate on the WhatsApp Business Account (WABA) node, not the
// phone-number node, so they need the business_account_id resolved
// alongside the access token. resolveSendConfig() already returns it.

function requireWaba(cfg) {
  if (!cfg.business_account_id) {
    throw new AppError(
      "WA_NO_BUSINESS_ACCOUNT",
      "No WhatsApp Business Account ID on file for this brand. Add it under Messaging Accounts before managing templates.",
      412,
    );
  }
  return cfg.business_account_id;
}

/**
 * List the brand's message templates from Meta. Returns the raw
 * `data` array of template objects (name, status, category, language,
 * components, quality_score, id).
 */
async function listTemplates({ brand, limit }) {
  const cfg = await resolveSendConfig({ brand });
  const waba = requireWaba(cfg);
  const fields =
    "name,status,category,language,components,quality_score,id,rejected_reason";
  const url = `${GRAPH()}/${waba}/message_templates?fields=${fields}&limit=${limit || 100}`;
  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${cfg.access_token}` },
    timeout: 20000,
  });
  return (data && data.data) || [];
}

/**
 * Submit a NEW template to Meta for review. Meta returns { id, status,
 * category }. Throws the provider's error message straight through so
 * the UI can show "invalid component" etc.
 */
async function createTemplate({ brand, name, language, category, components }) {
  const cfg = await resolveSendConfig({ brand });
  const waba = requireWaba(cfg);
  const url = `${GRAPH()}/${waba}/message_templates`;
  const { data } = await axios.post(
    url,
    { name, language, category, components },
    { headers: { Authorization: `Bearer ${cfg.access_token}` }, timeout: 20000 },
  );
  return data;
}

/**
 * Edit an EXISTING approved/rejected template. Meta only allows the
 * category and components to change, and the edit is addressed by the
 * template's own id (not the WABA node).
 */
async function editTemplate({ brand, meta_template_id, category, components }) {
  const cfg = await resolveSendConfig({ brand });
  const url = `${GRAPH()}/${meta_template_id}`;
  const body = { components };
  if (category) body.category = category;
  const { data } = await axios.post(url, body, {
    headers: { Authorization: `Bearer ${cfg.access_token}` },
    timeout: 20000,
  });
  return data;
}

/**
 * Delete a template on Meta. Deleting by name removes every language
 * variant; passing hsm_id (the template id) scopes it to one. We pass
 * both when we have them.
 */
async function deleteTemplate({ brand, name, meta_template_id }) {
  const cfg = await resolveSendConfig({ brand });
  const waba = requireWaba(cfg);
  let qs = `name=${encodeURIComponent(name)}`;
  if (meta_template_id) qs += `&hsm_id=${encodeURIComponent(meta_template_id)}`;
  const url = `${GRAPH()}/${waba}/message_templates?${qs}`;
  const { data } = await axios.delete(url, {
    headers: { Authorization: `Bearer ${cfg.access_token}` },
    timeout: 20000,
  });
  return data;
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

module.exports = {
  sendText,
  sendTemplate,
  sendImage,
  sendVideo,
  sendDocument,
  sendAudio,
  isConfigured,
  // template management (Business Management API):
  listTemplates,
  createTemplate,
  editTemplate,
  deleteTemplate,
};
