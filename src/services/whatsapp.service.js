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
const path = require("path");
const FormData = require("form-data");
const { config } = require("../config/env");
const { AppError } = require("../utils/errors");
const { logger } = require("../config/logger");

const GRAPH = () => `https://graph.facebook.com/${config.META_GRAPH_VERSION || "v18.0"}`;

// Best-effort MIME from a filename/URL/key extension — used when Meta or the
// storage layer doesn't hand us an explicit content-type for an upload.
const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".3gp": "video/3gpp",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".amr": "audio/amr",
};
function mimeFromName(name) {
  if (!name) return null;
  const clean = String(name).split("?")[0];
  return MIME_BY_EXT[path.extname(clean).toLowerCase()] || null;
}

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
 * Send an image. Prefer `media_id` (a handle from uploadMedia() — the
 * reliable path that doesn't require our media host to be publicly
 * reachable); fall back to `image_url` (Meta fetches the link itself,
 * which only works when the URL is internet-reachable without auth).
 */
async function sendImage({ brand, to, image_url, media_id, caption }) {
  const cfg = await resolveSendConfig({ brand });
  const url = `${GRAPH()}/${cfg.phone_number_id}/messages`;
  const image = media_id ? { id: media_id } : { link: image_url };
  if (caption) image.caption = caption;
  return axios.post(
    url,
    { messaging_product: "whatsapp", to, type: "image", image },
    { headers: { Authorization: `Bearer ${cfg.access_token}` }, timeout: 15000 },
  );
}

/**
 * Send a video. `media_id` (upload-first) preferred over `video_url` (link).
 */
async function sendVideo({ brand, to, video_url, media_id, caption }) {
  const cfg = await resolveSendConfig({ brand });
  const url = `${GRAPH()}/${cfg.phone_number_id}/messages`;
  const video = media_id ? { id: media_id } : { link: video_url };
  if (caption) video.caption = caption;
  return axios.post(
    url,
    { messaging_product: "whatsapp", to, type: "video", video },
    { headers: { Authorization: `Bearer ${cfg.access_token}` }, timeout: 15000 },
  );
}

/**
 * Send a document (PDF, etc.). `media_id` (upload-first) preferred over
 * `document_url` (link). Meta needs `filename` to render a sensible name
 * in the customer's client — without it WhatsApp shows a garbled name.
 */
async function sendDocument({ brand, to, document_url, media_id, filename, caption }) {
  const cfg = await resolveSendConfig({ brand });
  const url = `${GRAPH()}/${cfg.phone_number_id}/messages`;
  const document = media_id ? { id: media_id } : { link: document_url };
  if (filename) document.filename = filename;
  if (caption) document.caption = caption;
  return axios.post(
    url,
    { messaging_product: "whatsapp", to, type: "document", document },
    { headers: { Authorization: `Bearer ${cfg.access_token}` }, timeout: 15000 },
  );
}

/**
 * Send a voice note / audio clip. `media_id` (upload-first) preferred
 * over `audio_url` (link). Meta's `audio` type has no caption field —
 * the sound is the whole message.
 */
async function sendAudio({ brand, to, audio_url, media_id }) {
  const cfg = await resolveSendConfig({ brand });
  const url = `${GRAPH()}/${cfg.phone_number_id}/messages`;
  const audio = media_id ? { id: media_id } : { link: audio_url };
  return axios.post(
    url,
    { messaging_product: "whatsapp", to, type: "audio", audio },
    { headers: { Authorization: `Bearer ${cfg.access_token}` }, timeout: 15000 },
  );
}

// ── Media upload / download (Cloud API resumable-less path) ───
//
// The reliable way to send media is to POST the bytes to Meta first,
// receive a media id, then reference that id in the message. This
// removes the "Meta must be able to fetch my URL" dependency that makes
// the link method silently drop images when the media host isn't
// publicly reachable. Inbound media is the mirror image: Meta's webhook
// only carries a media *id*, so we resolve it to a temporary URL and
// download the bytes (both calls token-gated).

/**
 * Upload raw bytes to Meta and return the media id. The id is valid for
 * ~30 days and can be reused across sends, but we treat it as one-shot.
 */
async function uploadMedia({ brand, buffer, mime_type, filename }) {
  const cfg = await resolveSendConfig({ brand });
  const url = `${GRAPH()}/${cfg.phone_number_id}/media`;
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", buffer, {
    filename: filename || "upload",
    contentType: mime_type || "application/octet-stream",
  });
  const { data } = await axios.post(url, form, {
    headers: { Authorization: `Bearer ${cfg.access_token}`, ...form.getHeaders() },
    timeout: 60000,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });
  if (!data || !data.id) {
    throw new AppError("WA_UPLOAD_NO_ID", "Meta media upload returned no id", 502);
  }
  return data.id;
}

/**
 * Resolve an inbound media id to its provider metadata (temporary URL,
 * mime, size, sha256). The returned `url` is short-lived and must be
 * fetched with the same bearer token.
 */
