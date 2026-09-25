/**
 * "Your pre-order has arrived" — the manual, EMAIL-ONLY customer notice.
 *
 * When the stock a customer pre-ordered comes in (and the allocator has drawn or
 * reserved it), a human can tell the customer with one button on the order.
 * Deliberately email-only and manual, per the owner's directive: it does NOT go
 * through Comms Studio (which would honour a configurable WhatsApp/IG channel) —
 * it composes a branded transactional email and sends it straight through the
 * email service, so it can only ever reach the customer by email.
 *
 * Idempotent-friendly: each send stamps preorder_arrival_notified_at so the UI
 * can show "notified on …", but a resend is allowed (stock can arrive in waves).
 */

"use strict";

const repo = require("./sales.repo");
const { transaction } = require("../../config/database");
const { audit } = require("../../middleware/audit");
const { AppError, NotFoundError } = require("../../utils/errors");
const { sendTransactionalEmail } = require("../../services/transactional-email");
const brandUrls = require("../../utils/brand-urls");
const { logger } = require("../../config/logger");

/** Public tracking / pay link for the order, with a safe fallback to the site. */
async function trackingUrl(brand, order) {
  try {
    if (order.public_tracking_token) {
      return await brandUrls.payLinkUrl(brand, order.public_tracking_token);
    }
    return (await brandUrls.publicBaseUrl(brand)) || "";
  } catch {
    return "";
  }
}

/**
 * Email the customer that their pre-ordered item has arrived and is being
 * prepared. Records the send on the order and audits it.
 *
 * @param {object} a
 * @param {string} a.brand
 * @param {object} a.user   the staff member clicking the button (attribution)
 * @param {string} a.order_id
 * @returns {Promise<{sent:boolean, to:string, notified_at:string|null}>}
 */
async function notifyPreorderArrival({ brand, user, order_id }) {
  const order = await repo.findById({ brand, id: order_id });
  if (!order) throw new NotFoundError("Order");

  // Only meaningful for an order that is (or was) a pre-order.
  const wasPreorder =
    order.is_preorder ||
    !!order.preorder_fulfilled_at ||
    !!order.preorder_ready_by;
  if (!wasPreorder) {
    throw new AppError(
      "NOT_A_PREORDER",
      "This order has no pre-order to announce",
      422,
      { user_message: "This order isn’t a pre-order." },
    );
  }

  const to = order.contact_email;
  if (!to) {
    throw new AppError(
      "NO_CUSTOMER_EMAIL",
      "The customer has no email on file",
      422,
      {
        user_message:
          "This customer has no email address on file — add one to send the arrival notice.",
      },
    );
  }

  const url = await trackingUrl(brand, order);
  const firstName = (order.contact_name || "").trim().split(/\s+/)[0] || "there";

  await sendTransactionalEmail({
    brand,
    to,
    subject: `Good news — your pre-order ${order.order_number} has arrived`,
    preheader: "Your pre-ordered item is in and we’re preparing it now.",
    eyebrow: "Pre-order update",
    heading: "Your item has arrived",
    intro: `Hi ${firstName}, great news — the item you pre-ordered on ${order.order_number} is now in stock and we’ve reserved it for you. Our team is preparing your order and will be in touch with the next steps.`,
    details: [{ label: "Order", value: order.order_number, mono: true }],
    cta: url ? { label: "View your order", url } : null,
    signoff: "Thank you for your patience — we can’t wait to get this to you.",
  });

  let notified_at = null;
  await transaction(async (client) => {
    notified_at = await repo.markArrivalNotified({
      client,
      brand,
      order_id,
    });
  });

  await audit({
    business: brand,
    user_id: user && user.user_id,
    action_key: "sales.order.preorder_arrival_notified",
    target_type: "sales_order",
    target_id: order_id,
    after: { to, order_number: order.order_number },
    request_id: null,
  }).catch(() => {});

  logger.info(
    { brand, order_id, to },
    "preorder arrival email sent to customer",
  );

  return { sent: true, to, notified_at };
}

module.exports = { notifyPreorderArrival };
