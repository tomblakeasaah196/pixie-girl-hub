/**
 * BullMQ processor: whatsapp-send (J-2).
 *
 * Sends one WhatsApp message via the Meta Graph client (services/whatsapp.
 * service). Durable async path for smartcomm / reminders (see H-8): a provider
 * hiccup is retried by BullMQ instead of lost inline.
 *
 * Expected job.data — free-text:
 *   { brand, to, body }
 * or template:
 *   { brand, to, template_name, language_code?, components? }
 *
 * `brand` is REQUIRED as of 000289 — every send resolves the per-brand
 * token from shared.messaging_accounts. A job missing brand fails fast
 * (surfaced to the queue's dead-letter view rather than silently sending
 * from the wrong number).
 *
 * Returns the provider message id. Throws on failure → BullMQ retries.
 */

"use strict";

const whatsapp = require("../../services/whatsapp.service");
const { logger } = require("../../config/logger");

module.exports = async function process(job) {
  const data = job.data || {};
  if (!data.to) {
    logger.warn({ jobId: job.id }, "whatsapp-send: missing 'to' — skipping");
    return { skipped: true };
  }
  if (!data.brand) {
    logger.error(
      { jobId: job.id },
      "whatsapp-send: missing 'brand' — every send needs a brand context",
    );
    throw new Error("WA_SEND_BRAND_REQUIRED");
  }
  const res = data.template_name
    ? await whatsapp.sendTemplate({
        brand: data.brand,
        to: data.to,
        template_name: data.template_name,
        language_code: data.language_code,
        components: data.components,
      })
    : await whatsapp.sendText({
        brand: data.brand,
        to: data.to,
        body: data.body,
      });
  const messageId =
    res && res.data && res.data.messages && res.data.messages[0]
      ? res.data.messages[0].id
      : null;
  // H-8: stamp the provider ref onto the originating smartcomm message.
  if (data.smartcomm_message_id && messageId) {
    try {
      const smartcommRepo = require("../../modules/smartcomm/smartcomm.repo");
      await smartcommRepo.setMessageExternalRef({
        message_id: data.smartcomm_message_id,
        external_ref: String(messageId),
      });
    } catch (e) {
      logger.warn({ e: e.message }, "whatsapp-send: external_ref stamp failed");
    }
  }
  logger.info(
    { jobId: job.id, brand: data.brand, to: data.to, messageId },
    "whatsapp sent",
  );
  return { messageId };
};
