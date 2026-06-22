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
    const emailService = require("../../services/email.service");
    const { query: dbQuery } = require("../../config/database");
    const order = await salesRepo.findById({ brand, id: order_id });
    if (!order || !order.contact_id) return;

    const { rows } = await dbQuery(
      `SELECT email, display_name, first_name FROM shared.contacts WHERE contact_id = $1`,
      [order.contact_id],
    );
    const contact = rows[0];
    if (!contact || !contact.email) return;

    const { rows: brandRows } = await dbQuery(
      `SELECT display_name, support_email FROM shared.business_config WHERE business_key = $1`,
      [brand],
    );
    const brandInfo = brandRows[0] || {};
    const brandName = brandInfo.display_name || brand;
    const supportEmail = brandInfo.support_email || "";

    const name = contact.first_name || contact.display_name || "there";
    const lines = (order.lines || [])
      .map(
        (l) =>
          `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee">${l.product_name_snapshot || "Item"} ${l.variant_label_snapshot ? `(${l.variant_label_snapshot})` : ""}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:center">${l.quantity}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right">₦${Number(l.unit_price_ngn).toLocaleString()}</td></tr>`,
      )
      .join("");

    const html = `
      <div style="max-width:560px;margin:0 auto;font-family:system-ui,sans-serif;color:#1a1a1a">
        <h2 style="color:#690909">Thank you for your order, ${name}!</h2>
        <p>Your order <strong>${order.order_number}</strong> has been confirmed and payment received.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <thead><tr style="background:#f5f5f5"><th style="padding:8px 12px;text-align:left">Item</th><th style="padding:8px 12px;text-align:center">Qty</th><th style="padding:8px 12px;text-align:right">Price</th></tr></thead>
          <tbody>${lines}</tbody>
        </table>
        <p style="font-size:18px;font-weight:600">Total: ₦${Number(order.total_ngn).toLocaleString()}</p>
        <p style="color:#666;font-size:13px">We'll send you tracking information once your order ships. If you have any questions, reply to this email${supportEmail ? ` or reach us at ${supportEmail}` : ""}.</p>
        <p style="margin-top:24px;color:#999;font-size:12px">— ${brandName}</p>
      </div>`;

    await emailService.send({
      to: contact.email,
      subject: `Order confirmed — ${order.order_number}`,
      html,
      brand,
    });
    logger.info(
      { order_id, email: contact.email },
      "customer confirmation email sent",
    );
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
