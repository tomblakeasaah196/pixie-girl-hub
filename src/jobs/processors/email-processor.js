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
const smartcommEvents = require("../../modules/smartcomm/smartcomm.events");

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
    // Flip the originating smartcomm message queued → failed so the thread
    // stops showing it "stuck in queue". Mirrors the whatsapp/instagram
    // processors, which stamp delivery on both success and failure.
    if (job.data.smartcomm_message_id) {
      try {
        const smartcommRepo = require("../../modules/smartcomm/smartcomm.repo");
        const updated = await smartcommRepo.setMessageDelivery({
          message_id: job.data.smartcomm_message_id,
          delivery_status: "failed",
          delivery_error: err.message,
        });
        if (updated) {
          smartcommEvents.emit("message.edited", {
            channel_id: updated.channel_id,
            message_id: job.data.smartcomm_message_id,
          });
        }
      } catch (e) {
        logger.warn({ e: e.message }, "email-send: delivery stamp (failed) failed");
      }
    }
    await commsLog.record({
      business: job.data.brand,
      contact_id: job.data.contact_id,
      channel: "email",
      event_key: job.data.event_key,
      recipient: to,
      subject,
      status: "failed",
      error: err.message,
      reference_type: job.data.reference_type,
      reference_id: job.data.reference_id,
    });
    throw err;
  }

  const messageId = info && info.messageId;
  // H-8: stamp the provider ref onto the originating smartcomm message AND
  // flip delivery_status queued → sent. Without the status flip the message
  // sits at "queued" forever and the inbox shows it stuck in the queue even
  // though the email was delivered.
  if (job.data.smartcomm_message_id) {
    try {
      const smartcommRepo = require("../../modules/smartcomm/smartcomm.repo");
      const updated = await smartcommRepo.setMessageDelivery({
        message_id: job.data.smartcomm_message_id,
        delivery_status: "sent",
        external_ref: messageId ? String(messageId) : undefined,
      });
      if (updated) {
        smartcommEvents.emit("message.edited", {
          channel_id: updated.channel_id,
          message_id: job.data.smartcomm_message_id,
        });
      }
    } catch (e) {
      logger.warn({ e: e.message }, "email-send: delivery stamp (sent) failed");
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
    reference_type: job.data.reference_type,
    reference_id: job.data.reference_id,
  });
  logger.info({ jobId: job.id, to, messageId }, "email sent");
  return { messageId };
};
