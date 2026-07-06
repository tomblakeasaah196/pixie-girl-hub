/**
 * E-signature reminder + expiry sweep (V2.2 §6.13).
 *
 * Runs daily (09:00 Africa/Lagos). Emails a reminder to every pending signer
 * whose turn it is and who hasn't been nudged in 48h, then expires any request
 * past its deadline and notifies the creator. Non-fatal — a bad email or row
 * never stops the sweep.
 */

"use strict";

const { logger } = require("../../config/logger");
const esign = require("../../shared/documents/documents.esign.service");

async function runEsignReminderSweep() {
  let reminders = { candidates: 0, sent: 0 };
  let expiry = { expired: 0 };
  try {
    reminders = await esign.runReminders({ gapHours: 48 });
  } catch (err) {
    logger.error({ err: err.message }, "esign reminder sweep failed");
  }
  try {
    expiry = await esign.runExpiry();
  } catch (err) {
    logger.error({ err: err.message }, "esign expiry sweep failed");
  }
  logger.info(
    { reminded: reminders.sent, expired: expiry.expired },
    "esign reminder/expiry sweep done",
  );
  return { reminded: reminders.sent, expired: expiry.expired };
}

module.exports = { runEsignReminderSweep };
