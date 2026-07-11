/**
 * BullMQ processor: instagram-send (J-2).
 *
 * Sends one Instagram Messenger DM via services/instagram.service. Durable
 * async path for smartcomm: provider 5xx/rate limits retry instead of
 * losing the message inline.
 *
 * Expected job.data:
 *   { brand, recipient_id, text }                          — free-form (in 24h window)
 *   { brand, recipient_id, text, tag: 'HUMAN_AGENT' }      — outside-window
 *   { brand, recipient_id, image_url }                     — image (legacy shape)
 *   { brand, recipient_id, media_kind, media_url }         — image|audio|video
 *
 * `brand` is REQUIRED — every send resolves the per-brand IG token
 * from shared.messaging_accounts. A job missing brand fails fast
 * (surfaced to the queue's dead-letter view rather than silently
 * sending from the wrong account).
 *
 * The processor stamps the provider mid back onto the smartcomm row
 * and flips delivery_status from queued → sent.
 */

"use strict";

const instagram = require("../../services/instagram.service");
const { logger } = require("../../config/logger");

// Delivery outcomes route through the service (not the repo) so the
// status change also emits message.edited — the operator's open thread
// flips the tick/error icon live instead of on the next poll.
function smartcomm() {
  return require("../../modules/smartcomm/smartcomm.service");
}

module.exports = async function process(job) {
  const data = job.data || {};
  if (!data.recipient_id) {
    logger.warn(
      { jobId: job.id },
      "instagram-send: missing recipient_id — skipping",
    );
    return { skipped: true };
  }
  if (!data.brand) {
    logger.error(
      { jobId: job.id },
      "instagram-send: missing 'brand' — every send needs a brand context",
    );
    if (data.smartcomm_message_id) {
      await smartcomm().applyDeliveryResult({
        message_id: data.smartcomm_message_id,
        delivery_status: "failed",
        delivery_error: "IG_SEND_BRAND_REQUIRED",
      });
    }
    throw new Error("IG_SEND_BRAND_REQUIRED");
  }
  if (!(await instagram.isConfigured({ brand: data.brand }))) {
    logger.warn(
      { jobId: job.id, brand: data.brand },
      "instagram-send: brand has no IG config on file — skipping",
    );
    if (data.smartcomm_message_id) {
      await smartcomm().applyDeliveryResult({
        message_id: data.smartcomm_message_id,
        delivery_status: "failed",
        delivery_error: "IG_NOT_CONFIGURED",
      });
    }
    return { skipped: true };
  }
  try {
    let res;
    if (data.media_url) {
      res = await instagram.sendMedia({
        brand: data.brand,
        recipient_id: data.recipient_id,
        kind: data.media_kind || "image",
        media_url: data.media_url,
        tag: data.tag,
      });
    } else if (data.image_url) {
      // Legacy job shape (pre media_kind) — jobs already queued keep working.
      res = await instagram.sendImage({
        brand: data.brand,
        recipient_id: data.recipient_id,
        image_url: data.image_url,
        tag: data.tag,
      });
    } else {
      res = await instagram.sendText({
        brand: data.brand,
        recipient_id: data.recipient_id,
        text: data.text,
        tag: data.tag,
      });
    }
    const mid = res && (res.message_id || res.recipient_id);
    if (data.smartcomm_message_id) {
      await smartcomm().applyDeliveryResult({
        message_id: data.smartcomm_message_id,
        delivery_status: "sent",
        external_ref: mid ? String(mid) : null,
      });
    }
    logger.info(
      { jobId: job.id, brand: data.brand, recipient: data.recipient_id, mid },
      "instagram sent",
    );
    return { mid };
  } catch (err) {
    // instagram.service already unwrapped Meta's structured error, so
    // err.message names the real cause ("Invalid OAuth access token",
    // "(#10) … outside of allowed window", …) — that's what the operator
    // sees on the failed bubble.
    if (data.smartcomm_message_id) {
      await smartcomm().applyDeliveryResult({
        message_id: data.smartcomm_message_id,
        delivery_status: "failed",
        delivery_error: String(err.message || err).slice(0, 1000),
      });
    }
    throw err;
  }
};
