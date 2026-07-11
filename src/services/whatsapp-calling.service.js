/**
 * Meta WhatsApp Business Calling API client (Cloud API Calling, V2.2 §6.17).
 *
 * Voice-call signalling companion to whatsapp.service.js. All call-control
 * actions (accept / pre-accept / reject / terminate) and the per-number
 * calling settings go through here. Media itself never touches the backend:
 * Meta's `connect` webhook delivers an SDP offer, the answering agent's
 * browser produces an SDP answer over WebRTC, and this module only relays
 * that answer to the Graph API — audio then flows browser ⇄ Meta directly.
 *
 * Per-brand config comes from shared.messaging_accounts exactly like
 * message sends (no .env fallback, so the two brands can never cross).
 *
 * Calling requires a newer Graph version than the message paths are pinned
 * to, hence META_GRAPH_VERSION_CALLING (default v23.0).
 */

"use strict";

const axios = require("axios");
const { config } = require("../config/env");
const { AppError } = require("../utils/errors");

const GRAPH = () =>
  `https://graph.facebook.com/${config.META_GRAPH_VERSION_CALLING || "v23.0"}`;

function resolveSendConfig({ brand }) {
  if (!brand) {
    throw new AppError("BRAND_REQUIRED", "WhatsApp calling requires a brand context", 400);
  }
  const svc = require("../modules/messaging_accounts/messaging-accounts.service");
  return svc.resolveWhatsAppSendConfig({ brand });
}

/** Surface Meta's human-facing error message on a failed calling request. */
function callingError(err, fallback) {
  if (err instanceof AppError) return err;
  const apiErr = err.response && err.response.data && err.response.data.error;
  const status = err.response && err.response.status;
  const msg =
    (apiErr && (apiErr.error_user_msg || apiErr.message)) || err.message || fallback;
  return new AppError(
    "WA_CALLING_API_ERROR",
    msg,
    status && status >= 400 && status < 500 ? status : 502,
  );
}

/**
 * Drive a call action on the /calls edge. `session` (sdp answer) is
 * required for pre_accept/accept, absent for reject/terminate.
 */
async function callAction({ brand, call_id, action, sdp }) {
  const cfg = await resolveSendConfig({ brand });
  const body = { messaging_product: "whatsapp", call_id, action };
  if (sdp) body.session = { sdp_type: "answer", sdp };
  try {
    const { data } = await axios.post(`${GRAPH()}/${cfg.phone_number_id}/calls`, body, {
      headers: { Authorization: `Bearer ${cfg.access_token}` },
      timeout: 15000,
    });
    return data;
  } catch (err) {
    throw callingError(err, `Meta rejected the '${action}' call action`);
  }
}

/**
 * Optional warm-up: lets Meta start media setup before the final accept so
 * the first seconds of audio aren't clipped. Same SDP answer as accept().
 */
function preAccept({ brand, call_id, sdp }) {
  return callAction({ brand, call_id, action: "pre_accept", sdp });
}

/** Answer the call with the browser's SDP answer. */
function accept({ brand, call_id, sdp }) {
  return callAction({ brand, call_id, action: "accept", sdp });
}

/** Decline a ringing call. */
function reject({ brand, call_id }) {
  return callAction({ brand, call_id, action: "reject" });
}

/** Hang up an in-progress call. */
function terminate({ brand, call_id }) {
  return callAction({ brand, call_id, action: "terminate" });
}

// ── Per-number calling settings ───────────────────────────────
//
// Calling is opt-in per phone number: the number must have calling ENABLED
// in its settings before Meta shows the call icon in the chat. The Hub
// exposes this as a toggle under Messaging Accounts so the CEO can switch
// each brand's number on without touching WhatsApp Manager.

/** Read the number's calling settings ({ calling: { status, … } }). */
async function getCallingSettings({ brand }) {
  const cfg = await resolveSendConfig({ brand });
  try {
    const { data } = await axios.get(`${GRAPH()}/${cfg.phone_number_id}/settings`, {
      headers: { Authorization: `Bearer ${cfg.access_token}` },
      timeout: 15000,
    });
    return (data && data.calling) || { status: "DISABLED" };
  } catch (err) {
    throw callingError(err, "Could not read the number's calling settings");
  }
}

/**
 * Enable/disable calling on the number. `icon_visibility` controls whether
 * WhatsApp shows the call button in the chat header (DEFAULT) or only
 * surfaces calling through deep links (DISABLE_ALL).
 */
async function updateCallingSettings({ brand, enabled, icon_visibility }) {
  const cfg = await resolveSendConfig({ brand });
  const calling = { status: enabled ? "ENABLED" : "DISABLED" };
  if (enabled) calling.call_icon_visibility = icon_visibility || "DEFAULT";
  try {
    const { data } = await axios.post(
      `${GRAPH()}/${cfg.phone_number_id}/settings`,
      { calling },
      { headers: { Authorization: `Bearer ${cfg.access_token}` }, timeout: 20000 },
    );
    return data;
  } catch (err) {
    throw callingError(err, "Meta rejected the calling settings update");
  }
}

/** STUN servers for the answering browser's RTCPeerConnection. */
function getIceServers() {
  return String(config.WEBRTC_STUN_URLS || "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean)
    .map((urls) => ({ urls }));
}

module.exports = {
  preAccept,
  accept,
  reject,
  terminate,
  getCallingSettings,
  updateCallingSettings,
  getIceServers,
};
