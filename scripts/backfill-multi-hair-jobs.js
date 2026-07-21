/**
 * One-off backfill — fan multi-hair orders out into one service job per hair.
 *
 * WHY: createForOrder used to open exactly ONE job per order (first studio line
 * only), so an order for 3 hairs became a single job that only one stylist
 * could take. The runtime now opens one job per hair (per unit of every
 * styled/service line), so multi-hair orders can be split across stylists. This
 * rescues orders that were captured under the old rule and are still OPEN
 * (unshipped) — it opens only the MISSING hairs, never touching the jobs that
 * already exist.
 *
 * SCOPE: open, in-flight orders only (see OPEN_STATES). Shipped/terminal orders
 * are deliberately left alone — adding fresh pending jobs to an order whose
 * styling is already done and gone would be wrong.
 *
 * Idempotent: createForOrder opens only `quantity − already-open` jobs per line,
 * so this is safe to re-run and safe to run alongside backfill-service-jobs.js.
 *
 * RUN (project root, same .env as the app):
 *   node scripts/backfill-multi-hair-jobs.js
 *   BACKFILL_BRAND=faitlynhair node scripts/backfill-multi-hair-jobs.js
 *   BACKFILL_DRY_RUN=1 node scripts/backfill-multi-hair-jobs.js
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

// Open, in-flight orders whose styling isn't shipped/done yet. Terminal states
// (dispatched, completed, cancelled) and pre-payment states are excluded on
// purpose — see the header. Uses the paid/assigned/in-progress window.
const OPEN_STATES = [
  "partially_paid",
  "paid",
  "assigned",
  "in_production",
  "order_ready",
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

      // Orders in an open state where the total hairs ordered (sum of the
      // studio lines' quantities) exceeds the jobs already opened for them.
      const { rows: candidates } = await query(
        `SELECT so.order_id, so.order_number, so.status,
                SUM(sol.quantity)::int   AS hairs,
                COALESCE(jc.n, 0)::int   AS jobs
           FROM ${brand}.sales_orders so
           JOIN ${brand}.sales_order_lines sol
             ON sol.order_id = so.order_id
            AND sol.line_kind IN ('styled', 'service')
           LEFT JOIN (
             SELECT sales_order_id, COUNT(*)::int AS n
               FROM ${brand}.service_jobs
              GROUP BY sales_order_id
           ) jc ON jc.sales_order_id = so.order_id
          WHERE so.status = ANY($1::text[])
          GROUP BY so.order_id, so.order_number, so.status, jc.n
         HAVING SUM(sol.quantity) > COALESCE(jc.n, 0)
          ORDER BY so.order_number`,
        [OPEN_STATES],
      );

      let opened = 0;
      let skipped = 0;
      let failed = 0;

      for (const c of candidates) {
        const gap = c.hairs - c.jobs;
        if (dryRun) {
          console.warn(
            `  would open ${gap} more job(s) for ${c.order_number} ` +
              `(${c.status}: ${c.jobs}/${c.hairs} hairs covered)`,
          );
          opened += gap;
          continue;
        }
        try {
          const order = await salesRepo.findById({ brand, id: c.order_id });
          if (!order) {
            skipped += 1;
            continue;
          }
          const result = await service.createForOrder({ brand, order });
          const jobs = Array.isArray(result) ? result : result ? [result] : [];
          if (jobs.length) {
            opened += jobs.length;
            console.warn(
              `  ${c.order_number} → ${jobs
                .map((j) => j.job_number)
                .join(", ")}`,
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
        `Orders with a gap: ${candidates.length} — opened ${opened} job(s), ` +
          `skipped ${skipped}, failed ${failed}`,
      );
    }
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
})();
