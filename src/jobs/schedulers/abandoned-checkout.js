/**
 * Abandoned-checkout sweep (Flexi Pay D10 — owner session 2026-07-10).
 *
 * A pending order with ₦0 paid is an abandoned checkout, whatever plan the
 * buyer clicked — it must never be treated as a committed instalment plan
 * (that mistake produced the "You've paid ₦0.00 of ₦506,200" WhatsApp mess).
 * Two passes per brand, every 30 minutes:
 *
 *   1. NUDGE — orders older than abandoned_checkout_nudge_hours (default 2)
 *      get ONE friendly "complete your order" message via the Comms Studio
 *      'abandoned_checkout' automation (copy CEO-editable, channel per
 *      policy). last_reminder_sent_at doubles as the claim stamp; instalment
 *      reminders can't collide with it because they require amount_paid > 0.
 *
 *   2. EXPIRE — orders older than abandoned_checkout_expiry_hours (default
 *      48) are cancelled through salesService.cancelOrder, which releases
 *      the stock reservation every order now takes at placement (D8). Silent:
 *      no message on expiry. Each order is its own transaction so one bad row
 *      can't fail the batch.
 *
 * Both windows + the nudge toggle live in installment_settings (Sales →
 * Payments tab). On first deploy this sweep also drains the existing backlog
 * of stale unpaid orders — that is the agreed cleanup (plan D10/Q23).
 */

"use strict";

const Decimal = require("decimal.js");

const { logger } = require("../../config/logger");
const salesService = require("../../modules/sales/sales.service");
const salesRepo = require("../../modules/sales/sales.repo");
const paymentSettings = require("../../modules/sales/payment-settings.service");
const commsStudio = require("../../modules/comms_studio/comms-studio.service");
const brandUrls = require("../../utils/brand-urls");

const { BRANDS } = require("../../config/brands");
const SYSTEM_USER = { user_id: null };

const ngn = (v) =>
  "₦" + new Decimal(v || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

async function runAbandonedCheckoutSweep() {
  let nudged = 0;
  let expired = 0;
  for (const brand of BRANDS) {
    let settings;
    try {
      settings = await paymentSettings.getSettings(brand);
    } catch (err) {
      logger.error({ err, brand }, "abandoned-checkout settings load failed");
      continue;
    }
    const nudgeHours = Number(settings.abandoned_checkout_nudge_hours ?? 2);
    const expiryHours = Number(settings.abandoned_checkout_expiry_hours ?? 48);

    // ── 1. Nudge ──────────────────────────────────────────
    if (settings.abandoned_checkout_nudge_enabled !== false) {
      let due = [];
      try {
        due = await salesRepo.listAbandonedCheckoutsForNudge({
          brand,
          nudgeHours,
          expiryHours,
        });
      } catch (err) {
        logger.error({ err, brand }, "abandoned-checkout nudge query failed");
        due = [];
      }
      for (const order of due) {
        try {
          const claimed = await salesRepo.claimAbandonedNudge({
            brand,
            id: order.order_id,
          });
          if (!claimed) continue;
          const payUrl = await brandUrls.payLinkUrl(
            brand,
            await salesRepo.ensurePublicTrackingToken({
              brand,
              id: order.order_id,
            }),
          );
          const result = await commsStudio.dispatch({
            brand,
            event_key: "abandoned_checkout",
            contact_id: order.contact_id,
            reference_type: "sales_order",
            reference_id: order.order_id,
            dedup_key: `abandoned_checkout:${order.order_id}`,
            variables: {
              order_number: order.order_number,
              total: ngn(order.total_ngn),
              pay_url: payUrl,
            },
          });
          if (result.dispatched) nudged += 1;
        } catch (err) {
          logger.error(
            { err, brand, order_id: order.order_id },
            "abandoned-checkout nudge failed",
          );
        }
      }
    }

    // ── 2. Expire ─────────────────────────────────────────
    // Self-serve checkouts expire fast (hours); staff-negotiated orders keep
    // the slow lane (the layaway-abandonment day count) so a WhatsApp
    // customer who pays at the weekend isn't cancelled under the till.
    const staleDays = Number(settings.layaway_abandonment_days ?? 60);
    let stale = [];
    try {
      stale = await salesRepo.listExpiredAbandonedCheckouts({
        brand,
        expiryHours,
        staleDays,
      });
    } catch (err) {
      logger.error({ err, brand }, "abandoned-checkout expiry query failed");
      stale = [];
    }
    for (const order of stale) {
      try {
        await salesService.cancelOrder({
          brand,
          user: SYSTEM_USER,
          request_id: null,
          id: order.order_id,
          reason: "checkout_abandoned",
        });
        expired += 1;
        logger.info(
          { brand, order_id: order.order_id, order_number: order.order_number },
          "abandoned checkout expired (auto-cancel + stock release)",
        );
      } catch (err) {
        logger.error(
          { err, brand, order_id: order.order_id },
          "abandoned-checkout expiry failed",
        );
      }
    }
  }
  logger.info({ nudged, expired }, "abandoned-checkout sweep done");
  return { nudged, expired };
}

module.exports = { runAbandonedCheckoutSweep };
