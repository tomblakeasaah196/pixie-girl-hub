/**
 * Logistics subscriber (G-2) — auto-create a delivery when a dispatch order is
 * PAID (PRD §6.10). Driven by the transactional outbox (H-2): runs post-commit
 * with at-least-once delivery. Idempotent: `createForOrder` no-ops for
 * non-dispatch orders, missing address/courier, or an order that already has a
 * delivery. Best-effort — a failure is logged and swallowed (the row's other
 * consumers are unaffected; a missed dispatch is recoverable manually).
 *
 * PREPAID-ONLY (owner directive): the business never ships pay-on-delivery, so
 * a delivery is created ONLY once payment clears (`order.paid`). We deliberately
 * do NOT subscribe to `order.confirmed` — an unpaid order must never enter the
 * dispatch queue.
 */

"use strict";

const outbox = require("../../shared/outbox/outbox");
const salesRepo = require("../sales/sales.repo");
const service = require("./logistics.service");
const { logger } = require("../../config/logger");

async function autoDelivery({ brand, order_id }) {
  try {
    const order = await salesRepo.findById({ brand, id: order_id });
    if (!order) return;
    await service.createForOrder({ brand, order });
  } catch (err) {
    logger.error(
      { err: err.message, brand, order_id },
      "logistics: auto-create delivery on order.paid failed",
    );
  }
}

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  // Prepaid-only: a dispatch order enters the queue ONLY once it is paid.
  // (No `order.confirmed` subscription — see the file header.)
  outbox.register("order.paid", "logistics", autoDelivery);
  logger.info(
    "logistics subscribers registered (outbox order.paid → dispatch delivery)",
  );
}

register();

module.exports = { register, autoDelivery };
