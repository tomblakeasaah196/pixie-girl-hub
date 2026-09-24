/**
 * Common typed retail sellable resolver — PR 2 of PXG Care & Accessories.
 *
 * ONE server-side authority on whether a Care & Accessories SKU may be sold,
 * on which channel, at what live price, with what stock picture. Every retail
 * sales surface (storefront cart/quote/checkout, staff Quick Sale pickers,
 * quotations, amendments) resolves through this module so the policy cannot
 * drift between five different callers.
 *
 * The policy (owner contract, docs/PXG_RETAIL_PRODUCTS_FEASIBILITY.md):
 *   1. Brand + capability: `pixiegirl` only, PXG rollout flag on. FLH (or a
 *      forged cross-brand payload) gets a 404 — never a retail object.
 *   2. Product role/lifecycle: catalogue_role = 'retail', retail_status =
 *      'live', not deleted. Draft/archived/trashed items are unsellable.
 *   3. Variant ownership: the EXACT requested variant — no default-variant
 *      fallback, no size substitution — must be active on that product.
 *   4. Price: the variant's live channel price, strictly positive. A zero or
 *      missing price is unsellable rather than a silent ₦0 line.
 *   5. Stock: sellable-location availability (active, storefront-sellable
 *      locations only). Retail is stock-only — the preorder/rewig exclusion
 *      is carried on the product (000094 CHECK) and re-asserted here for the
 *      public availability payloads.
 *
 * The module never writes; it only resolves. Reservation happens in the
 * normal stock engine at order placement.
 */

"use strict";

const { query } = require("../../config/database");
const { t } = require("../../config/brands");
const gate = require("./care-accessories.gate");
const { AppError, NotFoundError } = require("../../utils/errors");

const ex = (client) => (client ? client.query.bind(client) : query);

/** Live channel price for a retail variant row — mirrors sales channel-price
 *  tiers but NEVER falls through to another tier silently: a retail SKU is
 *  sellable on a channel only when that channel's own price is positive. */
function retailChannelPrice(row, channel) {
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  if (channel === "pos" || channel === "quick_sale")
    return num(row.price_pos_ngn) ?? num(row.price_storefront_ngn);
  if (channel === "wholesale" || channel === "intercompany")
    return num(row.price_wholesale_ngn) ?? num(row.price_storefront_ngn);
  if (channel === "partner" || channel === "stylist_routed")
    return num(row.price_partner_ngn) ?? num(row.price_storefront_ngn);
  return num(row.price_storefront_ngn) ?? num(row.price_pos_ngn);
}

function sqlFor(brand) {
  return `
  SELECT pv.variant_id, pv.product_id, pv.sku, pv.barcode, pv.variant_name,
         pv.is_default, pv.display_order,
         pv.price_storefront_ngn, pv.price_pos_ngn, pv.price_wholesale_ngn,
         pv.price_partner_ngn, pv.price_storefront_usd, pv.price_pos_usd,
         p.name, p.product_code, p.slug, p.catalogue_role, p.retail_status,
         p.is_deleted, p.taxable, p.vat_rate, p.category_id,
         p.short_description, p.long_description, p.ingredients, p.directions,
         p.warnings,
         (SELECT COALESCE(SUM(sl.available), 0)::int
            FROM ${t(brand, "stock_levels")} sl
           WHERE sl.variant_id = pv.variant_id
             AND EXISTS (
               SELECT 1 FROM ${t(brand, "stock_locations")} loc
                WHERE loc.location_id = sl.location_id
                  AND loc.is_active = true
                  AND loc.available_for_storefront = true
             )) AS sellable_available,
         (SELECT COALESCE(pi.cdn_url, pi.file_path)
            FROM ${t(brand, "product_images")} pi
           WHERE pi.product_id = pv.product_id AND pi.styled_id IS NULL
           ORDER BY pi.is_primary DESC, pi.display_order
           LIMIT 1) AS image_url
    FROM ${t(brand, "product_variants")} pv
    JOIN ${t(brand, "products")} p ON p.product_id = pv.product_id
`;
}

/**
 * Assert the row is a sellable retail SKU and shape the typed projection.
 * Throws NotFoundError (404) for anything unpublished/deleted/wrong-role and
 * AppError RETAIL_UNPRICED when the channel price is missing/zero — callers
 * surface both as "not available" rather than a broken line.
 */
