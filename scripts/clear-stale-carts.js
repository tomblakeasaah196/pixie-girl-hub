/**
 * One-off: clear stale storefront carts so everyone starts fresh on the
 * (now-fixed) site. NOT a recurring sweep — by design we don't auto-expire
 * carts going forward, so customers who deliberately save a cart to pay later
 * keep it.
 *
 * WHAT IT DOES
 * For every ACTIVE cart whose last interaction is older than STALE_CART_HOURS,
 * it deletes the cart_items and marks the cart 'expired'. Because findActiveCart
 * only matches status='active', the customer simply gets a brand-new empty cart
 * on their next visit. History rows are kept (not hard-deleted).
 *
 * STOCK: carts idle past the 20-minute cart-TTL already had their stock
 * reservations auto-released, so clearing carts older than ~1h leaves no
 * orphaned reservations. Keep the threshold >= 1h for that reason.
 *
 * CONFIG (env):
 *   STALE_CART_HOURS  how idle (hours) before a cart is cleared. Default 1.
 *   CART_BRAND        limit to one business key (e.g. faitlynhair). Default: all.
 *
 * RUN (project root, same .env as the app):
 *   node scripts/clear-stale-carts.js
 *   STALE_CART_HOURS=0 node scripts/clear-stale-carts.js   # clear ALL active carts
 */

"use strict";

const { initDatabase, closeDatabase, transaction } = require("../src/config/database");

const HOURS = Number(process.env.STALE_CART_HOURS ?? 1);
const BRAND = process.env.CART_BRAND || null;

(async () => {
  try {
    await initDatabase();

    const where =
      `status = 'active'
         AND last_interaction_at < now() - make_interval(hours => $1)
         AND ($2::text IS NULL OR business = $2)`;

    await transaction(async (client) => {
      const { rows: pre } = await client.query(
        `SELECT count(*)::int AS n FROM shared.carts WHERE ${where}`,
        [HOURS, BRAND],
      );
      const target = pre[0].n;
      console.warn(
        `Stale active carts (idle > ${HOURS}h${BRAND ? `, brand ${BRAND}` : ", all brands"}): ${target}`,
      );
      if (target === 0) {
        console.warn("Nothing to clear.");
        return;
      }

      const items = await client.query(
        `DELETE FROM shared.cart_items
          WHERE cart_id IN (SELECT cart_id FROM shared.carts WHERE ${where})`,
        [HOURS, BRAND],
      );
      const carts = await client.query(
        `UPDATE shared.carts
            SET status = 'expired', expires_at = now()
          WHERE ${where}`,
        [HOURS, BRAND],
      );
      console.warn(
        `Cleared ${carts.rowCount} cart(s); removed ${items.rowCount} cart item(s). ` +
          "Customers will get a fresh cart on their next visit.",
      );
    });
  } catch (e) {
    console.error("clear-stale-carts failed:", e.message);
    process.exitCode = 1;
  } finally {
    try {
      await closeDatabase();
    } catch {
      // ignore close errors
    }
    process.exit(process.exitCode || 0);
  }
})();
