/**
 * Somebody has to be told when we take money for hair we don't have.
 *
 * `markPaid` deliberately will not fail a payment over missing stock — the
 * gateway has already taken the customer's money, and throwing there would
 * roll back the whole addPayment transaction and strand the order in
 * pending_payment while the webhook retries forever. So each deduction runs in
 * its own savepoint, and a line that can't be drawn is recorded as a shortfall
 * and the payment proceeds. That is the right call.
 *
 * What was missing is the other half. `order.stock_shortfall` was emitted with
 * NO subscribers: the only trace of "paid, but the stock was never there" was a
 * JSON blob in the order's internal notes and a log line. Nobody was told. The
 * first anyone learned of it was days later, when a stylist couldn't be
 * assigned the hair — the wig genuinely wasn't there, because it never had
 * been.
 *
 * So: notify the people who can act on it, and file it in Kaizen so it shows up
 * on a board somebody actually reads rather than only in an order nobody has
 * a reason to reopen.
 *
 * In-process and best-effort by design (see module-events: soft events, lost on
 * restart). The durable record is the internal note markPaid already wrote —
 * this is the alert on top of it, not the system of record.
 */

"use strict";

const events = require("./sales.events");
const grantsRepo = require("../../shared/access/grants.repo");
const notifications = require("../../services/notifications.service");
const { captureError } = require("../kaizen/errors/errors.capture");
const { logger } = require("../../config/logger");

let registered = false;

async function onStockShortfall(payload) {
  const { brand, order_id, lines } = payload || {};
  if (!brand || !order_id || !Array.isArray(lines) || !lines.length) return;

  const names = lines
    .map((l) => l.name || l.variant_id)
    .filter(Boolean)
    .join(", ");
  const body = `Order was paid but ${lines.length} line${lines.length === 1 ? "" : "s"} could not be drawn from stock: ${names}. Receive the stock, or the styling job for it can't be assigned.`;

  // Put it on the Errors board. This is a real operational fault — we are
  // committed to supplying hair we have no record of holding — and Kaizen is
  // where such things get triaged. `force` because there is no HTTP status
  // here at all, and severity 'warning' because the money is safe; it is the
  // fulfilment that is at risk.
  captureError(
    new Error(`Paid order with stock shortfall — ${names}`),
    null,
    {
      source: "backend",
      severity: "warning",
      force: true,
      context: {
        module: "sales",
        component: "stock shortfall on paid order",
        count: lines.length,
      },
    },
  );

  try {
    // Whoever can move stock is who can fix this. Resolved from the
    // permission rather than a role name, since brands rename roles.
    const recipients = await grantsRepo.listUsersWithPermission({
      business: brand,
      module: "stock",
      action: "edit",
    });
    await Promise.all(
      recipients.map((r) =>
        notifications.notify({
          user_id: r.user_id,
          business: brand,
          type: "order_stock_shortfall",
          title: "Paid order has no stock behind it",
          body,
          priority: "high",
          reference_type: "sales_order",
          reference_id: order_id,
          action_url: `/sales/orders/${order_id}`,
        }),
      ),
    );
    logger.warn(
      { brand, order_id, lines: lines.length, notified: recipients.length },
      "stock shortfall on paid order — ops notified",
    );
  } catch (err) {
    // Never let the alert path break the emitter. The shortfall is already
    // durably on the order; this is the notification on top.
    logger.error({ err, brand, order_id }, "stock shortfall alert failed");
  }
}

function register() {
  if (registered) return;
  registered = true;
  events.on("order.stock_shortfall", onStockShortfall);
  logger.info(
    "sales stock-shortfall subscriber registered (order.stock_shortfall → ops notification + Kaizen)",
  );
}

register();

module.exports = { register, onStockShortfall };
