/**
 * BullMQ processor: whatsapp-send (J-2).
 *
 * Sends one WhatsApp message via the Meta Graph client (services/whatsapp.
 * service). Durable async path for smartcomm / reminders (see H-8): a provider
 * hiccup is retried by BullMQ instead of lost inline.
 *
 * Expected job.data — free-text:
 *   { brand, to, kind: 'text', body }
 * or template:
 *   { brand, to, template_name, language_code?, components? }
 * or media (image/video/document/audio — smartcomm attachments):
 *   { brand, to, kind: 'image'|'video'|'document'|'audio',
 *     media_key?, media_url?, mime_type?, filename?, caption? }
 *   media_key is the local storage key (preferred — bytes are uploaded to
 *   Meta for a media id); media_url is a URL fallback (catalogue images).
 *
 * `brand` is REQUIRED as of 000289 — every send resolves the per-brand
 * token from shared.messaging_accounts. A job missing brand fails fast
 * (surfaced to the queue's dead-letter view rather than silently sending
 * from the wrong number).
 *
 * The processor stamps the provider mid + flips delivery_status from
 * queued → sent the instant Meta accepts the send; the later
 * delivered/read/failed transitions arrive asynchronously via the
 * WhatsApp webhook's `statuses[]` array (see smartcomm.subscribers).
 *
 * Returns the provider message id. Throws on failure → BullMQ retries.
 */

"use strict";

const whatsapp = require("../../services/whatsapp.service");
const { logger } = require("../../config/logger");

module.exports = async function process(job) {
  const data = job.data || {};
  const smartcommRepo = require("../../modules/smartcomm/smartcomm.repo");

  async function markDelivery(patch) {
    if (!data.smartcomm_message_id) return;
    try {
      await smartcommRepo.setMessageDelivery({
        message_id: data.smartcomm_message_id,
        ...patch,
      });
    } catch (e) {
      logger.warn({ e: e.message }, "whatsapp-send: delivery-status stamp failed");
    }
  }

  if (!data.to) {
    logger.warn({ jobId: job.id }, "whatsapp-send: missing 'to' — skipping");
    await markDelivery({ delivery_status: "failed", delivery_error: "NO_RECIPIENT" });
    return { skipped: true };
  }
  if (!data.brand) {
    logger.error(
      { jobId: job.id },
      "whatsapp-send: missing 'brand' — every send needs a brand context",
    );
    await markDelivery({
      delivery_status: "failed",
      delivery_error: "WA_SEND_BRAND_REQUIRED",
    });
    throw new Error("WA_SEND_BRAND_REQUIRED");
  }

  try {
    let res;
    if (data.template_name) {
      res = await whatsapp.sendTemplate({
        brand: data.brand,
        to: data.to,
        template_name: data.template_name,
        language_code: data.language_code,
        components: data.components,
      });
    } else if (
      data.kind === "image" ||
      data.kind === "video" ||
      data.kind === "document" ||
      data.kind === "audio"
    ) {
      // Upload-first: sendMedia loads the bytes (local storage key when
      // present, else the URL) and hands Meta a media id so the send
      // doesn't depend on our media host being publicly reachable.
      res = await whatsapp.sendMedia({
        brand: data.brand,
        to: data.to,
        kind: data.kind,
        media_url: data.media_url,
        media_key: data.media_key,
        filename: data.filename,
        mime_type: data.mime_type,
        caption: data.caption,
      });
    } else {
      res = await whatsapp.sendText({
        brand: data.brand,
        to: data.to,
        body: data.body,
      });
    }
    const messageId =
      res && res.data && res.data.messages && res.data.messages[0]
        ? res.data.messages[0].id
        : null;
    await markDelivery({
      delivery_status: "sent",
      external_ref: messageId ? String(messageId) : null,
    });
    logger.info(
      { jobId: job.id, brand: data.brand, to: data.to, messageId },
      "whatsapp sent",
    );
    return { messageId };
  } catch (err) {
    await markDelivery({
      delivery_status: "failed",
      delivery_error: String(err.message || err).slice(0, 1000),
    });
    throw err;
  }
};
