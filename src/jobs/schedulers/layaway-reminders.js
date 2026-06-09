/**
 * Layaway gentle reminder dispatch (V2.2 §6.2).
 * Every 30 min. For each brand, finds layaway orders with an outstanding
 * balance that are due a reminder (never reminded, or last reminded longer
 * ago than installment_settings.layaway_reminder_cadence_days), emits an
 * `order.payment_reminder` event (consumed by Smartcomm 6.17 to send the
 * friendly running-balance message + pay-link), and stamps
 * last_reminder_sent_at so the 30-min tick doesn't double-send.
 *
 * Reminders stop automatically: once an order is paid in full it leaves the
 * 'pending_payment' filter, and balance_due drops out of the query.
 */

"use strict";

const { logger } = require("../../config/logger");
const salesRepo = require("../../modules/sales/sales.repo");
const salesEvents = require("../../modules/sales/sales.events");
const businessConfig = require("../../modules/business_setup/business-config.repo");

const { BRANDS } = require("../../config/brands");

async function runLayawayReminders() {
  let sent = 0;
  for (const brand of BRANDS) {
    const cfg = await businessConfig.findByKey(brand);
    const settings = (cfg && cfg.installment_settings) || {};
    const cadenceDays = settings.layaway_reminder_cadence_days || 7;

    let due = [];
    try {
      due = await salesRepo.listLayawayDueForReminder({ brand, cadenceDays });
    } catch (err) {
      logger.error({ err, brand }, "layaway reminder query failed");
      continue;
    }

    for (const order of due) {
      try {
        salesEvents.emit("order.payment_reminder", {
          brand,
          order_id: order.order_id,
          order_number: order.order_number,
          contact_id: order.contact_id,
          total_ngn: order.total_ngn,
          amount_paid_ngn: order.amount_paid_ngn,
          balance_due_ngn: order.balance_due_ngn,
          public_tracking_token: order.public_tracking_token,
        });
        await salesRepo.markReminderSent({ brand, id: order.order_id });
        sent += 1;
      } catch (err) {
        logger.error(
          { err, brand, order_id: order.order_id },
          "layaway reminder dispatch failed",
        );
      }
    }
  }
  logger.info({ sent }, "layaway reminders sweep done");
  return { sent };
}

module.exports = { runLayawayReminders };
