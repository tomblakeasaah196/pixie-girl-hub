/**
 * Order timeline (F-5 / PD §6.23.6) — the customer-facing order tracker.
 *
 * record(): append a lifecycle event for an order. The event_code must exist in
 * the seeded shared.timeline_event_codes vocabulary; the code supplies the
 * default label + default customer-visibility, both overridable. Optionally
 * idempotent (once_only) for stage events that should appear at most once.
 *
 * Any module (sales, production, logistics, stylist, manual) records via this
 * one path, so the timeline is the single ordered history per order. The public
 * tracker reads only customer-visible events with the sanitised payload.
 */

"use strict";

const { query, transaction } = require("../../config/database");
const repo = require("./timeline.repo");
const { VALID_BRANDS } = require("../../config/brands");
const { NotFoundError, AppError } = require("../../utils/errors");

async function record({
  brand,
  sales_order_id,
  event_code,
  label,
  source_module,
  customer_payload,
  internal_payload,
  is_customer_visible,
  recorded_by,
  occurred_at,
  once_only,
}) {
  const code = await repo.getCode(event_code);
  if (!code)
    throw new AppError(
      "BAD_EVENT_CODE",
      `Unknown timeline event code: ${event_code}`,
      400,
    );

  return transaction(async (client) => {
    if (
      once_only &&
      (await repo.exists({ client, brand, sales_order_id, event_code }))
    ) {
      return null; // already recorded this stage
    }
    return repo.insert({
      client,
      brand,
      event: {
        sales_order_id,
        event_code,
        label: label || code.default_label,
        source_module: source_module || "manual",
        customer_payload,
        internal_payload,
        is_customer_visible:
          is_customer_visible === undefined
            ? code.default_customer_visible
            : is_customer_visible,
        recorded_by,
        occurred_at,
      },
    });
  });
}

const listForOrder = ({ brand, sales_order_id }) =>
  repo.listForOrder({ brand, sales_order_id, customer_only: false });

/**
 * Public tracker: resolve an order by its public_tracking_token across brands,
 * then return only the customer-visible timeline (sanitised payload).
 */
async function getPublicTimeline({ token }) {
  for (const brand of VALID_BRANDS) {
    const { rows } = await query(
      `SELECT order_id, order_number, status
         FROM ${brand}.sales_orders WHERE public_tracking_token = $1`,
      [token],
    );
    if (rows[0]) {
      const events = await repo.listForOrder({
        brand,
        sales_order_id: rows[0].order_id,
        customer_only: true,
      });
      return {
        order_number: rows[0].order_number,
        status: rows[0].status,
        events,
      };
    }
  }
  throw new NotFoundError("Order");
}

module.exports = { record, listForOrder, getPublicTimeline };
