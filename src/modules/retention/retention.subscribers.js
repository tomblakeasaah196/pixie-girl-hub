/**
 * Retention subscriber — award loyalty points and Streak Stars when a sales
 * order is paid. Driven by the transactional outbox (H-2): runs post-commit
 * with at-least-once delivery. Each earner is idempotent (reference /
 * lifetime-cap guards) and best-effort — a failure in one earner is logged and
 * swallowed so the others (and the row's other consumers) are unaffected.
 */

"use strict";

const outbox = require("../../shared/outbox/outbox");
const service = require("./retention.service");
const { logger } = require("../../config/logger");

async function awardLoyaltyAndStreak({
  brand,
  order_id,
  contact_id,
  total_ngn,
}) {
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
}

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  outbox.register("order.paid", "retention", awardLoyaltyAndStreak);
  logger.info(
    "retention subscribers registered (outbox order.paid → loyalty + streak)",
  );
}

register();

module.exports = { register, awardLoyaltyAndStreak };
