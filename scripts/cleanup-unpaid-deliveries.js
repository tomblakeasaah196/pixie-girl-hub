/**
 * One-off cleanup: cancel premature deliveries created for UNPAID orders.
 *
 * Background: the business is prepaid-only (never ships pay-on-delivery), but
 * the old logistics flow auto-created a `queued` delivery at order *creation*
 * (on `order.confirmed`) for every dispatch order — paid or not. That path is
 * now removed (deliveries are created only on `order.paid`), but historical
 * unpaid orders may still carry a stray queued delivery cluttering the queue.
 *
 * This cancels those. Strictly scoped to be safe:
 *   • only `delivery_type = 'sales_order'` rows linked to an order,
 *   • only `status = 'queued'` (never booked, no courier action — pristine),
 *   • only where the order's status is NOT paid
 *     (paid = paid / awaiting_dispatch / completed).
 * A booked / in-transit / delivered delivery is never touched. Cancelling
 * (not deleting) keeps the audit trail; `findDeliveryByOrder` ignores cancelled
 * rows, so the order still gets a fresh delivery once it is actually paid.
 *
 * Idempotent — re-running only affects rows that still match. Safe to repeat.
 *
 * RUN (project root, same .env as the app):
 *   node scripts/cleanup-unpaid-deliveries.js
 *   BACKFILL_BRAND=faitlynhair node scripts/cleanup-unpaid-deliveries.js
 *   BACKFILL_DRY_RUN=1 node scripts/cleanup-unpaid-deliveries.js
 */

"use strict";

const {
  initDatabase,
  closeDatabase,
  query,
} = require("../src/config/database");
const { refreshBrands, VALID } = require("../src/config/brands");

// Orders considered fully paid — their deliveries are legitimate and untouched.
const PAID_STATES = ["paid", "awaiting_dispatch", "completed"];

(async () => {
  try {
    await initDatabase();
    await refreshBrands();

    const only = process.env.BACKFILL_BRAND || null;
    const dryRun = process.env.BACKFILL_DRY_RUN === "1";
    const brands = [...VALID].filter((b) => !only || b === only);
    if (!brands.length) {
      console.warn("No brands to process.");
      return;
    }

    for (const brand of brands) {
      console.warn(`\n=== ${brand}${dryRun ? " (dry run)" : ""} ===`);

      // Pristine queued deliveries on orders that are NOT paid.
      const selectSql = `
        SELECT d.delivery_id, d.delivery_number, so.order_number, so.status AS order_status
          FROM ${brand}.deliveries d
          JOIN ${brand}.sales_orders so ON so.order_id = d.order_id
         WHERE d.delivery_type = 'sales_order'
           AND d.status = 'queued'
           AND so.status <> ALL($1::text[])
         ORDER BY d.created_at`;

      const { rows: targets } = await query(selectSql, [PAID_STATES]);

      if (!targets.length) {
        console.warn("Nothing to cancel — no queued deliveries on unpaid orders.");
        continue;
      }

      for (const t of targets) {
        console.warn(
          `  ${dryRun ? "would cancel" : "cancelling"} ${t.delivery_number} (order ${t.order_number} · ${t.order_status})`,
        );
      }

      if (!dryRun) {
        const { rows: cancelled } = await query(
          `UPDATE ${brand}.deliveries d
              SET status = 'cancelled', cancelled_at = now()
             FROM ${brand}.sales_orders so
            WHERE so.order_id = d.order_id
              AND d.delivery_type = 'sales_order'
              AND d.status = 'queued'
              AND so.status <> ALL($1::text[])
            RETURNING d.delivery_id`,
          [PAID_STATES],
        );
        console.warn(`Cancelled ${cancelled.length} delivery(ies).`);
      } else {
        console.warn(`Would cancel ${targets.length} delivery(ies).`);
      }
    }
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
})();
