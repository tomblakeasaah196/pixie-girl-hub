/**
 * Pre-order allocation subscribers — the two halves of "stock arrived, fulfil
 * the pre-orders waiting on it":
 *
 *   1. DURABLE (transactional outbox): `stock.received` → allocateForVariant.
 *      Enqueued by stock.service.applyMovement on every inbound movement and
 *      dispatched POST-COMMIT by the worker, so the allocator sees the committed
 *      on_hand and its draws/reserves never bloat or roll back the goods receipt.
 *      At-least-once + idempotent allocation = safe.
 *
 *   2. SOFT (in-process): `preorder.allocated` → tell the people who act on it.
 *      Ops (whoever can move stock) AND sales (whoever can edit orders) get one
 *      notification per receipt naming what was fulfilled and that it's ready to
 *      assign/ship. Best-effort, lost on restart by design — the stock draw is
 *      already committed and durable; this is the alert on top of it. The
 *      customer email is deliberately NOT automatic: it's a manual, email-only
 *      button on the order (see preorder-arrival.service).
 *
 * Registered in the worker (outbox dispatcher) and harmlessly in the web process
 * (the in-process listener; it never dispatches the outbox).
 */

"use strict";

const outbox = require("../../shared/outbox/outbox");
const events = require("./sales.events");
const allocation = require("./preorder-allocation.service");
const grantsRepo = require("../../shared/access/grants.repo");
const notifications = require("../../services/notifications.service");
const { logger } = require("../../config/logger");

let registered = false;

/**
 * Outbox handler: allocate the just-received units of a variant to its waiting
 * pre-orders. Idempotent — re-derives coverage from the ledger — so an
 * at-least-once redelivery is safe.
 */
async function onStockReceived(payload, meta) {
  const brand = (meta && meta.business) || (payload && payload.brand);
  const variant_id = payload && payload.variant_id;
  if (!brand || !variant_id) return;
  await allocation.allocateForVariant({
    brand,
    variant_id,
    location_id: (payload && payload.location_id) || null,
    actor_user_id: null,
    notify: true,
  });
}

/** In-process: notify ops + sales that pre-orders were fulfilled by new stock. */
async function onPreorderAllocated(payload) {
  const { brand, orders, units_deducted, units_reserved } = payload || {};
  if (!brand || !Array.isArray(orders) || !orders.length) return;

  const orderNumbers = orders
    .map((o) => o.order_number)
    .filter(Boolean)
    .join(", ");
  const parts = [];
  if (units_deducted) parts.push(`${units_deducted} drawn for paid pre-order(s)`);
  if (units_reserved) parts.push(`${units_reserved} reserved for unpaid pre-order(s)`);
  const body = `New stock fulfilled ${orders.length} pre-order line group${
    orders.length === 1 ? "" : "s"
  }: ${orderNumbers}. ${parts.join(", ")}. Ready to assign/ship.`;

  const first = orders[0];
  const action_url = first ? `/sales/orders/${first.order_id}` : "/sales";

  try {
    // Whoever can move stock AND whoever can edit orders — resolved from the
    // permission, not a role name (brands rename roles). Dedupe by user_id so a
    // person holding both permissions is told once.
    const [stockUsers, salesUsers] = await Promise.all([
      grantsRepo.listUsersWithPermission({
        business: brand,
        module: "stock",
        action: "edit",
      }),
      grantsRepo.listUsersWithPermission({
        business: brand,
        module: "sales",
        action: "edit",
      }),
    ]);
    const seen = new Set();
    const recipients = [...stockUsers, ...salesUsers].filter((r) => {
      if (!r || !r.user_id || seen.has(r.user_id)) return false;
      seen.add(r.user_id);
      return true;
    });
    await Promise.all(
      recipients.map((r) =>
        notifications.notify({
          user_id: r.user_id,
          business: brand,
          type: "preorder_fulfilled",
          title: "Pre-orders fulfilled by new stock",
          body,
          priority: "high",
          reference_type: "sales_order",
          reference_id: first ? first.order_id : null,
          action_url,
        }),
      ),
    );
    logger.info(
      {
        brand,
        orders: orders.length,
        units_deducted,
        units_reserved,
        notified: recipients.length,
      },
      "preorder allocation — ops + sales notified",
    );
  } catch (err) {
    logger.error(
      { err: err.message, brand },
      "preorder allocation notify failed",
    );
  }
}

function register() {
  if (registered) return;
  registered = true;
  outbox.register("stock.received", "preorder-allocation", onStockReceived);
  events.on("preorder.allocated", (payload) =>
    onPreorderAllocated(payload).catch((err) =>
      logger.warn(
        { err: err.message },
        "preorder allocation: notify handler failed",
      ),
    ),
  );
  logger.info(
    "preorder allocation subscribers registered (outbox stock.received → allocate; preorder.allocated → ops + sales notify)",
  );
}

register();

module.exports = { register, onStockReceived, onPreorderAllocated };
