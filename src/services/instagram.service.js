/**
 * Meta Instagram Messenger client (V2.2 §6.17).
 *
 * Inbound DMs arrive at /api/webhooks/meta/instagram and are bridged
 * into Smartcomm by smartcomm.subscribers.onWebhookReceived. Outbound
 * goes through here — Graph API "messages" endpoint on the IG Business
 * Account, scoped by the Facebook Page access token (via the IG Page
 * linkage). Inside the 24-hour customer-care window, free-form
 * replies are allowed; outside it, only HUMAN_AGENT-tagged messages
 * (template-equivalent) are accepted.
 */

"use strict";

const axios = require("axios");
const { config } = require("../config/env");

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Send a text DM to an Instagram user (IGSID).
 *
 * @param {object} args
 * @param {string} args.recipient_id  The IG-scoped user id (IGSID), present
 *                                    in the inbound webhook as sender.id.
 * @param {string} args.text          Body text.
 * @param {string} [args.access_token] Page access token (the Page that owns
 *                                     the IG Business Account). Falls back
 *                                     to env META_IG_ACCESS_TOKEN.
 * @param {string} [args.tag]         'HUMAN_AGENT' to send outside the
 *                                     24-hour window (when approved).
 */
async function sendText({ recipient_id, text, access_token, tag }) {
  const token = access_token || config.META_IG_ACCESS_TOKEN;
  if (!token) {
    const err = new Error("INSTAGRAM_NOT_CONFIGURED");
    err.code = "INSTAGRAM_NOT_CONFIGURED";
    throw err;
  }
  const version = config.META_GRAPH_VERSION || "v21.0";
  const url = `https://graph.facebook.com/${version}/me/messages`;
  const body = {
    recipient: { id: recipient_id },
    message: { text },
    messaging_type: tag ? "MESSAGE_TAG" : "RESPONSE",
  };
  if (tag) body.tag = tag;
  const { data } = await axios.post(url, body, { headers: authHeader(token) });
  return data;
}

/**
 * Send an image to an Instagram user via an already-public URL.
 * Graph API requires a hosted URL — we'll re-host attachments under
 * /media/ at send time.
 */
async function sendImage({ recipient_id, image_url, access_token, tag }) {
  const token = access_token || config.META_IG_ACCESS_TOKEN;
  if (!token) {
    const err = new Error("INSTAGRAM_NOT_CONFIGURED");
    err.code = "INSTAGRAM_NOT_CONFIGURED";
    throw err;
  }
  const version = config.META_GRAPH_VERSION || "v21.0";
  const url = `https://graph.facebook.com/${version}/me/messages`;
  const body = {
    recipient: { id: recipient_id },
    message: {
      attachment: {
        type: "image",
        payload: { url: image_url, is_reusable: false },
      },
    },
    messaging_type: tag ? "MESSAGE_TAG" : "RESPONSE",
  };
  if (tag) body.tag = tag;
  const { data } = await axios.post(url, body, { headers: authHeader(token) });
  return data;
}

function isConfigured() {
  return !!config.META_IG_ACCESS_TOKEN;
}

module.exports = { sendText, sendImage, isConfigured };
