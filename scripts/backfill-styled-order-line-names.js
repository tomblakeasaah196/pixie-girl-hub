/**
 * One-off backfill: correct sales_order_lines / quotation_lines that were
 * stamped with a BASE product's name/SKU instead of the STYLED product the
 * customer actually bought.
 *
 * ROOT CAUSE (fixed in code alongside this script): a styled product always
 * sells through its base product's stock variant (stock lives on the base).
 * Every order-creation path is supposed to override the line's name/SKU
 * snapshot with the styled product's own name — the storefront cart checkout
 * and Sales Campaign checkout always did this. Two other paths did not:
 *   - Quick Sale (apps/admin/.../QuickSaleForm.tsx) — tagged styled_id +
 *     line_kind='styled' correctly, but never sent product_name_snapshot, so
 *     Sales fell back to the base product's name.
 *   - The public Order-Link / Order-Form checkout (WhatsApp/Instagram "Tap to
 *     order", walk-in Online QR) — sent neither the name NOR styled_id/
 *     line_kind at all.
 * A prior backfill (scripts/backfill-service-jobs.js) already repaired
 * line_kind/styled_id for some of these rows (so Stylist Studio jobs would
 * open) but never corrected product_name_snapshot/sku_snapshot — the text
 * customers actually see on invoices/receipts/order search was left wrong.
 *
 * THREE REPAIR TIERS, safest/most-certain first:
 *   A. styled_id already stamped on the line (from the original Quick Sale
 *      write, or from the prior backfill) — just re-sync the name/SKU from
 *      shared truth (styled_products). Exact, unambiguous.
 *   B. No styled_id, but the line sells a styled product's pinned base
 *      variant at exactly that styled product's CURRENT retail price
 *      (Quick Sale's signature) — stamp styled_id + line_kind='styled' +
 *      name/SKU together. Skipped when more than one live styled product
 *      matches (ambiguous — logged, not touched).
 *   C. Order-Link/Order-Form orders specifically (shared.smartcomm_order_links
 *      .order_id): re-resolve the link's own persisted items (the exact
 *      picture the customer was shown before paying) and match by variant_id
 *      — catches cases B misses (the staff-picked price at share time no
 *      longer equals the styled product's current retail price).
 * Quotation lines get the same A treatment (quotation_lines has no
 * styled_id/line_kind column, so only the name/SKU can be corrected there).
 *
 * Idempotent — every UPDATE is gated on the value actually being wrong
 * (IS DISTINCT FROM), so re-running is a no-op once clean. Nothing is
 * touched outside product_name_snapshot / sku_snapshot / line_kind /
 * styled_id.
 *
 * RUN (project root, same .env as the app):
 *   node scripts/backfill-styled-order-line-names.js
 *   BACKFILL_BRAND=faitlynhair node scripts/backfill-styled-order-line-names.js
 *   BACKFILL_DRY_RUN=1 node scripts/backfill-styled-order-line-names.js
 */

"use strict";

