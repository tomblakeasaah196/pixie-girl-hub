/**
 * Part-payment comms subscriber (Flexi Pay D15). Consumes the transactional
 * outbox events addPayment enqueues:
 *
 *   order.payment_recorded  → 'payment_received' automation: an instant
 *     receipt for the instalment — amount, running total, balance, and the
 *     customer's permanent pay link.
 *   order.payment_milestone → 'payment_milestone' automation: a one-time
 *     celebration when payments cross 50% (gated by the
 *     milestone_messages_enabled config toggle, read live).
 *
 * Copy lives in the Communications Studio (seeded by migration 000315) so the
 * CEO can edit or disable either message without a deploy. The dispatcher
 * enriches {{first_name}}/{{brand_name}} and dedupes on automation_send_log,
 * so the outbox's at-least-once delivery can never double-send.
 */

"use strict";

const Decimal = require("decimal.js");

const outbox = require("../../shared/outbox/outbox");
const salesRepo = require("./sales.repo");
const paymentSettings = require("./payment-settings.service");
const brandUrls = require("../../utils/brand-urls");
const commsStudio = require("../comms_studio/comms-studio.service");
const paidCurrency = require("./paid-currency");
const { logger } = require("../../config/logger");

const ngn = (v) =>
  "₦" + new Decimal(v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

async function onPaymentRecorded({
  brand,
  order_id,
  contact_id,
  payment_id,
  amount_ngn,
  amount_paid_ngn,
  total_ngn,
}) {
  const order = await salesRepo.findById({ brand, id: order_id });
  if (!order || !contact_id) return;
  const settings = await paymentSettings.getSettings(brand);
  const payUrl = await brandUrls.payLinkUrl(
    brand,
    await salesRepo.ensurePublicTrackingToken({ brand, id: order_id }),
  );
  const balance = new Decimal(total_ngn || 0).minus(
    new Decimal(amount_paid_ngn || 0),
  );
  const figures = {
    amount: ngn(amount_ngn),
    paid_total: ngn(amount_paid_ngn),
    balance: ngn(balance.lt(0) ? 0 : balance),
  };
  Object.assign(
    figures,
    await paidCurrencyFigures({ brand, order, payment_id }),
  );
  await commsStudio.dispatch({
    brand,
    event_key: "payment_received",
    contact_id,
    reference_type: "sales_order",
    reference_id: order_id,
    dedup_key: `payment_received:${payment_id}`,
    variables: {
      order_number: order.order_number,
      ...figures,
      pay_url: payUrl,
      plan_name: settings.plan_display_name,
    },
  });
}

/**
 * The same three figures in the currency the customer pays in. A USD order
 * (short-paid through Nomba, or on a dollar instalment plan) must hear
 * "we received $150.00 — balance $99.99", with the pay link charging exactly
 * that balance; the Naira credit is the books' figure, not hers.
 *   amount     — this payment as paid ("$150.00")
 *   paid_total — every payment so far, when all were in that currency
 *   balance    — the order's dollar balance (what its pay page shows)
 * Returns {} for a Naira order so the Naira figures stand. Never throws.
 */
async function paidCurrencyFigures({ brand, order, payment_id }) {
  try {
    const locked = paidCurrency.lockedTotalLabel(order);
    const payments = await salesRepo.listPayments({
      brand,
      order_id: order.order_id,
    });
    const payment = payments.find((p) => p.payment_id === payment_id);
    const out = {};
    if (payment && String(payment.paid_currency || "NGN").toUpperCase() !== "NGN")
      out.amount = paidCurrency.paymentAmountLabel(payment);
    const paid = paidCurrency.paidCurrencyDisplay(payments);
    if (paid)
      out.paid_total = paidCurrency.formatMoney(
        paid.display_amount,
        paid.display_currency,
      );
    if (locked) {
      const paymentLink = require("./payment-link.service");
      const usd = paymentLink.outstandingUsd(order);
      if (usd !== null) out.balance = paidCurrency.formatMoney(usd, "USD");
    }
    return out;
  } catch (err) {
    logger.warn(
      { err: err.message, brand, order_id: order.order_id },
      "payment-comms: paid-currency figures unavailable — sending Naira",
    );
    return {};
  }
}

async function onPaymentMilestone({
  brand,
  order_id,
  contact_id,
  milestone,
  amount_paid_ngn,
  total_ngn,
}) {
  if (!contact_id) return;
  const settings = await paymentSettings.getSettings(brand);
  if (settings.milestone_messages_enabled === false) return;
  const order = await salesRepo.findById({ brand, id: order_id });
  if (!order) return;
  const payUrl = await brandUrls.payLinkUrl(
    brand,
    await salesRepo.ensurePublicTrackingToken({ brand, id: order_id }),
  );
  const balance = new Decimal(total_ngn || 0).minus(
    new Decimal(amount_paid_ngn || 0),
  );
  const { paid_total, balance: owed } = await paidCurrencyFigures({
    brand,
    order,
    payment_id: null,
  });
  await commsStudio.dispatch({
    brand,
    event_key: "payment_milestone",
    contact_id,
    reference_type: "sales_order",
    reference_id: order_id,
    dedup_key: `payment_milestone:${order_id}:${milestone || "half"}`,
    variables: {
      order_number: order.order_number,
      paid_total: paid_total || ngn(amount_paid_ngn),
      balance: owed || ngn(balance.lt(0) ? 0 : balance),
      pay_url: payUrl,
      plan_name: settings.plan_display_name,
    },
  });
}

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  outbox.register("order.payment_recorded", "payment-comms", onPaymentRecorded);
  outbox.register(
    "order.payment_milestone",
    "payment-comms-milestone",
    onPaymentMilestone,
  );
  logger.info(
    "payment comms subscribers registered (outbox order.payment_recorded/_milestone → Comms Studio)",
  );
}

register();

module.exports = { register, onPaymentRecorded, onPaymentMilestone };
