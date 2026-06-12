/**
 * Order timeline subscriber (F-5 / PD §6.23.6). On `order.paid` (via the
 * transactional outbox, post-commit), append a customer-visible
 * "payment_received" event to the order timeline. Idempotent (once_only), so
 * an at-least-once redelivery records the stage once.
 *
 * Other lifecycle stages (order_confirmed, packed_for_dispatch, out_for_delivery,
 * delivered, …) are recorded by their owning modules via timeline.record() as
 * those flows are wired in.
 */

"use strict";

const outbox = require("../../shared/outbox/outbox");
const timeline = require("./timeline.service");
const { logger } = require("../../config/logger");

async function onOrderPaid({ brand, order_id }) {
  await timeline.record({
    brand,
    sales_order_id: order_id,
    event_code: "payment_received",
    source_module: "sales",
    once_only: true,
  });
}

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  outbox.register("order.paid", "order-timeline", onOrderPaid);
  logger.info(
    "sales timeline subscriber registered (outbox order.paid → payment_received)",
  );
}

register();

module.exports = { register, onOrderPaid };
