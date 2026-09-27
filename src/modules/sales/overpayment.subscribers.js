/**
 * Overpayment alert — somebody has to decide what happens to a customer's
 * money when they paid more than the order costs.
 *
 * addPayment records every captured payment in full (the gateway already has
 * the money, and for a USD capture the dollars are sitting in the Nomba USD
 * wallet). When a payment takes an order above its total, the excess stays in
 * Customer Deposits 2400 as money held for the customer — the same model
 * Change Order uses for a downgrade — and `order.overpaid` is raised. Whether
 * it becomes a refund or credit against their next order is a Finance
 * decision, so this tells the people who can make it (accounting:edit holders
 * and the CEO), in the currency the customer paid.
 *
 * Durable (outbox, post-commit, deduped per payment) and best-effort: an alert
 * failure is logged, never thrown — the payment and the credit balance on the
 * order are the system of record.
 */

"use strict";

const outbox = require("../../shared/outbox/outbox");
const salesRepo = require("./sales.repo");
const grantsRepo = require("../../shared/access/grants.repo");
const notifications = require("../../services/notifications.service");
const paidCurrency = require("./paid-currency");
const { money } = require("../../utils/money");
const Decimal = require("decimal.js");
const { logger } = require("../../config/logger");

/**
 * "$10.00 (₦15,000.00)" for a USD-locked order, "₦15,000.00" otherwise. The
 * dollar figure is the Naira excess at the order's own locked rate — the rate
 * every dollar on it was credited at.
 */
function excessLabel(order, overpaid_ngn) {
  const ngnLabel = paidCurrency.formatMoney(overpaid_ngn, "NGN");
  if (!paidCurrency.lockedTotalLabel(order)) return ngnLabel;
  const usd = money(overpaid_ngn)
    .dividedBy(money(order.fx_rate_used))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  return `${paidCurrency.formatMoney(usd, order.display_currency)} (${ngnLabel})`;
}

async function onOrderOverpaid({ brand, order_id, order_number, overpaid_ngn }) {
  if (!brand || !order_id || !overpaid_ngn) return;
  try {
    const order = await salesRepo.findById({ brand, id: order_id });
    if (!order) return;
    const label = excessLabel(order, overpaid_ngn);
    const number = order.order_number || order_number || "An order";
    const recipients = await grantsRepo.listUsersWithPermission({
      business: brand,
      module: "accounting",
      action: "edit",
    });
    await Promise.all(
      recipients.map((r) =>
        notifications
          .notify({
            user_id: r.user_id,
            business: brand,
            type: "order_overpaid",
            priority: "high",
            title: `Overpayment on ${number}`,
            body: `The customer has paid ${label} more than the order total. It is held for them in Customer Deposits — refund it, or keep it as credit for their next order.`,
            reference_type: "sales_order",
            reference_id: order_id,
            action_url: `/sales/orders/${order_id}`,
          })
          .catch((err) =>
            logger.error(
              { err: err.message, order_id, user_id: r.user_id },
              "overpayment: notify failed",
            ),
          ),
      ),
    );
    logger.warn(
      { brand, order_id, overpaid_ngn, notified: recipients.length },
      "order overpaid — finance notified",
    );
  } catch (err) {
    logger.error(
      { err: err.message, brand, order_id },
      "overpayment alert failed",
    );
  }
}

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  outbox.register("order.overpaid", "overpayment-alert", onOrderOverpaid);
  logger.info(
    "overpayment subscriber registered (outbox order.overpaid → finance notification)",
  );
}

register();

module.exports = { register, onOrderOverpaid, excessLabel };
