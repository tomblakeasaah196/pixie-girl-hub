/**
 * Order-lifecycle customer comms — the honest reframe (2026-07-23 session).
 *
 * Two outbox consumers, two very different moments:
 *
 *   order.created → 'order_placement' automation. Nothing has been paid
 *     yet — every order is created pending_payment regardless of channel —
 *     so this raises the proforma (draft) invoice + its permanent "pay any
 *     amount, anytime" link, attaches the invoice PDF (email) or a view
 *     link (WhatsApp/Instagram — no file-attachment support on either), and
 *     acknowledges the ORDER REQUEST. It never claims payment was received.
 *
 *   order.paid → 'order_paid_confirmation' automation. The genuine payment
 *     confirmation — gated to the real order.paid event (gateway webhook or
 *     a full manual settlement), never at placement.
 *
 * This replaces src/services/order-confirmation-email.js, which fired at
 * order.created but unconditionally said "we've received your payment...
 * it's now confirmed" — true for nobody at that moment. Copy for both
 * messages lives in the Communications Studio (seeded by migration 000366)
 * so the CEO can edit either without a deploy.
 */

"use strict";

const outbox = require("../../shared/outbox/outbox");
const salesRepo = require("./sales.repo");
const brandUrls = require("../../utils/brand-urls");
const invoicingService = require("../invoicing/invoicing.service");
const invoiceDelivery = require("../invoicing/invoice-delivery.service");
const commsStudio = require("../comms_studio/comms-studio.service");
const paidCurrency = require("./paid-currency");
const { logger } = require("../../config/logger");

const ngn = (v) =>
  `₦${Number(v || 0).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** "Classic Full Frontal Spicy Copper" for one line, "X + N more" for several. */
function itemNameFor(order) {
  const lines = order.lines || [];
  if (!lines.length) return "your selection";
  const first = lines[0].product_name_snapshot || "your selection";
  return lines.length > 1 ? `${first} + ${lines.length - 1} more` : first;
}

async function onOrderCreated({ brand, order_id }) {
  const order = await salesRepo.findById({ brand, id: order_id });
  if (!order || !order.contact_id) return;

  // Raise the proforma invoice for this order (idempotent — a re-delivered
  // event finds the same draft rather than creating a second one). Best-
  // effort: a render/DB hiccup here must not sink the acknowledgment — the
  // customer still hears from us, just without the PDF this one time.
  let invoice = null;
  try {
    invoice = await invoicingService.createDraftFromOrder({
      brand,
      order,
      user_id: null,
    });
  } catch (err) {
    logger.error(
      { err: err.message, brand, order_id },
      "order-placement: draft invoice creation failed",
    );
  }

  let attachments;
  let invoiceUrl = null;
  if (invoice) {
    invoiceUrl = invoiceDelivery.publicViewUrl(brand, invoice.invoice_id);
    try {
      const stored = await invoicingService.invoicePdf({
        brand,
        user: null,
        id: invoice.invoice_id,
      });
      attachments = [
        {
          filename: `${stored.title || invoice.invoice_number || "invoice"}.pdf`,
          storage_key: stored.file_path,
          content_type: stored.mime_type || "application/pdf",
        },
      ];
    } catch (err) {
      logger.warn(
        { err: err.message, brand, order_id, invoice_id: invoice.invoice_id },
        "order-placement: invoice PDF render failed — sending without attachment",
      );
    }
  }

  const payUrl = await brandUrls.payLinkUrl(
    brand,
    await salesRepo.ensurePublicTrackingToken({ brand, id: order_id }),
  );

  await commsStudio.dispatch({
    brand,
    event_key: "order_placement",
    contact_id: order.contact_id,
    reference_type: "sales_order",
    reference_id: order_id,
    dedup_key: `order_placement:${order_id}`,
    variables: {
      order_number: order.order_number,
      item_name: itemNameFor(order),
      // A USD order speaks dollars — the figure its checkout charges.
      total: paidCurrency.lockedTotalLabel(order) || ngn(order.total_ngn),
      pay_url: payUrl,
      invoice_url: invoiceUrl || payUrl,
      attachments,
    },
  });
}

async function onOrderPaid({ brand, order_id }) {
  const order = await salesRepo.findById({ brand, id: order_id });
  if (!order || !order.contact_id) return;

  let invoiceUrl = null;
  try {
    const invoice = await invoicingService.findByOrderId({ brand, order_id });
    if (invoice) invoiceUrl = invoiceDelivery.publicViewUrl(brand, invoice.invoice_id);
  } catch (err) {
    logger.warn(
      { err: err.message, brand, order_id },
      "order-paid-confirmation: invoice lookup failed",
    );
  }

  // What the customer actually parted with: the dollars received for a USD
  // order paid in dollars, never the Naira credit the books carry.
  let total = ngn(order.total_ngn);
  try {
    const payments = await salesRepo.listPayments({ brand, order_id });
    total = paidCurrency.paidTotalLabel(order, payments) || total;
  } catch (err) {
    logger.warn(
      { err: err.message, brand, order_id },
      "order-paid-confirmation: payment lookup failed — quoting the Naira total",
    );
  }

  await commsStudio.dispatch({
    brand,
    event_key: "order_paid_confirmation",
    contact_id: order.contact_id,
    reference_type: "sales_order",
    reference_id: order_id,
    dedup_key: `order_paid_confirmation:${order_id}`,
    variables: {
      order_number: order.order_number,
      total,
      invoice_url: invoiceUrl || "",
    },
  });
}

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  outbox.register("order.created", "order-placement-comms", onOrderCreated);
  outbox.register("order.paid", "order-paid-confirmation-comms", onOrderPaid);
  logger.info(
    "order-lifecycle comms subscribers registered (order.created → order_placement; order.paid → order_paid_confirmation)",
  );
}

register();

module.exports = { register, onOrderCreated, onOrderPaid };
