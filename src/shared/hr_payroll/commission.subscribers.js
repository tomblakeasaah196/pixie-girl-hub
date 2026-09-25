/**
 * Commission subscriber (G-3) — accrue sales commission when an order is paid.
 * Driven by the transactional outbox (H-2): runs post-commit with at-least-once
 * delivery. Idempotent — `accrueForOrder` guards against duplicate accrual per
 * order (`commissionExistsForOrder`), so it throws on real errors to let the
 * outbox retry.
 */

"use strict";

const outbox = require("../outbox/outbox");
const salesRepo = require("../../modules/sales/sales.repo");
const salesEvents = require("../../modules/sales/sales.events");
const payroll = require("./payroll.service");
const { logger } = require("../../config/logger");

async function accrueCommission({ brand, order_id }) {
  const order = await salesRepo.findById({ brand, id: order_id });
  if (!order)
    throw new Error(`order ${order_id} not found for commission accrual`);
  await payroll.accrueForOrder({ brand, order });
}

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  outbox.register("order.paid", "commission", accrueCommission);
  // Cancellation reversal is intentionally limited to accrued/approved
  // commissions. Payroll.service leaves paid rows untouched.
  salesEvents.on("order.cancelled", ({ brand, order_id }) => {
    payroll.reverseForCancelledOrder({ brand, order_id }).catch((err) =>
      logger.error(
        { err: err.message, brand, order_id },
        "hr_payroll commission cancellation reversal failed",
      ),
    );
  });
  logger.info(
    "hr_payroll subscribers registered (outbox order.paid → commission)",
  );
}

register();

module.exports = { register, accrueCommission };
