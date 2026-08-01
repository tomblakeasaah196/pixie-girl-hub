/**
 * Logistics subscriber (G-2) — auto-create a delivery when a dispatch order is
 * PAID (PRD §6.10). Driven by the transactional outbox (H-2): runs post-commit
 * with at-least-once delivery. Idempotent: `createForOrder` no-ops for
 * non-dispatch orders, missing address/courier, or an order that already has a
 * delivery. Best-effort — a failure is logged and swallowed (the row's other
 * consumers are unaffected; a missed dispatch is recoverable manually).
 *
 * PREPAID-ONLY (owner directive): the business never ships pay-on-delivery, so
 * a delivery is created ONLY once payment clears (`order.paid`). We deliberately
 * do NOT subscribe to `order.confirmed` — an unpaid order must never enter the
 * dispatch queue.
 */

"use strict";

const outbox = require("../../shared/outbox/outbox");
const salesRepo = require("../sales/sales.repo");
const orderComms = require("../sales/order-comms");
const service = require("./logistics.service");
const events = require("./logistics.events");
const { query } = require("../../config/database");
const { t } = require("../../config/brands");
const { logger } = require("../../config/logger");

async function autoDelivery({ brand, order_id }) {
  try {
    const order = await salesRepo.findById({ brand, id: order_id });
    if (!order) return;
    await service.createForOrder({ brand, order });
  } catch (err) {
    logger.error(
      { err: err.message, brand, order_id },
      "logistics: auto-create delivery on order.paid failed",
    );
  }
}

// Roll a delivery status change up onto its parent sales order + fire the
// matching customer message. Fired identically whether staff advanced the
// status or a driver self-confirmed via the public link (both paths emit the
// same event). All effects are best-effort — a comms or status hiccup must
// never reverse the delivery itself.
//
//   picked_up        → order 'dispatched'  + "Order Shipped"  (the TRUTHFUL
//                      dispatch signal — the courier now physically has it;
//                      this also carries ready-made orders that never hit QC)
//   out_for_delivery → "Out for Delivery"  (order stays 'dispatched')
//   delivered        → order 'completed'   + delivered-confirmation email
//   attempted_failed → "Delivery Failed"   (reschedule prompt)
//
// advanceStatus is guarded, so an out-of-order or redelivered event can never
// rewind an order a human already moved on.
async function onDeliveryStatus({ brand, delivery_id, status }) {
  try {
    if (status === "delivered") {
      // Existing behaviour — delivered-confirmation email (swallows its own errors).
      await service.sendDeliveredEmail({ brand, delivery_id });
    }
    if (
      !["picked_up", "out_for_delivery", "delivered", "attempted_failed"].includes(
        status,
      )
    ) {
      return; // not an order-facing stage
    }
    const { rows } = await query(
      `SELECT order_id FROM ${t(brand, "deliveries")} WHERE delivery_id = $1`,
      [delivery_id],
    );
    const order_id = rows[0] && rows[0].order_id;
    if (!order_id) return; // stock / intercompany transfer — no sales order
    const order = await salesRepo.findById({ brand, id: order_id });
    if (!order) return;

    if (status === "picked_up") {
      await salesRepo.advanceStatus({
        brand,
        id: order_id,
        to: "dispatched",
        from: ["paid", "partially_paid", "assigned", "order_ready"],
      });
      await orderComms.orderShipped({ brand, order });
    } else if (status === "out_for_delivery") {
      await orderComms.outForDelivery({ brand, order });
    } else if (status === "delivered") {
      await salesRepo.advanceStatus({
        brand,
        id: order_id,
        to: "completed",
        from: ["paid", "partially_paid", "assigned", "order_ready", "dispatched"],
      });
    } else if (status === "attempted_failed") {
      await orderComms.deliveryFailed({ brand, order });
    }
  } catch (err) {
    logger.error(
      { err: err.message, brand, delivery_id, status },
      "logistics: delivery.status → order rollup failed",
    );
  }
}

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  // Prepaid-only: a dispatch order enters the queue ONLY once it is paid.
  // (No `order.confirmed` subscription — see the file header.)
  outbox.register("order.paid", "logistics", autoDelivery);
  events.on("delivery.status", onDeliveryStatus);
  logger.info(
    "logistics subscribers registered (outbox order.paid → dispatch delivery; delivery.status → delivered email)",
  );
}

register();

module.exports = { register, autoDelivery };
