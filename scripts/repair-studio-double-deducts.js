/**
 * Repair the wigs that were deducted from stock TWICE.
 *
 * WHY: until the sale became the sole owner of the stock draw, two paths could
 * each write a 'sale' movement for one physical wig — `markPaid` on the order,
 * and the Stylist Studio on assignment (and again on completion). The Studio
 * side guarded itself with "has the sale drawn this wig yet?", a question whose
 * answer changes over time: on a deposit-triggered order the job opens and the
 * stylist is assigned while the balance is still outstanding, so the answer was
 * "no", the Studio deducted, and markPaid deducted the same unit later. One wig
 * left the shelf; stock lost two.
 *
 * WHAT THIS DOES: finds every Studio draw that duplicates a sale draw for the
 * same order and variant, nets off anything already put back (an unassign
 * restock), aggregates the surplus per location, and raises ONE stock
 * adjustment per location — type 'found', because the units physically exist
 * and only the system is short — SUBMITTED to the normal Adjustments approval
 * queue. Nothing changes stock until a CEO/approver approves and posts it.
 *
 * SAFE TO RE-RUN: a movement already covered by a repair adjustment is skipped
 * (its movement id is stamped in the adjustment line's notes), so a second run
 * over the same data raises nothing.
 *
 * RUN (project root, same .env as the app):
 *   node scripts/repair-studio-double-deducts.js            # raise + submit
 *   REPAIR_DRY_RUN=1 node scripts/repair-studio-double-deducts.js   # report only
 *   REPAIR_BRAND=faitlynhair node scripts/repair-studio-double-deducts.js
 *   REPAIR_USER_EMAIL=ceo@example.com node scripts/repair-studio-double-deducts.js
 */

"use strict";

const {
  initDatabase,
  closeDatabase,
  query,
} = require("../src/config/database");
const { refreshBrands, VALID, t } = require("../src/config/brands");
const stockService = require("../src/modules/stock/stock.service");

/**
 * Studio 'sale' movements that duplicate the order's own sale draw.
 *
 * Matched on (order, variant): the Studio movement references the JOB, the
 * sale movement references the ORDER, so the join goes through service_jobs.
 * `net_out` nets this job's Studio draws against any Studio restock already
 * posted for it (unassign), so a job that was already put back is not repaired
 * twice. `already_repaired` looks for this movement's id stamped in an earlier
 * repair adjustment line.
 */
function findDuplicatesSql(brand) {
  return `
    SELECT sm.movement_id,
           sm.movement_number,
           sm.variant_id,
           sm.location_id,
           ABS(sm.quantity)::int AS units,
           sm.performed_at,
           j.job_id,
           j.job_number,
           so.order_id,
           so.order_number,
           loc.display_name AS location_name,
           pv.sku,
           p.name AS product_name
      FROM ${t(brand, "stock_movements")} sm
      JOIN ${t(brand, "service_jobs")} j ON j.job_id = sm.reference_id
      JOIN ${t(brand, "sales_orders")} so ON so.order_id = j.sales_order_id
      LEFT JOIN ${t(brand, "stock_locations")} loc ON loc.location_id = sm.location_id
      LEFT JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = sm.variant_id
      LEFT JOIN ${t(brand, "products")} p ON p.product_id = pv.product_id
     WHERE sm.movement_type = 'sale'
       AND sm.sales_channel = 'service_job'
       -- the sale drew the same variant for the same order
       AND EXISTS (
             SELECT 1 FROM ${t(brand, "stock_movements")} s2
              WHERE s2.reference_id = j.sales_order_id
                AND s2.variant_id = sm.variant_id
                AND s2.movement_type = 'sale'
                AND s2.sales_channel IS DISTINCT FROM 'service_job')
       -- this job still has units out (not already restocked on unassign)
       AND COALESCE((
             SELECT SUM(CASE WHEN m2.movement_type = 'sale' THEN -m2.quantity
                             WHEN m2.movement_type = 'receive' THEN -m2.quantity
                             ELSE 0 END)
               FROM ${t(brand, "stock_movements")} m2
              WHERE m2.reference_id = j.job_id
                AND ((m2.movement_type = 'sale' AND m2.sales_channel = 'service_job')
                  OR (m2.movement_type = 'receive' AND m2.reference_type = 'service_job'))
           ), 0) > 0
       -- not already covered by an earlier run of this repair
       AND NOT EXISTS (
             SELECT 1
               FROM ${t(brand, "stock_adjustment_lines")} sal
               JOIN ${t(brand, "stock_adjustments")} sa
                 ON sa.adjustment_id = sal.adjustment_id
              WHERE sa.status <> 'rejected'
                AND sal.notes LIKE '%' || sm.movement_id::text || '%')
     ORDER BY sm.performed_at`;
}

/** Current on-hand for a (variant, location) — the adjustment's system_count. */
async function onHand(brand, variant_id, location_id) {
  const { rows } = await query(
    `SELECT on_hand FROM ${t(brand, "stock_levels")}
      WHERE variant_id = $1 AND location_id = $2`,
    [variant_id, location_id],
  );
  return rows[0] ? Number(rows[0].on_hand) : 0;
}

