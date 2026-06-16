/**
 * Notification fan-out — turns selected domain events into in-app notifications
 * for the relevant staff user. Driven by the transactional outbox (H-2): runs
 * post-commit with at-least-once delivery. Best-effort — failures are logged
 * and swallowed so the source flow and the row's other consumers are never
 * blocked.
 *
 * action_url is included so the notification deep-links directly to the
 * relevant record in the admin frontend.
 */

"use strict";

const outbox = require("../outbox/outbox");
const salesRepo = require("../../modules/sales/sales.repo");
const notifications = require("../../services/notifications.service");
const { logger } = require("../../config/logger");

// A rep's sale was paid → notify the rep.
async function notifyRepOnSale({ brand, order_id }) {
  try {
    const order = await salesRepo.findById({ brand, id: order_id });
    if (!order || !order.created_by) return;
    await notifications.notify({
      user_id: order.created_by,
      business: brand,
      type: "order_status_change",
      priority: "normal",
      title: `Order ${order.order_number} paid`,
      body: `${order.order_number} is fully paid (₦${order.total_ngn}).`,
      reference_type: "sales_order",
      reference_id: order_id,
      action_url: `/sales?order=${order_id}`,
    });
  } catch (err) {
    logger.error(
      { err: err.message, brand, order_id },
      "notifications: order.paid fan-out failed",
    );
  }
}

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  outbox.register("order.paid", "notifications", notifyRepOnSale);
  logger.info("notifications subscribers registered (outbox order.paid → rep)");
}

register();

module.exports = { register, notifyRepOnSale };
