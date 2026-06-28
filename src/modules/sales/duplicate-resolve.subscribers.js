/**
 * Duplicate-order auto-resolver — order.paid subscriber.
 *
 * Problem it fixes: a buyer's first payment fails, they retry as a brand-new
 * checkout (new session → new idempotency key, sometimes past the 15-min
 * near-duplicate guard), and the abandoned first order lingers in
 * 'pending_payment'. The layaway reminder cron then duns the customer for an
 * order they have effectively already paid under a different number — an error
 * on our side, not theirs.
 *
 * This consumer runs post-commit on order.paid (alongside invoicing, GL,
 * timeline, etc.). It finds pending_payment "twins" of the just-paid order
 * (same contact, same total, identical line signature, created within the
 * configured window) and cancels them through salesService.cancelOrder — which
 * releases the stock reservation, audits, and emits order.cancelled — so the
 * reminders stop and the orphan leaves the active order list.
 *
 * Safety: it never touches a paid order (cancelOrder rejects PAID states), and
 * an exact total + line-signature match on the same contact makes a false
 * cancel of a genuinely different pending order effectively impossible. It is a
 * no-op for anonymous sales (no contact_id), e.g. walk-in POS.
 *
 * Config (business_config.installment_settings):
 *   • auto_resolve_duplicate_orders   — set false to disable (default on)
 *   • duplicate_pending_window_hours  — look-back window (default 24)
 */

"use strict";

const outbox = require("../../shared/outbox/outbox");
const salesService = require("./sales.service");
const salesRepo = require("./sales.repo");
const businessConfig = require("../business_setup/business-config.repo");
const { logger } = require("../../config/logger");

const SYSTEM_USER = { user_id: null };
const DEFAULT_WINDOW_HOURS = 24;

async function onOrderPaid({ brand, order_id, contact_id, total_ngn }) {
  // Anonymous / total-less payloads can never have a matchable twin.
  if (!contact_id || total_ngn === null || total_ngn === undefined) return;

  let settings = {};
  try {
    const cfg = await businessConfig.findByKey(brand);
    settings = (cfg && cfg.installment_settings) || {};
  } catch (err) {
    logger.warn(
      { err, brand },
      "dup-resolver: business config read failed; using defaults",
    );
  }
  if (settings.auto_resolve_duplicate_orders === false) return;
  const hours =
    Number(settings.duplicate_pending_window_hours) || DEFAULT_WINDOW_HOURS;

  let twins = [];
  try {
    twins = await salesRepo.findPendingTwins({
      brand,
      paid_order_id: order_id,
      contact_id,
      total_ngn,
      hours,
    });
  } catch (err) {
    logger.error({ err, brand, order_id }, "dup-resolver: twin lookup failed");
    return;
  }
  if (twins.length === 0) return;

  for (const twin of twins) {
    try {
      await salesService.cancelOrder({
        brand,
        user: SYSTEM_USER,
        request_id: null,
        id: twin.order_id,
        reason: `Auto-cancelled: superseded by paid duplicate order ${order_id}`,
      });
      logger.info(
        { brand, paid_order_id: order_id, cancelled: twin.order_number },
        "dup-resolver: pending duplicate order auto-cancelled",
      );
    } catch (err) {
      // Best-effort: a twin that raced to another terminal state (paid/cancelled)
      // simply fails the cancel; never let it disturb the rest of order.paid.
      logger.warn(
        { err, brand, twin_order_id: twin.order_id },
        "dup-resolver: cancel skipped",
      );
    }
  }
}

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  outbox.register("order.paid", "duplicate-resolver", onOrderPaid);
  logger.info(
    "sales duplicate-resolver subscriber registered (order.paid → cancel pending twins)",
  );
}

register();

module.exports = { register, onOrderPaid };
