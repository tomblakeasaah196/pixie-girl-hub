/**
 * Order-link lifecycle + customer-activity glue.
 *
 * Owner decision (2026-07-10, visibility level "c"): staff see what the
 * customer does with an order link — opened (once), selection changes
 * (throttled to one thread line per hour; the sidebar panel is always
 * live), and the placed order — as system lines in the originating
 * thread, fanned out over the existing smartcomm realtime bridge.
 *
 * Public callers (the /order/capture page) are token-authenticated: the
 * signed JWT carries the link_id, so a forged id never reaches these
 * functions. Everything here is best-effort from the customer's point
 * of view — a failed system message must never break their checkout.
 */

"use strict";

const repo = require("./smartcomm.order-links.repo");
const smartcommRepo = require("./smartcomm.repo");
const events = require("./smartcomm.events");
const { query } = require("../../config/database");
const { logger } = require("../../config/logger");

function ngn(v) {
  const n = Number(v || 0);
  return `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function postSystemLine({ business, channel_id, content, client }) {
  if (!channel_id) return;
  try {
    const msg = await smartcommRepo.insertMessage({
      client,
      message: { channel_id, message_type: "system", content },
    });
    events.emit("message.posted", {
      brand: business,
      channel_id,
      message_id: msg.message_id,
    });
  } catch (err) {
    logger.warn(
      { err: err.message, channel_id },
      "order-link: system line failed (ignored)",
    );
  }
}

async function customerLabel(link) {
  if (!link.contact_id) return "The customer";
  try {
    const { rows } = await query(
      `SELECT display_name, first_name FROM shared.contacts WHERE contact_id = $1`,
      [link.contact_id],
    );
    return rows[0]?.first_name || rows[0]?.display_name || "The customer";
  } catch {
    return "The customer";
  }
}

/** First open drops a line in the thread; refreshes only bump counters. */
async function recordOpen({ link_id }) {
  const link = await repo.recordOpen({ link_id });
  if (!link) return null;
  if (link.first_open) {
    const who = await customerLabel(link);
    await postSystemLine({
      business: link.business,
      channel_id: link.channel_id,
      content: `👀 ${who} opened your ${link.mode === "shop" ? "catalogue" : "order"} link.`,
    });
    emitActivity(link);
  }
  return link;
}

/**
 * Save the live selection. The sidebar panel updates on every call (via
 * the socket event); the thread only gets a line when the hourly
 * throttle allows, so browsing never floods the conversation.
 */
async function recordCart({ link_id, cart }) {
  const link = await repo.updateCart({ link_id, cart });
  if (!link) return null;
  emitActivity(link);
  if (link.notify && Array.isArray(cart) && cart.length > 0) {
    const who = await customerLabel(link);
    const summary = cart
      .slice(0, 4)
      .map((c) => `${c.qty}× ${c.name || c.kind}`)
      .join(", ");
    const more = cart.length > 4 ? ` +${cart.length - 4} more` : "";
    await postSystemLine({
      business: link.business,
      channel_id: link.channel_id,
      content: `🛍️ ${who} is picking items: ${summary}${more}.`,
    });
  }
  return link;
}

/**
 * Called by the storefront order-form inside its transaction once the
 * order exists. Flips the link to 'ordered' (single-use), back-fills
 * the contact, files service booking requests, and announces the order
 * in the thread. Passing `client` keeps it atomic with the order.
 */
async function completeOrder({
  client,
  link_id,
  order_id,
  order_number,
  total_ngn,
  contact_id,
  bookings = [],
}) {
  const link = await repo.markOrdered({
    client,
    link_id,
    order_id,
    order_number,
    contact_id,
  });
  if (!link) return null; // already ordered/expired — never double-fire

  const bookingRows = [];
  for (const b of bookings) {
    bookingRows.push(
      await repo.createBookingRequest({
        client,
        booking: {
          business: link.business,
          link_id: link.link_id,
          channel_id: link.channel_id,
          contact_id: contact_id || link.contact_id,
          service_id: b.service_id,
          order_id: order_id || null,
          qty: b.qty,
          price_ngn: b.price_ngn,
          requested_for: b.requested_for,
          note: b.note,
        },
      }),
    );
  }

  const who = await customerLabel({ ...link, contact_id: contact_id || link.contact_id });
  const bits = [];
  if (order_number) {
    bits.push(
      `🛒 ${who} placed order ${order_number}${total_ngn ? ` — ${ngn(total_ngn)}` : ""}.`,
    );
  }
  if (bookingRows.length) {
    const when = bookings[0]?.requested_for
      ? ` (requested for ${new Date(bookings[0].requested_for).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })})`
      : "";
    bits.push(
      `💇 ${who} requested ${bookingRows.length} service booking${bookingRows.length === 1 ? "" : "s"}${when} — confirm from the thread.`,
    );
  }
  if (bits.length) {
    await postSystemLine({
      business: link.business,
      channel_id: link.channel_id,
      content: bits.join("\n"),
      client,
    });
  }
  emitActivity({ ...link, status: "ordered", order_number });
  return { link, bookings: bookingRows };
}

/** Socket ping so the sidebar's activity panel refetches. */
function emitActivity(link) {
  events.emit("order_link.activity", {
    brand: link.business,
    channel_id: link.channel_id,
    link_id: link.link_id,
    status: link.status,
  });
}

async function listForChannel({ channel_id, limit }) {
  return repo.listForChannel({ channel_id, limit });
}

module.exports = { recordOpen, recordCart, completeOrder, listForChannel };
