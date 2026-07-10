/**
 * Meta Instagram Messenger client (V2.2 §6.17).
 *
 * All outbound Instagram messaging (DM text, DM image, HUMAN_AGENT
 * tagged replies outside the 24h window) goes through this module.
 * As of the Instagram integration PR there is NO .env fallback — every
 * send resolves the per-brand config from shared.messaging_accounts
 * so the two brands never accidentally use the same IG Business
 * Account, and no secret ever sits in .env.
 *
 * Callers must supply { brand } on every call. Missing/inactive brand
 * config → throws IG_NOT_CONFIGURED with a message the UI surfaces.
 *
 * Inbound DMs, story mentions and story replies arrive at
 * /api/webhooks/meta/instagram and are bridged into Smartcomm by
 * smartcomm.subscribers.onWebhookReceived.
 */

"use strict";

const axios = require("axios");
const { config } = require("../config/env");
const { AppError } = require("../utils/errors");

// "Instagram API with Instagram Login" (V2.2 §6.17): outbound DMs go to
// graph.instagram.com with the brand's IG user token (IGAA…). This is NOT
// graph.facebook.com — a Facebook Page token / the old Messenger-API-for-
// Instagram host is a different family and would 401 here.
const GRAPH = () => `https://graph.instagram.com/${config.META_GRAPH_VERSION || "v21.0"}`;

// Lazy-required to sidestep a circular init cost during module load —
// messaging_accounts.service requires this file transitively.
function resolveSendConfig({ brand }) {
  if (!brand) {
    throw new AppError(
      "BRAND_REQUIRED",
      "Instagram send requires a brand context",
      400,
    );
  }
  const svc = require("../modules/messaging_accounts/messaging-accounts.service");
  return svc.resolveInstagramSendConfig({ brand });
}

/**
 * Send a text DM to an Instagram user (IGSID).
 *
 * @param {object} args
 * @param {string} args.brand         — brand key (pixiegirl | faitlynhair)
 * @param {string} args.recipient_id  — IG-scoped user id (IGSID), from
 *                                      the inbound webhook's sender.id
 * @param {string} args.text          — body text
 * @param {string} [args.tag]         — 'HUMAN_AGENT' to send outside the
 *                                      24-hour window (must be approved
 *                                      on the Meta app)
 */
async function sendText({ brand, recipient_id, text, tag }) {
  const cfg = await resolveSendConfig({ brand });
  const url = `${GRAPH()}/me/messages`;
  // Standard replies (inside the 24h window) send the minimal documented
  // body. messaging_type/tag are only attached for a HUMAN_AGENT-style send
  // outside the window, so we don't ship an unexpected field on a normal DM.
  const body = {
    recipient: { id: recipient_id },
    message: { text },
  };
  if (tag) {
    body.messaging_type = "MESSAGE_TAG";
    body.tag = tag;
  }
  const { data } = await axios.post(url, body, {
    headers: { Authorization: `Bearer ${cfg.access_token}` },
    timeout: 15000,
  });
  return data;
}

/**
 * Send an image to an Instagram user via an already-public URL.
 * Graph API requires a hosted URL — we'll re-host attachments under
 * /media/ at send time.
 */
async function sendImage({ brand, recipient_id, image_url, tag }) {
  const cfg = await resolveSendConfig({ brand });
  const url = `${GRAPH()}/me/messages`;
  const body = {
    recipient: { id: recipient_id },
    message: {
      attachment: {
        type: "image",
        payload: { url: image_url, is_reusable: false },
      },
    },
  };
  if (tag) {
    body.messaging_type = "MESSAGE_TAG";
    body.tag = tag;
  }
  const { data } = await axios.post(url, body, {
    headers: { Authorization: `Bearer ${cfg.access_token}` },
    timeout: 15000,
  });
  return data;
}

/**
 * True iff the given brand has an active IG row on file. Cheap
 * predicate for delivery services that want to skip / fall back
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

module.exports = { sendText, sendImage, isConfigured };
