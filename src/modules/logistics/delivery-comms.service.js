/**
 * Delivery → customer comms. The part that tells the customer a courier is
 * actually coming, and the ledger that proves it went out.
 *
 * Booking a courier used to be silent: Logistics wrote the shipper, the
 * waybill, the pickup window and the rider's phone number onto the delivery,
 * and the customer heard nothing until the parcel physically moved
 * (`picked_up` → `order_shipped`). This module fires at booking time with the
 * shipment facts, so "who has my order and when does it arrive?" is answered
 * before anyone has to ask.
 *
 * Two rules it inherits from the rest of the Hub:
 *
 *   • Every send goes through commsStudio.dispatch, so the CEO's Messaging
 *     settings are authoritative — an automation toggled Off never sends, and
 *     the channel (email / WhatsApp / IG) is whatever the operator picked.
 *     Nothing here calls email.send or whatsapp.sendText directly.
 *
 *   • Every attempt is written to `shared.outbound_comms_log` against the
 *     delivery (reference_type 'delivery'), so the delivery's own screen can
 *     answer "was it sent, did it land, did she open it?" — the same question
 *     the invoice and receipt screens answer, from the same ledger.
 *
 * Honest signals, in decreasing order of confidence:
 *   sent      — the provider accepted it (SMTP handoff / WhatsApp API 200).
 *   delivered — WhatsApp/IG only, from the provider's own receipt.
 *   opened    — the customer loaded the tracking link (stamped once, in
 *               `logistics.service.trackByToken`). On plain SMTP this is the
 *               only truthful "she saw it", so we never infer it from a send.
 *
 * Best-effort by contract: nothing in here throws. A comms hiccup must never
 * roll back — or appear to fail — the booking that has already been committed.
 */

"use strict";

const commsStudio = require("../comms_studio/comms-studio.service");
const commsLog = require("../../services/comms-log.service");
const brandUrls = require("../../utils/brand-urls");
const { formatDate, formatDateTime } = require("../../utils/dates");
const { logger } = require("../../config/logger");
const repo = require("./logistics.repo");

const REFERENCE_TYPE = "delivery";
const EVENT_BOOKED = "delivery_booked";
const EVENT_DELIVERED = "delivery_delivered";

/** Escape a value destined for the HTML body of an email block. */
function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[ch],
  );
}

/**
 * The customer-facing tracking page for this delivery.
 *
 * Prefers the order's public tracking token (`/track/{token}` — the storefront
 * page that already renders the live order timeline), falling back to the
 * delivery's own denormalised copy of the same token, then to the brand's
 * home page. Never throws: a URL lookup failure degrades to '' and the block
 * compiler collapses the empty token rather than emitting a broken link.
 */
async function trackingUrl(brand, ctx) {
  try {
    const token = ctx.order_tracking_token || ctx.public_tracking_token;
    if (token) {
      const base = await brandUrls.publicBaseUrl(brand);
      return base ? `${base}/track/${token}` : "";
    }
    return (await brandUrls.publicBaseUrl(brand)) || "";
  } catch {
    return "";
  }
}

/**
 * Turn the booking facts into the tokens the Studio template renders.
 *
 * Every line is conditional: a walk-in with no waybill, no ETA and no named
 * rider still produces a clean message rather than a wall of "—". The HTML and
 * the plain-text variants carry the SAME facts so an operator who switches the
 * automation to WhatsApp doesn't silently lose the shipment details.
 *
 * Exported for unit testing — this is where a wrong or missing detail would
 * reach the customer.
 *
 * @param {object} a
 * @param {object} a.ctx            repo.getNotificationContext row
 * @param {string} a.tracking_url   customer-facing tracking page
 * @returns {object} token map for commsStudio.dispatch
 */
