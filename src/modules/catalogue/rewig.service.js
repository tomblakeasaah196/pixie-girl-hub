/**
 * Rewig adjacency (000088) — ONE shared decision used by every checkout path
 * that resolves a styled colour×size variant to a physical base for stock:
 * storefront cart/checkout, sales-campaign landing pages, and WhatsApp
 * order-links each used to carry their own copy of "pick the base variant."
 * Fragmenting the rewig fallback into three near-identical copies would have
 * let them drift, so the decision itself lives here — each caller keeps its
 * own existing variant-lookup query, just asks this module for the donor
 * PRODUCT id first.
 */

"use strict";

const { query } = require("../../config/database");
const repo = require("./styled_variants.repo");

/** Run on the caller's transaction when one is supplied, else the pool. */
const ex = (client) =>
  client ? client.query.bind(client) : (sql, params) => query(sql, params);

/**
 * Sellable stock behind one base product (all its active variants).
 *
 * `location_id` scopes the sum to the single location a sale reserves against;
 * without it the sum spans every storefront-sellable location. Reservation
 * callers MUST pass it — an unscoped sum reports stock the reserve cannot
 * reach, which is exactly how an in-stock item ends up pre-ordered.
 */
async function productAvailableStock({
  client,
  brand,
  product_id,
  location_id = null,
}) {
  if (!product_id) return 0;
  const { rows } = await ex(client)(
    `SELECT COALESCE(SUM(sl.available), 0)::int AS available
       FROM ${brand}.stock_levels sl
       JOIN ${brand}.product_variants pv ON pv.variant_id = sl.variant_id
       JOIN ${brand}.stock_locations loc ON loc.location_id = sl.location_id
      WHERE pv.product_id = $1
        AND pv.is_active = true
        AND CASE WHEN $2::uuid IS NOT NULL
                 THEN sl.location_id = $2::uuid
                 ELSE loc.is_active = true AND loc.available_for_storefront = true
            END`,
    [product_id, location_id],
  );
  return rows[0] ? rows[0].available : 0;
}

/**
 * Decide whether an order for `quantity` units of `originProductId` should
 * draw from a size-adjacent sibling base instead of its own — one size up or
 * down ONLY, same styling job, no separate service or SKU. Governed entirely
 * by Catalogue → Config → Rewig settings (master switch, automatic/opt-in
 * mode, direction preference) plus `styled.rewig_override` when the caller
 * has a styled_products row in hand (pass `{ rewig_override }` or omit for
 * base-product-only lines, which just follow the brand mode).
 *
 * Returns the donor's products.product_id, or null when the origin's own
 * stock already covers `quantity`, rewig doesn't apply, or no eligible
 * sibling has enough — callers resolve null themselves via whichever
 * default/sellable-variant lookup they already use, exactly as before this
 * existed (the existing pre-order / "unavailable" handling is untouched).
 */
async function pickRewigDonorProductId({
  client,
  brand,
  styled,
  originProductId,
  quantity,
  location_id = null,
}) {
  if (!originProductId) return null;
  const cfg = await repo.getConfig({ client, brand });
  if (!cfg || !cfg.rewig_enabled) return null;

  const override = styled ? styled.rewig_override : null;
  const allowed =
    override === "enabled"
      ? true
      : override === "disabled"
        ? false
        : cfg.rewig_mode === "automatic";
  if (!allowed) return null;

  const ownAvailable = await productAvailableStock({
    client,
    brand,
    product_id: originProductId,
    location_id,
  });
  const qty = Number(quantity) || 1;
  if (ownAvailable >= qty) return null;

  const siblings = await repo.listRewigSiblings({
    client,
    brand,
    base_product_id: originProductId,
    location_id,
  });
  const withEnough = siblings.filter((s) => s.available >= qty);
  if (!withEnough.length) return null;

  const direction = cfg.rewig_direction || "down_first";
  withEnough.sort((a, b) => {
    if (direction === "down_first") return a.size_diff - b.size_diff;
    if (direction === "up_first") return b.size_diff - a.size_diff;
    return b.available - a.available; // no_preference: most stock first
  });
  return withEnough[0].product_id;
}

module.exports = { productAvailableStock, pickRewigDonorProductId };
