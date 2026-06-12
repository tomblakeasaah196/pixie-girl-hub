/**
 * Invoice reminder sweep (F-10 / §6.5).
 * Runs every 30 minutes. Finds scheduled invoice_reminders whose
 * scheduled_for has passed and the invoice is still unpaid, then fires them
 * via the smartcomm send path (email or WhatsApp).
 */

"use strict";

const { logger } = require("../../config/logger");
const { BRANDS } = require("../../config/brands");
const invoicingService = require("../../modules/invoicing/invoicing.service");

async function runInvoiceReminderSweep() {
  let totalSent = 0;
  let totalFailed = 0;
  for (const brand of BRANDS) {
    try {
      const { sent, failed } = await invoicingService.sendDueReminders({
        brand,
      });
      totalSent += sent;
      totalFailed += failed;
    } catch (err) {
      logger.error(
        { err: err.message, brand },
        "invoice-reminder sweep failed for brand",
      );
    }
  }
  logger.info(
    { sent: totalSent, failed: totalFailed },
    "invoice-reminder sweep complete",
  );
  return { sent: totalSent, failed: totalFailed };
}

module.exports = { runInvoiceReminderSweep };
