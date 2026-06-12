/**
 * BullMQ processor: whatsapp-send (J-2).
 *
 * Sends one WhatsApp message via the Meta Graph client (services/whatsapp.
 * service). Durable async path for smartcomm / reminders (see H-8): a provider
 * hiccup is retried by BullMQ instead of lost inline.
 *
 * Expected job.data — free-text:
 *   { to, body }
 * or template:
 *   { to, template_name, language_code?, components? }
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
  const res = data.template_name
    ? await whatsapp.sendTemplate(data)
    : await whatsapp.sendText({ to: data.to, body: data.body });
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
  logger.info({ jobId: job.id, to: data.to, messageId }, "whatsapp sent");
  return { messageId };
};
