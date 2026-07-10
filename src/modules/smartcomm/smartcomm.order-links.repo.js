/**
 * Order-link persistence (shared.smartcomm_order_links) + service
 * booking requests (shared.service_booking_requests).
 *
 * The universal order link is a DB row + a signed JWT carrying its
 * link_id. The row is what makes links single-use ("ordered" links show
 * the order status instead of a dead page), and what feeds the
 * customer-activity panel (opened / cart / ordered) in the thread
 * sidebar. Parameterised SQL only — callers own transactions.
 */

"use strict";

const { query } = require("../../config/database");

const ex = (client) => (client ? client.query.bind(client) : query);

async function createOrderLink({ client, link }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.smartcomm_order_links
       (business, channel_id, contact_id, created_by, mode, sales_channel,
        items, notes, expires_at)
     VALUES ($1,$2,$3,$4,COALESCE($5,'capture'),COALESCE($6,'whatsapp'),
             $7::jsonb,$8,$9)
     RETURNING *`,
    [
      link.business,
      link.channel_id || null,
      link.contact_id || null,
      link.created_by,
      link.mode || null,
      link.sales_channel || null,
      JSON.stringify(link.items || []),
      link.notes || null,
      link.expires_at,
    ],
  );
  return rows[0];
}

async function getOrderLink({ client, link_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.smartcomm_order_links WHERE link_id = $1`,
    [link_id],
  );
  return rows[0] || null;
}

/**
 * Record an open. Returns the updated row plus `first_open` so the
 * caller knows whether to drop the "customer opened your link" line in
 * the thread (once per link, not per refresh).
 */
async function recordOpen({ client, link_id }) {
  const { rows } = await ex(client)(
    `UPDATE shared.smartcomm_order_links
        SET opened_count = opened_count + 1,
            opened_at    = COALESCE(opened_at, now())
      WHERE link_id = $1
      RETURNING *, (opened_count = 1) AS first_open`,
    [link_id],
  );
  return rows[0] || null;
}

/**
 * Save the customer's current selection. Returns `notify` = true when
 * the throttled "customer selected items" thread message is due (first
 * cart change, then at most once per hour).
 */
async function updateCart({ client, link_id, cart }) {
  const { rows } = await ex(client)(
    `UPDATE shared.smartcomm_order_links
        SET cart = $2::jsonb,
            cart_updated_at = now(),
            last_activity_message_at = CASE
              WHEN last_activity_message_at IS NULL
                OR last_activity_message_at < now() - interval '1 hour'
              THEN now() ELSE last_activity_message_at END
      WHERE link_id = $1 AND status = 'active'
      RETURNING *, (last_activity_message_at = now()) AS notify`,
    [link_id, JSON.stringify(cart || [])],
  );
  return rows[0] || null;
}

/** Flip a link to 'ordered' (single-use: only an active link flips). */
async function markOrdered({ client, link_id, order_id, order_number, contact_id }) {
  const { rows } = await ex(client)(
    `UPDATE shared.smartcomm_order_links
        SET status = 'ordered',
            order_id = $2,
            order_number = $3,
            contact_id = COALESCE(contact_id, $4),
            ordered_at = now()
      WHERE link_id = $1 AND status = 'active'
      RETURNING *`,
    [link_id, order_id || null, order_number || null, contact_id || null],
  );
  return rows[0] || null;
}

/** Sidebar panel: a channel's links, newest first, with booking counts. */
async function listForChannel({ client, channel_id, limit = 10 }) {
  const { rows } = await ex(client)(
    `SELECT l.*,
            (SELECT COUNT(*)::int FROM shared.service_booking_requests b
              WHERE b.link_id = l.link_id) AS booking_count
       FROM shared.smartcomm_order_links l
      WHERE l.channel_id = $1
      ORDER BY l.created_at DESC
      LIMIT $2`,
    [channel_id, limit],
  );
  return rows;
}

async function createBookingRequest({ client, booking }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.service_booking_requests
       (business, link_id, channel_id, contact_id, service_id, order_id,
        qty, price_ngn, requested_for, note)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,1),$8,$9,$10)
     RETURNING *`,
    [
      booking.business,
      booking.link_id || null,
      booking.channel_id || null,
      booking.contact_id || null,
      booking.service_id,
      booking.order_id || null,
      booking.qty || null,
      booking.price_ngn || null,
      booking.requested_for || null,
      booking.note || null,
    ],
  );
  return rows[0];
}

module.exports = {
  createOrderLink,
  getOrderLink,
  recordOpen,
  updateCart,
  markOrdered,
  listForChannel,
  createBookingRequest,
};