/** Who the repair is filed as. A real user row is required (created_by FK). */
async function resolveUser() {
  const email = process.env.REPAIR_USER_EMAIL;
  if (email) {
    const { rows } = await query(
      `SELECT user_id, display_name, email FROM shared.users WHERE email = $1`,
      [email],
    );
    if (!rows[0]) throw new Error(`No user with email ${email}`);
    return rows[0];
  }
  // Fall back to the CEO account — this is a stock correction and the CEO
  // approves them anyway.
  const { rows } = await query(
    `SELECT user_id, display_name, email
       FROM shared.users
      WHERE is_ceo = true AND is_active = true
      ORDER BY created_at LIMIT 1`,
  );
  if (!rows[0])
    throw new Error(
      "No CEO user found — pass REPAIR_USER_EMAIL=<email> to file the repair as a specific user.",
    );
  return rows[0];
}

function fmtNgn(n) {
  return new Intl.NumberFormat("en-NG").format(n);
}

(async () => {
  let exitCode = 0;
  try {
    await initDatabase();
    await refreshBrands();

    const only = process.env.REPAIR_BRAND || null;
    const dryRun = process.env.REPAIR_DRY_RUN === "1";
    const brands = [...VALID].filter((b) => !only || b === only);
    if (!brands.length) {
      console.warn("No brands to process.");
      return;
    }

    const user = dryRun ? null : await resolveUser();
    if (user)
      console.log(`Filing repairs as ${user.display_name || user.email}\n`);

    for (const brand of brands) {
      const { rows } = await query(findDuplicatesSql(brand));
      console.log(`\n═══ ${brand} — ${rows.length} double-deducted unit(s)`);
      if (!rows.length) continue;

      // Report every affected job before touching anything — this list is the
      // evidence for whoever approves the adjustment.
      for (const r of rows) {
        console.log(
          `  ${r.movement_number}  ${r.job_number}  order ${r.order_number}  ` +
            `${r.product_name || r.sku || r.variant_id.slice(0, 8)}  ` +
            `${r.units}u  @ ${r.location_name || r.location_id.slice(0, 8)}`,
        );
      }

      // Aggregate the surplus per (location, variant) — one adjustment per
      // location, one line per variant.
      const byLocation = new Map();
      for (const r of rows) {
        if (!byLocation.has(r.location_id)) byLocation.set(r.location_id, new Map());
        const variants = byLocation.get(r.location_id);
        const prev = variants.get(r.variant_id) || { units: 0, movements: [] };
        prev.units += r.units;
        prev.movements.push(r);
        variants.set(r.variant_id, prev);
      }

      if (dryRun) {
        console.log(
          `  [dry run] would raise ${byLocation.size} adjustment(s) for approval`,
        );
        continue;
      }

      for (const [location_id, variants] of byLocation) {
        const lines = [];
        for (const [variant_id, agg] of variants) {
          const system_count = await onHand(brand, variant_id, location_id);
          lines.push({
            variant_id,
            system_count,
            // The units exist physically — the system is short by the
            // duplicate draws.
            physical_count: system_count + agg.units,
            // Stamp the movement ids: this is both the audit trail for the
            // approver and what makes a re-run skip these movements.
            notes: `Double-deducted by Studio assignment. Jobs: ${agg.movements
              .map((m) => m.job_number)
              .join(", ")}. Movements: ${agg.movements
              .map((m) => m.movement_id)
              .join(", ")}`.slice(0, 500),
          });
        }

        const locName = variants.values().next().value.movements[0]
          .location_name;
        const totalUnits = lines.reduce(
          (s, l) => s + (l.physical_count - l.system_count),
          0,
        );

        const adj = await stockService.createAdjustment({
          brand,
          user,
          request_id: null,
          input: {
            location_id,
            // The units are physically present; only the count was wrong.
            adjustment_type: "found",
            reason:
              "Stock repair: wigs deducted twice (sale + Stylist Studio assignment). " +
              "Restores the units the duplicate Studio draw removed.",
            lines,
          },
        });
        await stockService.submitAdjustment({
          brand,
          user,
          request_id: null,
          id: adj.adjustment_id,
        });
        console.log(
          `  → ${adj.adjustment_number} submitted for approval: ` +
            `+${fmtNgn(totalUnits)} unit(s) across ${lines.length} SKU(s) @ ${
              locName || location_id.slice(0, 8)
            }`,
        );
      }
    }

    console.log(
      dryRun
        ? "\nDry run — nothing was written."
        : "\nDone. The adjustments are in Stock → Adjustments awaiting approval; " +
            "stock changes only once they are approved and posted.",
    );
  } catch (err) {
    console.error("Repair failed:", err.message);
    exitCode = 1;
  } finally {
    await closeDatabase();
    process.exit(exitCode);
  }
})();
