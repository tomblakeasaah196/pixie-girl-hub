/**
 * Invoicing subscriber — auto-generate the customer invoice when a sales order
 * is paid in full. Driven by the transactional outbox (H-2): runs post-commit
 * so the order is visible, with at-least-once delivery. Idempotent —
 * `createFromOrder` returns the existing invoice if one already exists
 * (`findByOrderId`), so it throws on real errors to let the outbox retry.
 */

"use strict";

const outbox = require("../../shared/outbox/outbox");
const salesRepo = require("../sales/sales.repo");
const service = require("./invoicing.service");
const { logger } = require("../../config/logger");

async function autoInvoice({ brand, order_id }) {
  const order = await salesRepo.findById({ brand, id: order_id });
  if (!order) throw new Error(`order ${order_id} not found for auto-invoice`);
  await service.createFromOrder({ brand, order, user_id: null });
}

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  outbox.register("order.paid", "invoicing", autoInvoice);
  logger.info(
    "invoicing subscribers registered (outbox order.paid → auto-invoice)",
  );
}

register();

module.exports = { register, autoInvoice };
