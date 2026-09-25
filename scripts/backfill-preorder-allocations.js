/**
 * Reconcile pre-order allocations — the safety net for "stock arrived but the
 * pre-orders waiting on it were never fulfilled".
 *
 * WHY: pre-orders are normally fulfilled live — a stock receipt enqueues
 * `stock.received`, the worker draws the units for paid pre-orders and reserves
 * them for unpaid ones (src/modules/sales/preorder-allocation.service.js). But
 * two things can leave a gap: (1) HISTORY — stock that came in BEFORE this
 * feature existed was never applied to the pre-orders already on the books; and
 * (2) a live-path FAILURE — the worker was down, or a bug swallowed an event.
 *
 * WHAT THIS DOES: for each brand, sweeps every variant that still has an open
 * pre-order on a live order and applies whatever stock is available to it, in the
 * same paid-first / oldest-first order as the live path. Because coverage is
 * re-derived from the movement ledger every pass and only a genuine deficit is
 * ever allocated against genuinely-available stock, it is FULLY IDEMPOTENT: a
 * second run (or the live path having already handled a receipt) allocates
 * nothing. That is exactly why it is safe to run on EVERY deploy — it cleans up
 * anything the live path missed and is a no-op when there is nothing to do.
 *
 * "Never runs twice" in the sense that matters: it can be RUN any number of
 * times without ever double-drawing, and each run is logged to
 * shared.preorder_allocation_runs, so `hasEverRun` distinguishes the first
 * historical backfill from a routine reconcile. It does not run the customer
 * email or spam ops — sweeps are silent (notify=false); the live path owns the
 * ops/sales notification.
 *
 * RUN (project root, same .env as the app):
 *   node scripts/backfill-preorder-allocations.js            # reconcile all brands
 *   npm run backfill:preorder-allocations
 *   PREORDER_BACKFILL_BRAND=faitlynhair node scripts/backfill-preorder-allocations.js
 *   PREORDER_BACKFILL_MODE=historical  node scripts/backfill-preorder-allocations.js
 *
 * Wired into the production deploy (.github/workflows/ci.yml) right after
 * migrations. Best-effort there: a hiccup must never fail the whole deploy.
 */

"use strict";

const {
  initDatabase,
  closeDatabase,
} = require("../src/config/database");
const { refreshBrands, VALID } = require("../src/config/brands");
const allocation = require("../src/modules/sales/preorder-allocation.service");

(async () => {
  let exitCode = 0;
  try {
    await initDatabase();
    await refreshBrands();

    const only = process.env.PREORDER_BACKFILL_BRAND || null;
    const modeOverride = process.env.PREORDER_BACKFILL_MODE || null;
    const brands = [...VALID].filter((b) => !only || b === only);
    if (!brands.length) {
      console.warn("No brands to process.");
      return;
    }

    for (const brand of brands) {
      const firstEver = !(await allocation.hasEverRun({ brand }));
      const mode = modeOverride || (firstEver ? "historical" : "deploy");
      console.log(
        `\n═══ ${brand} — pre-order reconcile (${mode}${firstEver ? ", first run" : ""})`,
      );
      const r = await allocation.allocateForBrand({
        brand,
        mode,
        actor_user_id: null,
        notify: false,
      });
      console.log(
        `    variants scanned: ${r.variants_scanned} · ` +
          `orders fulfilled: ${r.orders_fulfilled} · ` +
          `units drawn: ${r.units_deducted} · ` +
          `units reserved: ${r.units_reserved} · ` +
          `${r.ok ? "ok" : "COMPLETED WITH ERRORS"}`,
      );
      if (!r.ok) exitCode = 1;
    }
  } catch (err) {
    console.error("preorder allocation reconcile failed:", err.message);
    exitCode = 1;
  } finally {
    await closeDatabase();
    process.exit(exitCode);
  }
})();
