/**
 * Scheduled email-campaign send sweep (V2.2 §6.16).
 * Every minute, for each brand, send any campaign whose status is 'scheduled'
 * and whose scheduled_for has arrived. Delegates to the email-campaigns
 * service (which queues recipients through the provider + rolls up counters).
 */

"use strict";

const { logger } = require("../../config/logger");
const service = require("../../modules/email_campaigns/email-campaigns.service");

const { BRANDS } = require("../../config/brands");

// Cron has no acting staff user; audit rows record a null actor.
const SYSTEM_USER = { user_id: null };

async function runScheduledEmailSends() {
  let ran = 0;
  for (const brand of BRANDS) {
    try {
      const r = await service.runDueScheduled({ brand, user: SYSTEM_USER });
      ran += r.ran;
    } catch (err) {
      logger.error(
        { err: err.message, brand },
        "scheduled email send sweep failed",
      );
    }
  }
  logger.info({ ran }, "scheduled email-campaign sends swept");
  return { ran };
}

module.exports = { runScheduledEmailSends };
