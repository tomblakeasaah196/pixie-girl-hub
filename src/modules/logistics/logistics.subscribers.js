/**
 * Logistics subscriber (G-2) — auto-create a delivery when a dispatch order is
 * paid (PRD §6.10: dispatch orders flow into Logistics once the balance is
 * cleared). Best-effort and idempotent: createForOrder no-ops for non-dispatch
 * orders, missing address/courier, or an order that already has a delivery.
 * Registered once.
 */

"use strict";

const salesEvents = require("../sales/sales.events");
const salesRepo = require("../sales/sales.repo");
const service = require("./logistics.service");
const { logger } = require("../../config/logger");

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  salesEvents.on("order.paid", async ({ brand, order_id }) => {
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
  });
  logger.info(
    "logistics subscribers registered (sales.order.paid → dispatch delivery)",
  );
}

register();

module.exports = { register };
