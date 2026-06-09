/**
 * Production subscriber (G-1) — when a deposit-triggered order clears its
 * deposit (`order.deposit_met`), open a styling service job so work begins.
 * Best-effort and idempotent (createServiceJobForOrder no-ops if a job exists
 * or the brand runs no service types). Registered once.
 */

"use strict";

const salesEvents = require("../sales/sales.events");
const salesRepo = require("../sales/sales.repo");
const service = require("./production.service");
const { logger } = require("../../config/logger");

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  salesEvents.on("order.deposit_met", async ({ brand, order_id }) => {
    try {
      const order = await salesRepo.findById({ brand, id: order_id });
      if (!order) return;
      await service.createServiceJobForOrder({ brand, order });
    } catch (err) {
      logger.error(
        { err: err.message, brand, order_id },
        "production: service job on deposit_met failed",
      );
    }
  });
  logger.info(
    "production subscribers registered (sales.order.deposit_met → service job)",
  );
}

register();

module.exports = { register };