function assertSellable(row, { channel, brand }) {
  if (!row) throw new NotFoundError("Product");
  if (row.catalogue_role !== "retail")
    throw new NotFoundError("Product"); // a base wig id is not a retail SKU
  if (row.is_deleted || row.retail_status !== "live")
    throw new NotFoundError("Product");
  if (!row.variant_name && !row.sku) throw new NotFoundError("Product SKU");
  const unit_price_ngn = retailChannelPrice(row, channel);
  if (unit_price_ngn === null || !(unit_price_ngn > 0))
    throw new AppError(
      "RETAIL_UNPRICED",
      "This item has no live selling price on this channel",
      409,
      { user_message: "This item is not currently available for purchase." },
    );
  return {
    kind: "retail",
    brand,
    product_id: row.product_id,
    variant_id: row.variant_id,
    sku: row.sku,
    barcode: row.barcode || null,
    name: row.name,
    product_code: row.product_code,
    slug: row.slug,
    variant_label: row.variant_name,
    is_default_variant: row.is_default,
    category_id: row.category_id || null,
    unit_price_ngn,
    unit_price_usd:
      channel === "pos" || channel === "quick_sale"
        ? row.price_pos_usd === null || row.price_pos_usd === undefined
          ? row.price_storefront_usd === null || row.price_storefront_usd === undefined
            ? null
            : Number(row.price_storefront_usd)
          : Number(row.price_pos_usd)
        : row.price_storefront_usd === null || row.price_storefront_usd === undefined
          ? null
          : Number(row.price_storefront_usd),
    taxable: row.taxable === true,
    vat_rate: row.vat_rate === null ? null : Number(row.vat_rate),
    available: Number(row.sellable_available) || 0,
    image_url: row.image_url || null,
    // Stock-only invariants surfaced for callers/validators:
    preorder: false,
    rewig_eligible: false,
  };
}

/**
 * Resolve ONE exact retail variant for a sales path. `variant_id` is
 * mandatory — the resolver never picks a default bottle size on the caller's
 * behalf. `product_id`, when given, must own the variant (mismatch = 404).
 */
async function resolveSellableVariant({
  client,
  brand,
  variant_id,
  product_id = null,
  channel = "storefront",
}) {
  gate.requireEnabled(brand);
  if (!variant_id)
    throw new AppError(
      "RETAIL_VARIANT_REQUIRED",
      "An exact Care & Accessories SKU is required",
      422,
    );
  const { rows } = await ex(client)(
    `${sqlFor(brand)} WHERE pv.variant_id = $1 AND pv.is_active = true`,
    [variant_id],
  );
  const row = rows[0];
  if (row && product_id && row.product_id !== product_id)
    throw new NotFoundError("Product");
  return assertSellable(row, { channel, brand });
}

/** Batch variant contexts for lines already resolved elsewhere (cart quote,
 *  checkout re-validation). Returns a Map keyed by variant_id of typed
 *  projections; rows that fail the sellable policy are simply absent — the
 *  caller treats absence as "no longer available". */
async function resolveSellableVariants({
  client,
  brand,
  variant_ids,
  channel = "storefront",
}) {
  const out = new Map();
  const ids = [...new Set((variant_ids || []).filter(Boolean))];
  if (!ids.length) return out;
  gate.requireEnabled(brand);
  const { rows } = await ex(client)(
    `${sqlFor(brand)}
      WHERE pv.variant_id = ANY($1::uuid[]) AND pv.is_active = true`,
    [ids],
  );
  for (const row of rows) {
    try {
      out.set(row.variant_id, assertSellable(row, { channel, brand }));
    } catch (_e) {
      /* unpublished/unpriced/wrong-role rows resolve to nothing */
    }
  }
  return out;
}

/**
 * Public/staff listing of sellable retail SKUs. One row per ACTIVE variant so
 * a 50 ml / 100 ml product appears as two distinct, individually sellable
 * options. Search covers product name, product code, SKU, option label and
 * barcode — the contract from the owner decisions.
 */
