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
const receipts = require("../../services/email-receipts.service");
const { logger } = require("../../config/logger");
const smartcommEvents = require("../../modules/smartcomm/smartcomm.events");

module.exports = async function process(job) {
  const { to, subject } = job.data || {};
  if (!to || !subject) {
    logger.warn({ jobId: job.id }, "email-send: missing to/subject — skipping");
    return { skipped: true };
  }

  // Correlation token for ESP delivery receipts. Minted per ATTEMPT and stamped
  // on the ledger row we write below, so a webhook arriving minutes later can
  // find the send it belongs to. Derived from the job id when there is one, so
  // a BullMQ retry of the same job reuses the ref rather than orphaning the
  // receipts for the attempt that actually landed.
  const message_ref = job.id
    ? `j${String(job.id).replace(/[^A-Za-z0-9_-]/g, "")}`
    : receipts.newMessageRef();

  let info;
  try {
    info = await email.send({ ...job.data, message_ref });
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
      message_ref,
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
    // The SMTP Message-ID doubles as the fallback correlation key for an ESP
    // that echoes only that (see comms-log.findSendForEvent).
    provider_ref: messageId,
    reference_type: job.data.reference_type,
    reference_id: job.data.reference_id,
    message_ref,
  });
  logger.info({ jobId: job.id, to, messageId }, "email sent");
  return { messageId, message_ref };
};
