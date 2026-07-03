/**
 * One-off backfill, two phases:
 *
 * PHASE 1 — repair styled provenance on historical lines. Orders captured
 * before the styled_id fix stored styled sales as line_kind='product', so
 * nothing downstream (Studio auto-open, the register's Kind column) can tell
 * them apart from a plain wig. Two matching tiers, safest first:
 *   1a. product_name_snapshot equals a styled product's name (the storefront
 *       checkout has always written the styled name into the snapshot).
 *   1b. the line sells a styled product's pinned base variant AND the unit
 *       price equals that styled product's retail anchor (QuickSale styled
 *       picks — base product name in the snapshot, styled price on the line).
 * Matches get line_kind='styled' + styled_id stamped. Ambiguous rows (several
 * styled products sharing a name/variant+price) are skipped and logged.
 *
 * PHASE 2 — open a Stylist Studio service job for every committed order that
 * now carries styling work (styled or service line) and doesn't yet have a
 * job. Why: Studio's auto-open was only wired to `order.deposit_met`, so
 * orders paid in full never spawned a job. The runtime fix (order.paid
 * subscriber + styled_id threading) handles new orders; this rescues the rest.
 *
 * Idempotent: the repair UPDATE only touches line_kind='product' rows that
 * match, and `service.createForOrder` no-ops when a job exists. Safe to
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

      // ── PHASE 1: repair styled provenance on historical product lines ──
      // Tier 1a — snapshot name equals exactly one live styled product.
      const repairByName = `
        UPDATE ${brand}.sales_order_lines sol
           SET line_kind = 'styled', styled_id = m.styled_id
          FROM (
            SELECT sol2.line_id, min(sp.styled_id::text)::uuid AS styled_id
              FROM ${brand}.sales_order_lines sol2
              JOIN ${brand}.styled_products sp
                ON sp.name = sol2.product_name_snapshot
               AND sp.is_deleted = false
             WHERE sol2.line_kind = 'product' AND sol2.styled_id IS NULL
             GROUP BY sol2.line_id
            HAVING count(DISTINCT sp.styled_id) = 1
          ) m
         WHERE sol.line_id = m.line_id
         RETURNING sol.line_id`;
      // Tier 1b — pinned base variant + exact styled retail price.
      const repairByVariantPrice = `
        UPDATE ${brand}.sales_order_lines sol
           SET line_kind = 'styled', styled_id = m.styled_id
          FROM (
            SELECT sol2.line_id, min(sp.styled_id::text)::uuid AS styled_id
              FROM ${brand}.sales_order_lines sol2
              JOIN ${brand}.styled_products sp
                ON sp.base_variant_id = sol2.variant_id
               AND sp.retail_price_ngn = sol2.unit_price_ngn
               AND sp.is_deleted = false
             WHERE sol2.line_kind = 'product' AND sol2.styled_id IS NULL
             GROUP BY sol2.line_id
            HAVING count(DISTINCT sp.styled_id) = 1
          ) m
         WHERE sol.line_id = m.line_id
         RETURNING sol.line_id`;
      if (dryRun) {
        const { rows: r1 } = await query(
          `SELECT count(*)::int AS n FROM (
             SELECT sol2.line_id FROM ${brand}.sales_order_lines sol2
               JOIN ${brand}.styled_products sp
                 ON sp.name = sol2.product_name_snapshot AND sp.is_deleted = false
              WHERE sol2.line_kind = 'product' AND sol2.styled_id IS NULL
              GROUP BY sol2.line_id HAVING count(DISTINCT sp.styled_id) = 1
           ) x`,
        );
        const { rows: r2 } = await query(
          `SELECT count(*)::int AS n FROM (
             SELECT sol2.line_id FROM ${brand}.sales_order_lines sol2
               JOIN ${brand}.styled_products sp
                 ON sp.base_variant_id = sol2.variant_id
                AND sp.retail_price_ngn = sol2.unit_price_ngn
                AND sp.is_deleted = false
              WHERE sol2.line_kind = 'product' AND sol2.styled_id IS NULL
              GROUP BY sol2.line_id HAVING count(DISTINCT sp.styled_id) = 1
           ) x`,
        );
        console.warn(
          `Repair (dry run): would relabel ${r1[0].n} lines by name, then ${r2[0].n} more by variant+price`,
        );
      } else {
        const { rows: byName } = await query(repairByName);
        const { rows: byVp } = await query(repairByVariantPrice);
        console.warn(
          `Repair: relabelled ${byName.length} lines by name, ${byVp.length} by variant+price`,
        );
      }

      // ── PHASE 2 ────────────────────────────────────────────
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
