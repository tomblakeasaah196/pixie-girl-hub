/**
 * Order timeline subscribers (F-5 / PD §6.23.6).
 *
 *  • order.paid (transactional outbox, post-commit) → "payment_received".
 *  • logistics delivery.status (in-process) → the shipping/delivery stages
 *    (packed_for_dispatch / in_transit / out_for_delivery / delivered), resolved
 *    to the order via deliveries.order_id. once_only so a stage shows at most
 *    once; guarded so a timeline miss never affects the delivery flow.
 *
 * Remaining stages (order_confirmed, production weaving/QC, service consultation)
 * are recorded by their owning flows via timeline.record() as those wire in.
 */

"use strict";

const outbox = require("../../shared/outbox/outbox");
const logisticsEvents = require("../logistics/logistics.events");
const timeline = require("./timeline.service");
const { query } = require("../../config/database");
const { t } = require("../../config/brands");
const { logger } = require("../../config/logger");

// Delivery status (logistics) → customer-facing timeline event code.
const DELIVERY_STAGE = {
  picked_up: "packed_for_dispatch",
  in_transit: "in_transit",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered",
};

async function onOrderPaid({ brand, order_id }) {
  await timeline.record({
    brand,
    sales_order_id: order_id,
    event_code: "payment_received",
    source_module: "sales",
    once_only: true,
  });
}

async function onDeliveryStatus({ brand, delivery_id, status }) {
  const event_code = DELIVERY_STAGE[status];
  if (!event_code) return; // not a customer-facing stage
  try {
    const { rows } = await query(
      `SELECT order_id FROM ${t(brand, "deliveries")} WHERE delivery_id = $1`,
      [delivery_id],
    );
    const order_id = rows[0] && rows[0].order_id;
    if (!order_id) return; // non-sales delivery (stock/intercompany transfer)
    await timeline.record({
      brand,
      sales_order_id: order_id,
      event_code,
      source_module: "logistics",
      once_only: true,
    });
  } catch (err) {
    logger.error(
      { err: err.message, brand, delivery_id, status },
      "timeline: delivery.status record failed",
    );
  }
}

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  outbox.register("order.paid", "order-timeline", onOrderPaid);
  logisticsEvents.on("delivery.status", onDeliveryStatus);
  logger.info(
    "sales timeline subscribers registered (order.paid → payment_received; delivery.status → shipping stages)",
  );
}

register();

module.exports = { register, onOrderPaid, onDeliveryStatus, DELIVERY_STAGE };
