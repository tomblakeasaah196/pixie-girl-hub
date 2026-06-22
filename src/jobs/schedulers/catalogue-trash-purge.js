/**
 * Catalogue Trash purge sweep.
 *
 * Daily. Hard-deletes styled products, colours, and variants that have sat in
 * Trash longer than the 15-day grace window (owner directive, June 2026 — "15
 * days and they are gone forever, completely purged"). The admin Trash UI shows
 * each row's purge date (deleted_at + 15 days) so nothing disappears unannounced;
 * there is no manual purge button — this sweep is the only thing that hard-deletes.
 *
 * Order: products first (their colours/variants/images cascade via FK), then
 * colours trashed under still-live products (their variants/images cascade),
 * then any variant trashed on its own. Per-brand so each schema is swept.
 */

"use strict";

const { query } = require("../../config/database");
const { BRANDS } = require("../../config/brands");
const { logger } = require("../../config/logger");

// Grace period before a trashed catalogue row is purged for good.
const PURGE_AFTER_DAYS = 15;

async function purgeBrand(brand) {
  const cutoff = `now() - INTERVAL '${PURGE_AFTER_DAYS} days'`;
  // Whole styled products — colours, variants, images cascade on delete.
  const products = await query(
    `DELETE FROM ${brand}.styled_products
      WHERE is_deleted = true AND deleted_at IS NOT NULL AND deleted_at < ${cutoff}`,
  );
  // Colours trashed under a still-live product — their variants/images cascade.
  const colours = await query(
    `DELETE FROM ${brand}.styled_product_colours
      WHERE is_deleted = true AND deleted_at IS NOT NULL AND deleted_at < ${cutoff}`,
  );
  // Variants trashed on their own (parent product/colour still live).
  const variants = await query(
    `DELETE FROM ${brand}.styled_product_variants
      WHERE is_deleted = true AND deleted_at IS NOT NULL AND deleted_at < ${cutoff}`,
  );
  return {
    products: products.rowCount,
    colours: colours.rowCount,
    variants: variants.rowCount,
  };
}

async function runCatalogueTrashPurge() {
  let totals = { products: 0, colours: 0, variants: 0 };
  for (const brand of BRANDS) {
    try {
      const r = await purgeBrand(brand);
      totals = {
        products: totals.products + r.products,
        colours: totals.colours + r.colours,
        variants: totals.variants + r.variants,
      };
    } catch (err) {
      logger.error({ err, brand }, "catalogue trash purge failed for brand");
    }
  }
  if (totals.products || totals.colours || totals.variants) {
    logger.info(totals, "catalogue trash purged (15-day window)");
  }
  return totals;
}

module.exports = { runCatalogueTrashPurge, PURGE_AFTER_DAYS };