async function listSellable({
  client,
  brand,
  q = null,
  category_id = null,
  page = 1,
  page_size = 25,
  channel = "storefront",
}) {
  gate.requireEnabled(brand);
  const where = [
    "p.catalogue_role = 'retail'",
    "p.retail_status = 'live'",
    "p.is_deleted = false",
    "pv.is_active = true",
    // An unpriced SKU is never listed — staff and customers alike only see
    // what can actually be charged right now.
    "COALESCE(pv.price_storefront_ngn, pv.price_pos_ngn) > 0",
  ];
  const params = [];
  let i = 1;
  if (category_id) {
    where.push(`p.category_id = $${i++}`);
    params.push(category_id);
  }
  if (q && String(q).trim()) {
    const like = `%${String(q).trim()}%`;
    where.push(
      `(p.name ILIKE $${i} OR p.product_code ILIKE $${i} OR pv.sku ILIKE $${i}
        OR pv.variant_name ILIKE $${i} OR COALESCE(pv.barcode,'') ILIKE $${i}
        OR COALESCE(p.search_keywords, '{}')::text ILIKE $${i})`,
    );
    params.push(like);
    i += 1;
  }
  const offset = Math.max(0, (page - 1) * page_size);
  const { rows } = await ex(client)(
    `${sqlFor(brand)}
      WHERE ${where.join(" AND ")}
      ORDER BY p.name, pv.display_order, pv.sku
      LIMIT $${i++} OFFSET $${i++}`,
    [...params, page_size, offset],
  );
  const { rows: c } = await ex(client)(
    `SELECT count(*)::int AS n FROM ${t(brand, "product_variants")} pv
       JOIN ${t(brand, "products")} p ON p.product_id = pv.product_id
      WHERE ${where.join(" AND ")}`,
    params,
  );
  const total = c[0] ? c[0].n : 0;
  const data = [];
  for (const r of rows) {
    try {
      data.push(assertSellable(r, { channel, brand }));
    } catch (_e) {
      /* defensive: unpriced on this channel → not listed */
    }
  }
  return {
    data,
    meta: { page, page_size, total, has_more: page * page_size < total },
  };
}

/**
 * Public retail product detail by slug (canonical /care-and-accessories/:slug
 * route). Only live, undeleted retail products resolve; everything else is a
 * plain 404 so unpublished items cannot be probed by URL.
 */
async function getProductBySlug({ client, brand, slug }) {
  gate.requireEnabled(brand);
  const { rows } = await ex(client)(
    `SELECT product_id FROM ${t(brand, "products")}
      WHERE slug = $1 AND catalogue_role = 'retail'
        AND retail_status = 'live' AND is_deleted = false`,
    [slug],
  );
  if (!rows[0]) throw new NotFoundError("Product");
  const product_id = rows[0].product_id;
  const { rows: variants } = await ex(client)(
    `${sqlFor(brand)}
      WHERE pv.product_id = $1 AND pv.is_active = true
        AND p.catalogue_role = 'retail' AND p.retail_status = 'live'
        AND p.is_deleted = false
      ORDER BY pv.display_order, pv.sku`,
    [product_id],
  );
  if (!variants.length) throw new NotFoundError("Product");
  const options = [];
  for (const v of variants) {
    try {
      options.push(assertSellable(v, { channel: "storefront", brand }));
    } catch (_e) {
      /* an unpriced option is hidden, never sold */
    }
  }
  if (!options.length) throw new NotFoundError("Product");
  const head = variants[0];
  return {
    kind: "retail",
    brand,
    product_id,
    slug: head.slug,
    name: head.name,
    product_code: head.product_code,
    category_id: head.category_id || null,
    short_description: head.short_description || null,
    long_description: head.long_description || null,
    ingredients: head.ingredients || null,
    directions: head.directions || null,
    warnings: head.warnings || null,
    image_url: head.image_url || null,
    taxable: head.taxable === true,
    vat_rate: head.vat_rate === null ? null : Number(head.vat_rate),
    options,
  };
}

/** Does this cart/order line set contain retail? Used by checkout delivery
 *  policy + deposit enforcement. Pure read, brand-gated by the caller. */
async function retailVariantIds({ client, brand, variant_ids }) {
  const ids = [...new Set((variant_ids || []).filter(Boolean))];
  if (!ids.length) return new Set();
  const { rows } = await ex(client)(
    `SELECT pv.variant_id
       FROM ${t(brand, "product_variants")} pv
       JOIN ${t(brand, "products")} p ON p.product_id = pv.product_id
      WHERE pv.variant_id = ANY($1::uuid[]) AND p.catalogue_role = 'retail'`,
    [ids],
  );
  return new Set(rows.map((r) => r.variant_id));
}

module.exports = {
  retailChannelPrice,
  resolveSellableVariant,
  resolveSellableVariants,
  listSellable,
  getProductBySlug,
  retailVariantIds,
};
