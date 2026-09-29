/**
 * One-off backfill — partial payment now commits an order to production
 * (000393, owner directive 2026-09-29): "once an order is even partially
 * paid... we can be able to have it in the stylist studio and be able to
 * assign it... meaning the stock considers it as a sale at once."
 *
 * Before this change, an order sitting at `partially_paid` (anything short of
 * `deposit_triggered` custom orders past their required deposit) never opened
 * its Stylist Studio job and never drew its stock as a real sale — both
 * waited for the full balance. This rescues every order already sitting there
 * when the change ships, in two passes per order:
 *
 *   1. Open the missing Studio job(s) — `service.createForOrder` doesn't gate
 *      on payment_model at all (only on the order actually carrying styling
 *      work), so this is the exact same call the live `order.deposit_met`
 *      subscriber makes; idempotent, opens only the shortfall.
 *   2. Draw the order's stock as a sale — `sales.service.drawStockForOrder`,
 *      the same engine `addPayment` now calls on a fresh first payment.
 *      Idempotent via the movement ledger (`netSoldForOrder`); a genuine
 *      shortfall flags the line as a formal pre-order instead of failing the
 *      run, exactly as a live payment would.
 *
 * SCOPE: `partially_paid` orders with money on them (amount_paid_ngn > 0).
 * `paid`+ orders already went through `markPaid` and need nothing here.
 *
 * RUN (project root, same .env as the app):
 *   node scripts/backfill-partial-paid-studio-jobs.js
 *   BACKFILL_BRAND=faitlynhair node scripts/backfill-partial-paid-studio-jobs.js
 *   BACKFILL_DRY_RUN=1 node scripts/backfill-partial-paid-studio-jobs.js
 */

"use strict";

const {
  initDatabase,
  closeDatabase,
  query,
  transaction,
} = require("../src/config/database");
const { refreshBrands, VALID } = require("../src/config/brands");
const serviceJobs = require("../src/modules/service_jobs/service-jobs.service");
const sales = require("../src/modules/sales/sales.service");
const salesRepo = require("../src/modules/sales/sales.repo");

const SYSTEM_USER = { user_id: null };

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

      const { rows: candidates } = await query(
        `SELECT order_id, order_number, status, amount_paid_ngn
           FROM ${brand}.sales_orders
          WHERE status = 'partially_paid'
            AND amount_paid_ngn > 0
          ORDER BY order_number`,
      );

      if (!candidates.length) {
        console.warn("Nothing to backfill.");
        continue;
      }

      if (dryRun) {
        console.warn(
          `Would process ${candidates.length} partially-paid order(s): ` +
            candidates.map((c) => c.order_number).join(", "),
        );
        continue;
      }

      let jobsOpened = 0;
      let linesShortfall = 0;
      let failed = 0;

      for (const c of candidates) {
        try {
          // Pass 1 — the Studio job(s). Own transaction: a job failure must
          // never block the stock draw for the same order.
          const order = await salesRepo.findById({ brand, id: c.order_id });
          if (!order) {
            console.warn(`  ${c.order_number}: order vanished, skipping`);
            continue;
          }
          const jobResult = await serviceJobs.createForOrder({ brand, order });
          const jobs = Array.isArray(jobResult)
            ? jobResult
            : jobResult
              ? [jobResult]
              : [];
          jobsOpened += jobs.length;

          // Pass 2 — the stock draw, in its own transaction so a shortfall on
          // one order can never roll back another.
          const { shortfallLines } = await transaction(async (client) => {
            const fresh = await salesRepo.findById({ client, brand, id: c.order_id });
            const outcome = await sales.drawStockForOrder({
              client,
              brand,
              user: SYSTEM_USER,
              order: fresh,
              reason: "backfill: partial payment already committed order to production",
              hardFailOnNoLocation: false,
            });
            await sales.recordStockShortfall({
              client,
              brand,
              order_id: c.order_id,
              shortfallLines: outcome.shortfallLines,
            });
            return outcome;
          });

          linesShortfall += shortfallLines.length;

          console.warn(
            `  ${c.order_number}: ${jobs.length} job(s) opened, ` +
              `${shortfallLines.length ? `${shortfallLines.length} line(s) short → flagged pre-order` : "stock drawn"}`,
          );
        } catch (e) {
          failed += 1;
          console.warn(`  ${c.order_number} FAILED: ${e.message}`);
        }
      }

      console.warn(
        `Orders scanned: ${candidates.length} — jobs opened: ${jobsOpened}, ` +
          `lines flagged pre-order on shortfall: ${linesShortfall}, failed: ${failed}`,
      );
    }
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
})();
