/**
 * Receipt subscriber — auto-archive the customer receipt PDF when a sales order
 * is paid in full. Driven by the transactional outbox (H-2): runs post-commit
 * with at-least-once delivery, alongside the auto-invoice consumer.
 *
 * Idempotent + best-effort: archiveReceiptPdf skips if a receipt already exists
 * for the order and never throws (a render hiccup must not fail the order.paid
 * row or loop forever) — failures are logged so a renderer problem is visible.
 */

"use strict";

const outbox = require("../../shared/outbox/outbox");
const salesService = require("./sales.service");
const { logger } = require("../../config/logger");

async function autoReceipt({ brand, order_id }) {
  await salesService.archiveReceiptPdf({ brand, order_id });
}

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  outbox.register("order.paid", "sales-receipt-archive", autoReceipt);
  logger.info(
    "sales receipt subscriber registered (outbox order.paid → archive receipt PDF)",
  );
}

register();

module.exports = { register, autoReceipt };
