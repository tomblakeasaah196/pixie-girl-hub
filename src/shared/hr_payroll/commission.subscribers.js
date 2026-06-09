/**
 * Commission subscriber (G-3) — accrue sales commission when an order is paid.
 * Best-effort and idempotent: a hiccup is logged and never rolls back the
 * customer's paid order; accrueForOrder guards against duplicate accrual per
 * order. Registered once.
 */

"use strict";

const salesEvents = require("../../modules/sales/sales.events");
const salesRepo = require("../../modules/sales/sales.repo");
const payroll = require("./payroll.service");
const { logger } = require("../../config/logger");

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  salesEvents.on("order.paid", async ({ brand, order_id }) => {
    try {
      const order = await salesRepo.findById({ brand, id: order_id });
      if (!order) return;
      await payroll.accrueForOrder({ brand, order });
    } catch (err) {
      logger.error(
        { err: err.message, brand, order_id },
        "hr_payroll: commission accrual on sale failed",
      );
    }
  });
  logger.info(
    "hr_payroll subscribers registered (sales.order.paid → commission)",
  );
}

register();

module.exports = { register };
