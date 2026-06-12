/**
 * Retention workflow trigger (F-4 / PD §6.23). On `order.paid` (via the
 * transactional outbox, post-commit), fire the `order_placed` workflow trigger
 * so any matching active rules enqueue an execution. Idempotency / rate-limit
 * is handled inside workflow.trigger(); the execution itself runs on the
 * retention-workflows cron.
 */

"use strict";

const outbox = require("../../shared/outbox/outbox");
const workflow = require("./workflow.service");
const { logger } = require("../../config/logger");

async function onOrderPaid({ brand, order_id, contact_id }) {
  await workflow.trigger({
    brand,
    trigger_type: "order_placed",
    contact_id,
    source_table: "sales_orders",
    source_id: order_id,
  });
}

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  outbox.register("order.paid", "retention-workflow", onOrderPaid);
  logger.info(
    "retention workflow subscriber registered (outbox order.paid → trigger)",
  );
}

register();

module.exports = { register, onOrderPaid };
