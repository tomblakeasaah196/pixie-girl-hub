/**
 * Retention subscribers — award loyalty points and Streak Stars when a sales
 * order is paid. Best-effort and idempotent: a hiccup here is logged and
 * never rolls back the customer's paid order (each earner runs in its own
 * transaction; re-running is safe via reference/lifetime-cap guards).
 * Registered once.
 */

"use strict";

const salesEvents = require("../sales/sales.events");
const service = require("./retention.service");
const { logger } = require("../../config/logger");

let registered = false;

function register() {
  if (registered) return;
  registered = true;

  salesEvents.on(
    "order.paid",
    async ({ brand, order_id, contact_id, total_ngn }) => {
      if (!contact_id) return;
      // Loyalty purchase points.
      try {
        await service.earnForOrder({ brand, contact_id, order_id, total_ngn });
      } catch (err) {
        logger.error(
          { err: err.message, brand, order_id },
          "retention: loyalty earn failed",
        );
      }
      // Streak Stars for money spent.
      try {
        await service.awardStars({
          brand,
          contact_id,
          action_type: "money_spent",
          reference_type: "sales_order",
          reference_id: order_id,
          amount_ngn: total_ngn,
        });
      } catch (err) {
        logger.error(
          { err: err.message, brand, order_id },
          "retention: streak money_spent failed",
        );
      }
      // First-order bonus (lifetime-capped rule awards at most once).
      try {
        await service.awardStars({
          brand,
          contact_id,
          action_type: "first_order",
          reference_type: "sales_order",
          reference_id: order_id,
        });
      } catch (err) {
        logger.error(
          { err: err.message, brand, order_id },
          "retention: streak first_order failed",
        );
      }
    },
  );

  logger.info(
    "retention subscribers registered (sales.order.paid → loyalty + streak)",
  );
}

register();

module.exports = { register };