function buildBookedVariables({ ctx, tracking_url }) {
  const courierName = ctx.courier_name || "our courier";
  const trackingRef = ctx.courier_tracking_ref || "";
  const expectedText = ctx.expected_delivery_at
    ? formatDate(ctx.expected_delivery_at)
    : "";
  const pickupText = ctx.scheduled_pickup_at
    ? formatDateTime(ctx.scheduled_pickup_at)
    : "";
  const driverText = ctx.driver_name
    ? `${ctx.driver_name}${ctx.driver_phone ? ` · ${ctx.driver_phone}` : ""}`
    : "";

  // Detail lines, HTML and plain text from one list so the two can't drift.
  const details = [
    ["Shipper", courierName],
    ["Waybill / tracking", trackingRef],
    ["Pickup", pickupText],
    ["Expected delivery", expectedText],
    ["Rider", driverText],
  ].filter(([, value]) => value);

  const shipment_details_html = details
    .map(([label, value]) => `<strong>${esc(label)}:</strong> ${esc(value)}`)
    .join("<br/>");
  const shipment_details_text = details.length
    ? ` ${details.map(([label, value]) => `${label}: ${value}`).join(". ")}.`
    : "";

  // The courier's own portal, when the agency gave us one. Secondary to the
  // brand's tracking page on purpose — that page is what stamps "opened".
  const courier_tracking_html = ctx.courier_tracking_url
    ? `Track directly with ${esc(courierName)}: <a href="${esc(ctx.courier_tracking_url)}">${esc(ctx.courier_tracking_url)}</a>`
    : "";

  return {
    order_number: ctx.order_number || ctx.delivery_number || "",
    delivery_number: ctx.delivery_number || "",
    courier_name: courierName,
    courier_phone: ctx.courier_phone || "",
    tracking_ref: trackingRef,
    expected_delivery_text: expectedText,
    pickup_text: pickupText,
    driver_text: driverText,
    shipment_details_html,
    shipment_details_text,
    courier_tracking_html,
    courier_tracking_url: ctx.courier_tracking_url || "",
    tracking_url,
    // first_name is filled from the contact by the dispatcher when absent; the
    // delivery's recipient snapshot wins when the parcel goes to someone else.
    first_name:
      String(ctx.recipient_name_snapshot || ctx.contact_first_name || "")
        .trim()
        .split(/\s+/)[0] || undefined,
  };
}

/** Write one attempt onto the delivery's comms ledger. Never throws. */
function record({ brand, ctx, channel, status, recipient, subject, error, event_key }) {
  return commsLog
    .record({
      business: brand,
      contact_id: ctx.contact_id,
      channel: channel || "email",
      event_key,
      recipient: recipient || null,
      subject: subject || null,
      status,
      error: error || null,
      reference_type: REFERENCE_TYPE,
      reference_id: ctx.delivery_id,
    })
    .catch(() => {});
}

/**
 * Tell the customer their delivery is booked, with the shipper's details.
 *
 * @param {object} a
 * @param {string} a.brand
 * @param {string} a.delivery_id
 * @param {boolean} [a.manual]  staff pressed "Send now" — bypasses the dedup
 *                              slot so a resend after fixing a typo'd waybill
 *                              actually goes out.
 * @returns {Promise<{sent: boolean, channel?: string, recipient?: string, reason?: string}>}
 */
async function sendBookedNotice({ brand, delivery_id, manual = false }) {
  try {
    const ctx = await repo.getNotificationContext({
      client: null,
      brand,
      delivery_id,
    });
    if (!ctx) return { sent: false, reason: "delivery_not_found" };
    if (!ctx.contact_id) {
      // Stock transfers and intercompany moves have no customer to tell.
      return { sent: false, reason: "no_customer_on_delivery" };
    }

    const tracking_url = await trackingUrl(brand, ctx);
    const variables = buildBookedVariables({ ctx, tracking_url });

    // One notice per delivery — an at-least-once retry of the booking is a
    // silent no-op. A manual resend deliberately claims a fresh slot.
    const dedup_key = manual
      ? `${EVENT_BOOKED}:${delivery_id}:manual:${Date.now()}`
      : `${EVENT_BOOKED}:${delivery_id}`;

    const result = await commsStudio.dispatch({
      brand,
      event_key: EVENT_BOOKED,
      contact_id: ctx.contact_id,
      reference_type: REFERENCE_TYPE,
      reference_id: delivery_id,
      dedup_key,
      variables,
    });

    const subject = `Delivery ${ctx.delivery_number || ""} booked`;
    if (result.dispatched) {
      if (result.channel === "email") {
        // Email rides the durable queue: record the handoff now so the panel
        // shows the send the instant the operator books, and let the
        // email-send processor append the terminal sent/failed row when SMTP
        // has actually accepted it. That second row is the honest 'sent'.
        record({
          brand,
          ctx,
          channel: "email",
          status: "queued",
          recipient: ctx.contact_email,
          subject,
          event_key: EVENT_BOOKED,
        });
      } else {
        // WhatsApp/IG ride the smartcomm mirror, which the dispatcher does not
        // log — record those here so the ledger is complete whichever channel
        // the CEO picked in the Studio.
        record({
          brand,
          ctx,
          channel: result.channel,
          status: "sent",
          recipient: ctx.recipient_phone_snapshot || null,
          subject,
          event_key: EVENT_BOOKED,
        });
      }
      return {
        sent: true,
        channel: result.channel,
        recipient:
          result.channel === "email"
            ? ctx.contact_email
            : ctx.recipient_phone_snapshot || undefined,
      };
    }

    // Not dispatched. A duplicate is a success from the operator's point of
    // view (the customer already has the notice); everything else is a real
    // miss and belongs on the ledger so staff can see WHY nothing went out.
    if (result.duplicate) {
      return { sent: false, reason: "already_sent", duplicate: true };
    }
    record({
      brand,
      ctx,
      channel: result.channel || "email",
      status: "failed",
      recipient: ctx.contact_email || ctx.recipient_phone_snapshot || null,
      subject,
      error: result.reason || "not_dispatched",
      event_key: EVENT_BOOKED,
    });
    return { sent: false, reason: result.reason || "not_dispatched" };
  } catch (err) {
    logger.error(
      { err: err.message, brand, delivery_id },
      "logistics: delivery-booked notice failed",
    );
    return { sent: false, reason: "send_failed" };
  }
}

