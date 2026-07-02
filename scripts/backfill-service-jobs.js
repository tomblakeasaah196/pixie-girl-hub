/**
 * One-off backfill: open a Stylist Studio service job for every already-paid
 * order that carries styling work (styled or service line) and doesn't yet have
 * a job.
 *
 * Why: Studio's auto-open only wired to `order.deposit_met`, so orders paid in
 * full went straight to `paid`/`awaiting_dispatch` without ever spawning a job.
 * The runtime fix (order.paid subscriber + styled_id threading) handles new
 * orders; this script rescues the ones already sitting in Sales.
 *
 * Idempotent: `service.createForOrder` internally checks
 * `serviceJobExistsForOrder` and short-circuits if a job is already open, and it
 * short-circuits again on any order whose lines are all plain product. Safe to
 * re-run.
 *
 * RUN (project root, same .env as the app):
 *   node scripts/backfill-service-jobs.js
 *   BACKFILL_BRAND=faitlynhair node scripts/backfill-service-jobs.js
 *   BACKFILL_DRY_RUN=1 node scripts/backfill-service-jobs.js
 */

"use strict";

const {
  initDatabase,
  closeDatabase,
  query,
} = require("../src/config/database");
const { refreshBrands, VALID } = require("../src/config/brands");
const service = require("../src/modules/service_jobs/service-jobs.service");
const salesRepo = require("../src/modules/sales/sales.repo");

// Orders past initial capture — anything that has committed to production or
// beyond. `in_production` is the deposit-triggered flip; the rest are the
// full-payment path.
const COMMITTED_STATES = [
  "paid",
  "awaiting_dispatch",
  "completed",
  "in_production",
];

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

      // Candidate orders: committed status + at least one styled/service line
      // + no existing service_job attached. The LEFT JOIN + IS NULL gate keeps
      // the second pass a no-op after a successful first pass.
      const { rows: candidates } = await query(
        `SELECT DISTINCT so.order_id, so.order_number, so.status
           FROM ${brand}.sales_orders so
           JOIN ${brand}.sales_order_lines sol
             ON sol.order_id = so.order_id
            AND sol.line_kind IN ('styled', 'service')
           LEFT JOIN ${brand}.service_jobs sj
             ON sj.sales_order_id = so.order_id
          WHERE so.status = ANY($1::text[])
            AND sj.job_id IS NULL
          ORDER BY so.order_id`,
        [COMMITTED_STATES],
      );

      let opened = 0;
      let skipped = 0;
      let failed = 0;

      for (const c of candidates) {
        if (dryRun) {
          console.warn(`  would open job for ${c.order_number} (${c.status})`);
          opened += 1;
          continue;
        }
        try {
          const order = await salesRepo.findById({ brand, id: c.order_id });
          if (!order) {
            skipped += 1;
            continue;
          }
          const job = await service.createForOrder({ brand, order });
          if (job) {
            opened += 1;
            console.warn(
              `  ${c.order_number} → job ${job.job_number} (${job.status})`,
            );
          } else {
            skipped += 1;
          }
        } catch (e) {
          failed += 1;
          console.warn(`  ${c.order_number} FAILED: ${e.message}`);
        }
      }

      console.warn(
        `Orders scanned: ${candidates.length} — opened ${opened}, skipped ${skipped}, failed ${failed}`,
      );
    }
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
})();
