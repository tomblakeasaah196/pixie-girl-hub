/**
 * Rewig adjacency (000088) — ONE shared decision used by every path that
 * resolves a styled colour×size variant to a physical base for stock:
 * storefront cart/checkout, sales-campaign landing pages, WhatsApp
 * order-links, sales-channel order creation, and the Change Order amendment
 * reconciler. Fragmented into near-identical copies, the fallback drifts; so
 * the decision itself lives here — each caller keeps its own existing
 * variant-lookup query, just asks this module for the donor PRODUCT id, or
 * calls `resolveDonorVariant` for the donor product AND the concrete variant
 * that can actually cover the units.
 */

"use strict";

const { query } = require("../../config/database");
const repo = require("./styled_variants.repo");
const stockRepo = require("../stock/stock.repo");
const { logger } = require("../../config/logger");

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

/**
 * The donor sibling a stock-short order line can actually be fulfilled from —
 * donor PRODUCT and the concrete VARIANT holding the units at `location_id`.
 *
 * `pickRewigDonorProductId` above answers "which sibling base, if any"; a
 * reservation needs a variant, and the two reads have to agree: the donor
 * decision is location-scoped, and so is the variant lookup
 * (`variantWithStockForProduct`), or the named sibling looks stocked while the
 * reserve it feeds finds nothing on the shelf and the line pre-orders anyway.
 *
 * Shared by the two engines that move stock for an order line — `createOrder`
 * (sales.service) at placement, and the amendment reconciler (amendment.service)
 * when a change adds units — so a Change Order falls back to an adjacent size
 * exactly as the original sale would have. Returning the donor's VARIANT is what
 * lets a caller re-point the line at the unit it is really taking.
 *
 * `quantity` is the number of units this decision must cover (the whole line at
 * placement; the net delta on an amendment). A donor is only returned when it
 * can cover ALL of them — a partial fill is not a substitution, it is a
 * pre-order with extra steps.
 *
 * Returns null whenever rewig is switched off, the listing opted out, the line
 * has no base, no sibling has enough, or the lookup itself failed — callers
 * fall through to their existing pre-order path, never to an exception. A donor
 * lookup must never cost an order; the reads are read-only, so there is no
 * partial state to unwind.
 */
async function resolveDonorVariant({
  client,
  brand,
  line,
  quantity,
  location_id = null,
}) {
  if (!line || !line.product_id || !location_id) return null;
  try {
    // rewig_override is a per-listing opt in/out that beats the brand mode.
    // A non-styled line has no listing row and simply follows the brand mode.
    let styled = null;
    if (line.styled_id) {
      const { rows } = await ex(client)(
        `SELECT rewig_override FROM ${brand}.styled_products WHERE styled_id = $1`,
        [line.styled_id],
      );
      styled = rows[0] || null;
    }
    const donorProductId = await pickRewigDonorProductId({
      client,
      brand,
      styled,
      originProductId: line.product_id,
      quantity,
      location_id,
    });
    if (!donorProductId) return null;

    const variant = await stockRepo.variantWithStockForProduct({
      client,
      brand,
      product_id: donorProductId,
      location_id,
      quantity,
    });
    if (!variant) return null;

    const { rows: prod } = await ex(client)(
      `SELECT name FROM ${brand}.products WHERE product_id = $1`,
      [donorProductId],
    );
    return {
      product_id: donorProductId,
      product_name: prod[0] ? prod[0].name : "sibling size",
      variant_id: variant.variant_id,
      sku: variant.sku,
      available: Number(variant.available) || 0,
      origin_variant_id: line.variant_id || null,
    };
  } catch (err) {
    logger.warn(
      { err: err.message, line_id: line.line_id },
      "rewig donor lookup failed — falling through to pre-order",
    );
    return null;
  }
}

module.exports = {
  productAvailableStock,
  pickRewigDonorProductId,
  resolveDonorVariant,
};
