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
const { logger } = require("../../config/logger");

module.exports = async function process(job) {
  const { to, subject } = job.data || {};
  if (!to || !subject) {
    logger.warn({ jobId: job.id }, "email-send: missing to/subject — skipping");
    return { skipped: true };
  }
  const info = await email.send(job.data);
  logger.info(
    { jobId: job.id, to, messageId: info && info.messageId },
    "email sent",
  );
  return { messageId: info && info.messageId };
};