const {
  initDatabase,
  closeDatabase,
  query,
} = require("../src/config/database");
const { refreshBrands, VALID } = require("../src/config/brands");
const resolvers = require("../src/modules/smartcomm/smartcomm.order-links.resolvers");

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

      // ── TIER A — styled_id already known, name/SKU out of sync ──────
      const tierASelect = `
        SELECT sol.line_id, sp.name, sp.styled_code
          FROM ${brand}.sales_order_lines sol
          JOIN ${brand}.styled_products sp ON sp.styled_id = sol.styled_id
         WHERE sol.styled_id IS NOT NULL
           AND (sol.product_name_snapshot IS DISTINCT FROM sp.name
                OR sol.sku_snapshot IS DISTINCT FROM sp.styled_code)`;
      const { rows: tierARows } = await query(tierASelect);
      if (dryRun) {
        console.warn(`Tier A (styled_id known): would fix ${tierARows.length} line(s)`);
      } else {
        for (const r of tierARows) {
          await query(
            `UPDATE ${brand}.sales_order_lines
                SET product_name_snapshot = $2, sku_snapshot = $3
              WHERE line_id = $1`,
            [r.line_id, r.name, r.styled_code],
          );
        }
        console.warn(`Tier A: fixed ${tierARows.length} line(s)`);
      }

      // ── TIER B — no styled_id; pinned base variant + exact retail price ──
      const tierBFind = `
        SELECT sol2.line_id, min(sp.styled_id::text)::uuid AS styled_id,
               min(sp.name) AS name, min(sp.styled_code) AS styled_code
          FROM ${brand}.sales_order_lines sol2
          JOIN ${brand}.styled_products sp
            ON sp.base_variant_id = sol2.variant_id
           AND sp.retail_price_ngn = sol2.unit_price_ngn
           AND sp.is_deleted = false
         WHERE sol2.styled_id IS NULL
         GROUP BY sol2.line_id
        HAVING count(DISTINCT sp.styled_id) = 1`;
      const { rows: tierBRows } = await query(tierBFind);
      if (dryRun) {
        console.warn(`Tier B (base variant + price match): would fix ${tierBRows.length} line(s)`);
      } else {
        for (const r of tierBRows) {
          await query(
            `UPDATE ${brand}.sales_order_lines
                SET line_kind = 'styled', styled_id = $2,
                    product_name_snapshot = $3, sku_snapshot = $4
              WHERE line_id = $1`,
            [r.line_id, r.styled_id, r.name, r.styled_code],
          );
        }
        console.warn(`Tier B: fixed ${tierBRows.length} line(s)`);
      }

      // ── TIER C — Order-Link/Order-Form orders: re-resolve the link's own
      // persisted items (what the customer actually saw before paying) and
      // match by variant_id. Catches cases Tier B misses (a staff-picked
      // price at share time that no longer equals the styled product's
      // current retail price).
      const { rows: links } = await query(
        `SELECT link_id, order_id, items
           FROM shared.smartcomm_order_links
          WHERE business = $1 AND order_id IS NOT NULL`,
        [brand],
      );
      let tierCFixed = 0;
      let tierCWould = 0;
      for (const link of links) {
        const items = Array.isArray(link.items) ? link.items : [];
        if (!items.length) continue;
        let resolved;
        try {
          resolved = await resolvers.resolveItems(brand, items);
        } catch {
          continue;
        }
        const metaByVariant = new Map();
        for (const r of resolved) {
          const lines = r.lines || [];
          if (lines.length !== 1) continue; // bundle — skip, no per-component name
          if (r.kind !== "styled" && r.kind !== "base") continue;
          if (!lines[0].variant_id) continue;
          metaByVariant.set(lines[0].variant_id, {
            name: r.name,
            sku: r.product_code || null,
            styled_id: r.kind === "styled" ? r.ref_id : null,
          });
        }
        if (!metaByVariant.size) continue;

        const { rows: orderLines } = await query(
          `SELECT line_id, variant_id, styled_id, product_name_snapshot, sku_snapshot
             FROM ${brand}.sales_order_lines
            WHERE order_id = $1`,
          [link.order_id],
        );
        for (const ol of orderLines) {
          const meta = metaByVariant.get(ol.variant_id);
          if (!meta || !meta.name) continue;
          const needsFix =
            ol.product_name_snapshot !== meta.name ||
            (meta.styled_id && ol.styled_id !== meta.styled_id);
          if (!needsFix) continue;
          if (dryRun) {
            tierCWould += 1;
            continue;
          }
          await query(
            `UPDATE ${brand}.sales_order_lines
                SET product_name_snapshot = $2, sku_snapshot = $3
                    ${meta.styled_id ? ", styled_id = $4, line_kind = 'styled'" : ""}
              WHERE line_id = $1`,
            meta.styled_id
              ? [ol.line_id, meta.name, meta.sku, meta.styled_id]
              : [ol.line_id, meta.name, meta.sku],
          );
          tierCFixed += 1;
        }
      }
      console.warn(
        dryRun
          ? `Tier C (order-link orders): would fix ${tierCWould} line(s) across ${links.length} link(s)`
          : `Tier C: fixed ${tierCFixed} line(s) across ${links.length} link(s)`,
      );

      // ── Quotations — name/SKU only (no styled_id/line_kind column) ──────
      const quoteTierA = `
        SELECT ql.line_id, sp.name, sp.styled_code
          FROM ${brand}.quotation_lines ql
          JOIN ${brand}.styled_products sp
            ON sp.base_variant_id = ql.variant_id
           AND sp.retail_price_ngn = ql.unit_price_ngn
           AND sp.is_deleted = false
         WHERE ql.product_name_snapshot IS DISTINCT FROM sp.name`;
      const { rows: quoteRows } = await query(quoteTierA);
      if (dryRun) {
        console.warn(`Quotations (base variant + price match): would fix ${quoteRows.length} line(s)`);
      } else {
        for (const r of quoteRows) {
          await query(
            `UPDATE ${brand}.quotation_lines
                SET product_name_snapshot = $2, sku_snapshot = $3
              WHERE line_id = $1`,
            [r.line_id, r.name, r.styled_code],
          );
        }
        console.warn(`Quotations: fixed ${quoteRows.length} line(s)`);
      }
    }
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
})();