/**
 * "Was it sent, did it land, did she open it?" for one delivery: the full
 * outbound ledger for this delivery plus the three stepper stamps derived
 * from it. Read-only; safe to poll.
 *
 * No brand argument: the ledger is keyed on the delivery's own UUID, which is
 * already unique across both schemas — and the caller has resolved the brand
 * before it gets here.
 */
async function getCommsView({ delivery_id }) {
  const history = await commsLog.listForReference({
    reference_type: REFERENCE_TYPE,
    reference_id: delivery_id,
  });
  // listForReference returns newest-first; the stamps want the FIRST time each
  // stage was reached, so scan from the oldest end.
  const oldestFirst = [...history].reverse();
  const firstWith = (...statuses) =>
    oldestFirst.find((h) => statuses.includes(h.status)) || null;

  const sentRow = firstWith("sent", "delivered", "opened");
  const deliveredRow = firstWith("delivered", "opened");
  const openedRow = firstWith("opened");
  const bookedRow =
    oldestFirst.find(
      (h) => h.event_key === EVENT_BOOKED && h.status === "sent",
    ) || null;

  return {
    delivery_id,
    // Stepper stamps.
    sent_at: sentRow ? sentRow.created_at : null,
    sent_via: sentRow ? sentRow.channel : null,
    delivered_at: deliveredRow ? deliveredRow.created_at : null,
    first_viewed_at: openedRow ? openedRow.created_at : null,
    // Did the booking notice specifically go out? (The ledger also carries the
    // delivered-confirmation, so "something was sent" isn't the same question.)
    booked_notice_sent_at: bookedRow ? bookedRow.created_at : null,
    booked_notice_via: bookedRow ? bookedRow.channel : null,
    history,
  };
}

/**
 * Stamp "the customer opened her tracking link" exactly once per delivery.
 * Called from the public tracking endpoint, which the storefront page polls —
 * hence the guard, or a single visit would write a row every 20 seconds.
 */
async function markTrackingOpened({ brand, delivery, contact_id }) {
  try {
    const already = await commsLog.hasStatus({
      reference_type: REFERENCE_TYPE,
      reference_id: delivery.delivery_id,
      status: "opened",
    });
    if (already) return;
    await commsLog.record({
      business: brand,
      contact_id: contact_id || null,
      channel: "email",
      event_key: "delivery.tracking_opened",
      recipient: null,
      subject: `Delivery ${delivery.delivery_number || ""} tracking opened`,
      status: "opened",
      reference_type: REFERENCE_TYPE,
      reference_id: delivery.delivery_id,
    });
  } catch (err) {
    logger.warn(
      { err: err.message, delivery_id: delivery && delivery.delivery_id },
      "logistics: tracking-open stamp failed",
    );
  }
}

module.exports = {
  REFERENCE_TYPE,
  EVENT_BOOKED,
  EVENT_DELIVERED,
  buildBookedVariables,
  sendBookedNotice,
  getCommsView,
  markTrackingOpened,
  record,
};
