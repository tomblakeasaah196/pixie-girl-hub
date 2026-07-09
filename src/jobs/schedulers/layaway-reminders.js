/**
 * Layaway gentle reminder dispatch (V2.2 §6.2).
 *
 * Every 30 min. For each brand, finds layaway orders with an outstanding
 * balance that are due a reminder (never reminded, or last reminded longer
 * ago than installment_settings.layaway_reminder_cadence_days), then hands
 * each order to the Communications Studio dispatcher.
 *
 * Everything about the message — channel (email vs whatsapp), the body,
 * the subject, and whether to skip untouched-orders — is configured on
 * the `layaway_reminder` automation in the Studio (000309 seeds it as
 * email + `min_amount_paid_ngn: 1`). This cron no longer knows what the
 * message says.
 *
 * Idempotency:
 *   • claimReminderSend stamps last_reminder_sent_at atomically so two
 *     overlapping sweeps can't double-fire.
 *   • The dispatcher then claims a slot on automation_send_log using
 *     (event_key, order_id, reminder-bucket) as the dedup key so a retry
 *     of the whole cron between claim and send is still a no-op.
 *
 * Reminders stop automatically: once an order is paid in full it leaves
 * the 'pending_payment' filter and drops out of the query.
 */

"use strict";

const Decimal = require("decimal.js");

const { logger } = require("../../config/logger");
const salesRepo = require("../../modules/sales/sales.repo");
const businessConfig = require("../../modules/business_setup/business-config.repo");
const commsStudio = require("../../modules/comms_studio/comms-studio.service");
const brandUrls = require("../../utils/brand-urls");

const { BRANDS } = require("../../config/brands");

function ngn(v) {
  return (
    "₦" +
    new Decimal(v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  );
}

async function runLayawayReminders() {
  let sent = 0;
  let skipped = 0;
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
        const claimed = await salesRepo.claimReminderSend({
          brand,
          id: order.order_id,
          cadenceDays,
        });
        if (!claimed) continue;

        const payUrl = await brandUrls.payLinkUrl(
          brand,
          order.public_tracking_token,
        );

        const result = await commsStudio.dispatch({
          brand,
          event_key: "layaway_reminder",
          contact_id: order.contact_id,
          reference_type: "sales_order",
          reference_id: order.order_id,
          // reminder-bucket: same order + same cadence stamp = same dedup
          // slot, so a mid-cron retry can't double-send even if the SQL
          // stamp made it through.
          dedup_key: `layaway:${order.order_id}:${Date.now()
            .toString(36)
            .slice(0, -3)}`,
          variables: {
            order_number: order.order_number,
            amount_paid_ngn: ngn(order.amount_paid_ngn),
            amount_paid_ngn_display: ngn(order.amount_paid_ngn),
            amount_paid_ngn_raw: Number(order.amount_paid_ngn || 0),
            total_ngn: ngn(order.total_ngn),
            total_ngn_display: ngn(order.total_ngn),
            balance_due_ngn: ngn(order.balance_due_ngn),
            balance_due_ngn_display: ngn(order.balance_due_ngn),
            pay_url: payUrl,
          },
        });
        if (result.dispatched) sent += 1;
        else skipped += 1;
      } catch (err) {
        logger.error(
          { err, brand, order_id: order.order_id },
          "layaway reminder dispatch failed",
        );
      }
    }
  }
  logger.info({ sent, skipped }, "layaway reminders sweep done");
  return { sent, skipped };
}

module.exports = { runLayawayReminders };