async function getMediaInfo({ brand, media_id }) {
  const cfg = await resolveSendConfig({ brand });
  const { data } = await axios.get(`${GRAPH()}/${media_id}`, {
    headers: { Authorization: `Bearer ${cfg.access_token}` },
    timeout: 15000,
  });
  return data; // { url, mime_type, sha256, file_size, id, messaging_product }
}

/**
 * Download an inbound media id's bytes. Two hops: resolve the id → URL,
 * then GET the URL with the token. Returns { buffer, mime_type, file_size }.
 */
async function downloadMedia({ brand, media_id }) {
  const cfg = await resolveSendConfig({ brand });
  const info = await getMediaInfo({ brand, media_id });
  if (!info || !info.url) {
    throw new AppError("WA_MEDIA_NO_URL", "Meta returned no media URL", 502);
  }
  const resp = await axios.get(info.url, {
    // Meta's lookaside CDN requires the bearer token AND rejects requests
    // without a User-Agent header.
    headers: {
      Authorization: `Bearer ${cfg.access_token}`,
      "User-Agent": "PixieGirlHub/1.0",
    },
    responseType: "arraybuffer",
    timeout: 60000,
    maxContentLength: Infinity,
  });
  return {
    buffer: Buffer.from(resp.data),
    mime_type:
      info.mime_type || resp.headers["content-type"] || "application/octet-stream",
    file_size: info.file_size,
    sha256: info.sha256,
  };
}

/**
 * Load the bytes behind an outbound media reference. Prefers a local
 * storage key (`media_key` — the common case for staff-composed
 * attachments, read straight off disk with no public URL needed); falls
 * back to interpreting `media_url` as a local /media path, or fetching
 * it over HTTP when it's a genuine absolute URL (e.g. a catalogue CDN
 * image in a product share).
 */
async function loadMediaBytes({ media_key, media_url, mime_type }) {
  const storage = require("./storage.service");
  let key = media_key || null;
  if (!key && media_url) {
    if (media_url.startsWith("/media/")) {
      key = media_url.slice("/media/".length);
    } else if (config.CDN_BASE_URL && media_url.startsWith(`${config.CDN_BASE_URL}/`)) {
      key = media_url.slice(config.CDN_BASE_URL.length + 1);
    } else if (config.ADMIN_BASE_URL) {
      const base = `${config.ADMIN_BASE_URL.replace(/\/+$/, "")}/media/`;
      if (media_url.startsWith(base)) key = media_url.slice(base.length);
    }
  }
  if (key) {
    try {
      const buffer = await storage.get(key);
      return { buffer, mime: mime_type || mimeFromName(key) || "application/octet-stream" };
    } catch (err) {
      // A key that isn't on local disk but IS an absolute URL can still be
      // fetched over HTTP below; otherwise re-throw.
      if (!/^https?:\/\//i.test(media_url || "")) throw err;
    }
  }
  if (/^https?:\/\//i.test(media_url || "")) {
    const resp = await axios.get(media_url, {
      responseType: "arraybuffer",
      timeout: 30000,
      maxContentLength: Infinity,
    });
    return {
      buffer: Buffer.from(resp.data),
      mime:
        mime_type ||
        resp.headers["content-type"] ||
        mimeFromName(media_url) ||
        "application/octet-stream",
    };
  }
  throw new AppError(
    "MEDIA_BYTES_UNAVAILABLE",
    "Could not load media bytes for outbound send (no local key and no fetchable URL)",
    422,
  );
}

/**
 * Send a media message the reliable way: load the bytes, upload them to
 * Meta for a media id, then send by id. If the upload can't happen but a
 * publicly-fetchable URL exists, degrade to the link method rather than
 * dropping the media entirely.
 */
async function sendMedia({ brand, to, kind, media_url, media_key, filename, mime_type, caption }) {
  let media_id = null;
  try {
    const { buffer, mime } = await loadMediaBytes({ media_key, media_url, mime_type });
    media_id = await uploadMedia({ brand, buffer, mime_type: mime, filename });
  } catch (err) {
    // Only fall back to the link method when we actually have a URL Meta
    // could fetch; otherwise surface the failure so the job is retried.
    if (!/^https?:\/\//i.test(media_url || "")) throw err;
    logger.warn(
      { err: err.message, brand, kind },
      "whatsapp: media upload failed — falling back to link method",
    );
  }
  switch (kind) {
    case "image":
      return sendImage({ brand, to, media_id, image_url: media_id ? undefined : media_url, caption });
    case "video":
      return sendVideo({ brand, to, media_id, video_url: media_id ? undefined : media_url, caption });
    case "document":
      return sendDocument({
        brand,
        to,
        media_id,
        document_url: media_id ? undefined : media_url,
        filename,
        caption,
      });
    case "audio":
      return sendAudio({ brand, to, media_id, audio_url: media_id ? undefined : media_url });
    default:
      throw new AppError("WA_BAD_MEDIA_KIND", `Unsupported media kind '${kind}'`, 400);
  }
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
  sendMedia,
  uploadMedia,
  getMediaInfo,
  downloadMedia,
  isConfigured,
  // template management (Business Management API):
  listTemplates,
  createTemplate,
  editTemplate,
  deleteTemplate,
};
