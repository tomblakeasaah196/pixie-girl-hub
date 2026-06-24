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

async function sendCustomerConfirmationEmail({ brand, order_id }) {
  try {
    const { query: dbQuery } = require("../../config/database");
    const {
      sendOrderConfirmationEmail,
    } = require("../../services/order-confirmation-email");

    const order = await salesRepo.findById({ brand, id: order_id });
    if (!order || !order.contact_id) return;

    const { rows } = await dbQuery(
      `SELECT email, display_name, first_name FROM shared.contacts WHERE contact_id = $1`,
      [order.contact_id],
    );
    const contact = rows[0];
    if (!contact || !contact.email) return;

    // Premium, fully-branded confirmation: logo, brand colours, itemised order,
    // delivery ETA or pickup window (Settings-driven), signed "Sales, {brand}".
    await sendOrderConfirmationEmail({ brand, order, contact });
  } catch (err) {
    logger.error(
      { err: err.message, brand, order_id },
      "notifications: customer confirmation email failed",
    );
  }
}

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  outbox.register("order.paid", "notifications", notifyRepOnSale);
  outbox.register(
    "order.paid",
    "customer-confirmation-email",
    sendCustomerConfirmationEmail,
  );
  logger.info(
    "notifications subscribers registered (outbox order.paid → rep + customer email)",
  );
}

register();

module.exports = { register, notifyRepOnSale };
