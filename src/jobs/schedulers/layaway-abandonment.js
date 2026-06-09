/**
 * Layaway abandonment sweep (V2.2 §6.2).
 * Daily 02:00. Auto-cancels layaway orders that have gone silent for the
 * configured window:
 *   payment_model = 'layaway'
 *   AND status = 'pending_payment'
 *   AND no payment for > business_config.installment_settings.layaway_abandonment_days
 *
 * Cancellation goes through salesService.cancelOrder, which releases the
 * stock reservation, flips the order to 'cancelled', audits, and emits
 * `order.cancelled`. Each order is its own transaction so one bad row can't
 * fail the batch.
 */

"use strict";

const { logger } = require("../../config/logger");
const salesService = require("../../modules/sales/sales.service");
const salesRepo = require("../../modules/sales/sales.repo");
const businessConfig = require("../../modules/business_setup/business-config.repo");

const { BRANDS } = require("../../config/brands");
const SYSTEM_USER = { user_id: null };

async function runLayawayAbandonmentSweep() {
  let cancelled = 0;
  for (const brand of BRANDS) {
    const cfg = await businessConfig.findByKey(brand);
    const settings = (cfg && cfg.installment_settings) || {};
    if (settings.auto_cancel_after_no_payment === false) continue;
    const days = settings.layaway_abandonment_days || 60;

    let due = [];
    try {
      due = await salesRepo.listAbandonableLayaway({ brand, days });
    } catch (err) {
      logger.error({ err, brand }, "layaway abandonment query failed");
      continue;
    }

    for (const order of due) {
      try {
        await salesService.cancelOrder({
          brand,
          user: SYSTEM_USER,
          request_id: null,
          id: order.order_id,
        });
        cancelled += 1;
        logger.info(
          { brand, order_number: order.order_number },
          "layaway order auto-cancelled (abandoned)",
        );
      } catch (err) {
        logger.error(
          { err, brand, order_id: order.order_id },
          "layaway abandonment cancel failed",
        );
      }
    }
  }
  logger.info({ cancelled }, "layaway abandonment sweep done");
  return { cancelled };
}

module.exports = { runLayawayAbandonmentSweep };
