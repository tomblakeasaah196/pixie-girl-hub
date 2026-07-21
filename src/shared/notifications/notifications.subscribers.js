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

async function sendCustomerConfirmation({ brand, order_id }) {
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
    if (!contact) return;

    if (contact.email) {
      // Premium, fully-branded confirmation letter: logo, brand colours,
      // itemised order, delivery ETA or pickup window (Settings-driven),
      // signed "Sales, {brand}". Mirrored onto the contact's email thread
      // in Messaging.
      await sendOrderConfirmationEmail({
        brand,
        order,
        contact,
        contact_id: order.contact_id,
      });
      return;
    }

    // No email on file — the common case for WhatsApp / Instagram customers
    // (the order-link checkout only requires a phone). They used to get NO
    // confirmation at all: the 'order_confirmation' automation existed in the
    // Comms Studio but nothing ever dispatched it. Dispatch it now so the
    // confirmation reaches them on the channel the CEO configured (the
    // policy's fallback_channel covers the email-preferred default — see the
    // dispatcher's address-aware fallback). Dedup on the order id, so the
    // at-least-once outbox can never double-send.
    const commsStudio = require("../../modules/comms_studio/comms-studio.service");
    const brandUrls = require("../../utils/brand-urls");
    let tracking_url = "";
    try {
      tracking_url = order.public_tracking_token
        ? await brandUrls.payLinkUrl(brand, order.public_tracking_token)
        : (await brandUrls.publicBaseUrl(brand)) || "";
    } catch {
      tracking_url = "";
    }
    const total = Number(order.total_ngn || 0);
    await commsStudio.dispatch({
      brand,
      event_key: "order_confirmation",
      contact_id: order.contact_id,
      reference_type: "sales_order",
      reference_id: order_id,
      dedup_key: `order_confirmation:${order_id}`,
      variables: {
        order_number: order.order_number,
        total_ngn_display: `₦${total.toLocaleString("en-NG", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`,
        tracking_url,
      },
    });
  } catch (err) {
    logger.error(
      { err: err.message, brand, order_id },
      "notifications: customer confirmation failed",
    );
  }
}

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  outbox.register("order.paid", "notifications", notifyRepOnSale);
  // Customer order-confirmation fires at PLACEMENT (order.created), not on paid,
  // so Pending/Partially-Paid orders are acknowledged immediately. The paid-time
  // receipt is handled separately by invoicing on order.paid.
  outbox.register(
    "order.created",
    "customer-confirmation-email",
    sendCustomerConfirmation,
  );
  logger.info(
    "notifications subscribers registered (order.paid → rep notify; order.created → customer confirmation email/WhatsApp)",
  );
}

register();

module.exports = { register, notifyRepOnSale };
