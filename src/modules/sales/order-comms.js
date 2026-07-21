/**
 * Order-stage customer comms — one place that turns a fulfilment milestone into
 * the matching Communications Studio automation. QC pass (order_ready), the
 * courier hand-off (order_shipped), out-for-delivery and delivery-failed all
 * funnel through here.
 *
 * Every send goes through commsStudio.dispatch, so the CEO's Messaging-settings
 * choice is honoured: an automation toggled Off never sends, and the channel
 * (email / WhatsApp / IG) is whatever the operator picked. Each call is
 * best-effort and idempotent (dedup key = event:order_id) — a comms hiccup, or
 * an at-least-once redelivery of the driving event, must never block or double
 * a fulfilment transition.
 */

"use strict";

const commsStudio = require("../comms_studio/comms-studio.service");
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

/** Dispatch one stage automation for an order. Never throws. */
async function send({ brand, order, event_key, extraVars = {} }) {
  try {
    if (!order || !order.contact_id) return;
    const tracking_url = await trackingUrl(brand, order);
    await commsStudio.dispatch({
      brand,
      event_key,
      contact_id: order.contact_id,
      reference_type: "sales_order",
      reference_id: order.order_id,
      dedup_key: `${event_key}:${order.order_id}`,
      variables: {
        order_number: order.order_number,
        tracking_url,
        ...extraVars,
      },
    });
  } catch (err) {
    logger.warn(
      { err: err.message, brand, order_id: order && order.order_id, event_key },
      "order-comms: stage dispatch failed",
    );
  }
}

// "Packed and ready — final step is dispatch." Fired on QC pass.
const orderReady = ({ brand, order }) =>
  send({ brand, order, event_key: "order_ready" });

// "On its way." Fired ONLY on the real courier hand-off — never at QC/packed.
const orderShipped = ({ brand, order }) =>
  send({ brand, order, event_key: "order_shipped" });

// "Coming today." Fired when the courier marks the delivery out for delivery.
const outForDelivery = ({ brand, order }) =>
  send({ brand, order, event_key: "out_for_delivery" });

// "We missed you — reschedule." Fired on a failed delivery attempt.
const deliveryFailed = ({ brand, order }) =>
  send({ brand, order, event_key: "delivery_failed" });

/**
 * The single source of truth for which manual fulfilment move fires which
 * customer automation. `sales.service.setOrderStatus` dispatches from this map,
 * and the order-status impact modal reads the live on/off state of the very
 * same event_keys — so "what the modal promises" and "what actually sends" can
 * never drift. A stage not listed here sends nothing on a manual move.
 */
const MANUAL_STATUS_EVENT = Object.freeze({
  order_ready: "order_ready",
  dispatched: "order_shipped",
});

/** Fire the automation for a manual fulfilment move, if the stage has one. */
async function forStatus({ brand, order, status }) {
  const event_key = MANUAL_STATUS_EVENT[status];
  if (!event_key) return;
  await send({ brand, order, event_key });
}

module.exports = {
  orderReady,
  orderShipped,
  outForDelivery,
  deliveryFailed,
  MANUAL_STATUS_EVENT,
  forStatus,
};
