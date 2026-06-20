/**
 * BullMQ processor: email-send (J-2).
 *
 * Sends one email via the SMTP transport (services/email.service). This is the
 * durable async path that smartcomm / campaigns / retention enqueue onto so a
 * provider hiccup is retried by BullMQ instead of lost inline (see H-8).
 *
 * Expected job.data:
 *   { to, subject, html?, text?, from_email?, from_name?, headers? }
 *
 * Returns the provider messageId so completion can stamp an external_ref.
 * Throws on failure → BullMQ retries with its configured backoff.
 */

"use strict";

const email = require("../../services/email.service");
const commsLog = require("../../services/comms-log.service");
const { logger } = require("../../config/logger");

module.exports = async function process(job) {
  const { to, subject } = job.data || {};
  if (!to || !subject) {
    logger.warn({ jobId: job.id }, "email-send: missing to/subject — skipping");
    return { skipped: true };
  }

  let info;
  try {
    info = await email.send(job.data);
  } catch (err) {
    await commsLog.record({
      business: job.data.brand,
      contact_id: job.data.contact_id,
      channel: "email",
      event_key: job.data.event_key,
      recipient: to,
      subject,
      status: "failed",
      error: err.message,
    });
    throw err;
  }

  const messageId = info && info.messageId;
  // H-8: stamp the provider ref onto the originating smartcomm message.
  if (job.data.smartcomm_message_id && messageId) {
    try {
      const smartcommRepo = require("../../modules/smartcomm/smartcomm.repo");
      await smartcommRepo.setMessageExternalRef({
        message_id: job.data.smartcomm_message_id,
        external_ref: String(messageId),
      });
    } catch (e) {
      logger.warn({ e: e.message }, "email-send: external_ref stamp failed");
    }
  }
  await commsLog.record({
    business: job.data.brand,
    contact_id: job.data.contact_id,
    channel: "email",
    event_key: job.data.event_key,
    recipient: to,
    subject,
    status: "sent",
    provider_ref: messageId,
  });
  logger.info({ jobId: job.id, to, messageId }, "email sent");
  return { messageId };
};
