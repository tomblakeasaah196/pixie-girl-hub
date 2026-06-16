/**
 * BullMQ processor: instagram-send (J-2).
 *
 * Sends one Instagram Messenger DM via services/instagram.service. Durable
 * async path for smartcomm: provider 5xx/rate limits retry instead of
 * losing the message inline.
 *
 * Expected job.data:
 *   { recipient_id, text }                               — free-form (in 24-hr window)
 *   { recipient_id, text, tag: 'HUMAN_AGENT' }           — outside-window
 *   { recipient_id, image_url }                          — image attachment
 *
 * The processor stamps the provider mid back onto the smartcomm row
 * and flips delivery_status from queued → sent.
 */

"use strict";

const instagram = require("../../services/instagram.service");
const repo = require("../../modules/smartcomm/smartcomm.repo");
const { logger } = require("../../config/logger");

module.exports = async function process(job) {
  const data = job.data || {};
  if (!data.recipient_id) {
    logger.warn(
      { jobId: job.id },
      "instagram-send: missing recipient_id — skipping",
    );
    return { skipped: true };
  }
  if (!instagram.isConfigured()) {
    logger.warn(
      { jobId: job.id },
      "instagram-send: META_IG_ACCESS_TOKEN not set — skipping",
    );
    if (data.smartcomm_message_id) {
      await repo.setMessageDelivery({
        message_id: data.smartcomm_message_id,
        delivery_status: "failed",
        delivery_error: "INSTAGRAM_NOT_CONFIGURED",
      });
    }
    return { skipped: true };
  }
  try {
    const res = data.image_url
      ? await instagram.sendImage({
          recipient_id: data.recipient_id,
          image_url: data.image_url,
          tag: data.tag,
        })
      : await instagram.sendText({
          recipient_id: data.recipient_id,
          text: data.text,
          tag: data.tag,
        });
    const mid = res && (res.message_id || res.recipient_id);
    if (data.smartcomm_message_id) {
      await repo.setMessageDelivery({
        message_id: data.smartcomm_message_id,
        delivery_status: "sent",
        external_ref: mid ? String(mid) : null,
      });
    }
    logger.info(
      { jobId: job.id, recipient: data.recipient_id, mid },
      "instagram sent",
    );
    return { mid };
  } catch (err) {
    if (data.smartcomm_message_id) {
      await repo.setMessageDelivery({
        message_id: data.smartcomm_message_id,
        delivery_status: "failed",
        delivery_error: String(err.message || err).slice(0, 1000),
      });
    }
    throw err;
  }
};
