/**
 * Bundle offers repository (F-2 / PD §6.23.4). Per-brand tables
 * bundle_offers + bundle_offer_products.
 */

"use strict";

const { query, ex } = require("../../config/database");
const { t } = require("../../config/brands");
const BUNDLE_COLS = [
  "bundle_code",
  "display_name",
  "description",
  "pricing_model",
  "bundle_price_ngn",
  "bundle_price_usd",
  "discount_value",
  "buy_quantity",
  "get_quantity",
  "get_discount_pct",
  "qty_tiers",
  "valid_from",
  "valid_to",
  "requires_all_components_in_stock",
  "total_usage_limit",
  "per_customer_limit",
  "is_visible_storefront",
  "hero_image_url",
  "display_order",
  "is_active",
  // Collage cover (template 000063): the editable badge/font/palette settings
  // and a marker for "this hero was generated" (drives the restyle-all action).
  "collage_settings",
  "cover_is_generated",
];

// Columns whose value is a JS object/array bound as ::jsonb.
const JSONB_COLS = new Set(["qty_tiers", "collage_settings"]);

function buildInsert(cols, src, extra = {}) {
  const f = [];
  const ph = [];
  const p = [];
  let i = 1;
  for (const c of cols) {
    if (src[c] === undefined) continue;
    f.push(c);
    ph.push(JSONB_COLS.has(c) ? `$${i++}::jsonb` : `$${i++}`);
    p.push(JSONB_COLS.has(c) ? JSON.stringify(src[c]) : src[c]);
  }
  for (const [c, v] of Object.entries(extra)) {
    f.push(c);
    ph.push(`$${i++}`);
    p.push(v);
  }
  return { f, ph, p };
}

async function createBundle({ client, brand, input, user_id }) {
  const { f, ph, p } = buildInsert(BUNDLE_COLS, input, {
    created_by: user_id || null,
  });
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "bundle_offers")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}

async function addComponent({ client, brand, bundle_id, component }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "bundle_offer_products")}
       (bundle_id, product_id, variant_id, styled_id, quantity, role, display_order)
     VALUES ($1,$2,$3,$4,COALESCE($5,1),COALESCE($6,'core'),COALESCE($7,0)) RETURNING *`,
    [
      bundle_id,
      component.product_id || null,
      component.variant_id || null,
      component.styled_id || null,
      component.quantity,
      component.role,
      component.display_order,
    ],
  );
  return rows[0];
}

/** The one-click flag: may base products join a bundle? Default false —
 *  only styled products may. Set in the Catalogue config tab. */
async function allowBaseTargets({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT allow_base_in_collections_bundles AS allow
       FROM ${t(brand, "catalogue_config")} WHERE singleton = true`,
  );
  return rows[0] ? rows[0].allow === true : false;
}

async function removeComponent({ brand, bundle_id, bundle_product_id }) {
  const { rowCount } = await query(
    `DELETE FROM ${t(brand, "bundle_offer_products")}
      WHERE bundle_id = $1 AND bundle_product_id = $2`,
    [bundle_id, bundle_product_id],
  );
  return rowCount > 0;
}

async function listComponents({ client, brand, bundle_id }) {
  // Unit price for the subtotal preview: the specific variant's price when the
  // component pins a variant, else the product's default-variant storefront
  // price. NULL-safe — a freshly created base may not be priced yet.
  const { rows } = await ex(client)(
    `SELECT bop.*,
            COALESCE(p.name, sp.name) AS product_name,
            COALESCE(p.product_code, sp.styled_code) AS product_code,
            sp.name AS styled_name, sp.slug AS styled_slug, sp.status AS styled_status,
            COALESCE(
              v.price_storefront_ngn,
              (SELECT dv.price_storefront_ngn
                 FROM ${t(brand, "product_variants")} dv
                WHERE dv.product_id = bop.product_id
                ORDER BY dv.is_default DESC, dv.display_order
                LIMIT 1),
              sp.retail_price_ngn
            ) AS unit_price_ngn,
            -- The component's display photo for the collage: the styled hero
            -- (explicit primary → default colour's first picture → any picture)
            -- then the base product's primary image as a last resort.
            COALESCE(
              (SELECT pi.cdn_url FROM ${t(brand, "product_images")} pi
                WHERE pi.image_id = sp.primary_image_id),
              (SELECT pi.cdn_url FROM ${t(brand, "product_images")} pi
                 JOIN ${t(brand, "styled_product_colours")} col
                   ON col.colour_id = pi.styled_colour_id
                WHERE col.styled_id = bop.styled_id
                ORDER BY col.is_default DESC, col.display_order, pi.display_order
                LIMIT 1),
              (SELECT pi.cdn_url FROM ${t(brand, "product_images")} pi
                WHERE pi.styled_id = bop.styled_id
                ORDER BY pi.is_primary DESC, pi.display_order LIMIT 1),
              (SELECT pi.cdn_url FROM ${t(brand, "product_images")} pi
                WHERE pi.product_id = bop.product_id
                ORDER BY pi.is_primary DESC, pi.display_order LIMIT 1)
            ) AS image_url
       FROM ${t(brand, "bundle_offer_products")} bop
       LEFT JOIN ${t(brand, "products")} p ON p.product_id = bop.product_id
       LEFT JOIN ${t(brand, "product_variants")} v ON v.variant_id = bop.variant_id
       LEFT JOIN ${t(brand, "styled_products")} sp ON sp.styled_id = bop.styled_id
      WHERE bop.bundle_id = $1 ORDER BY bop.display_order`,
    [bundle_id],
  );
  return rows;
}

async function list({ brand, only_active, storefront }) {
  const where = [];
  if (only_active) where.push("b.is_active = true");
  if (storefront) where.push("b.is_visible_storefront = true");
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  // Pre-aggregate each bundle's component subtotal + unit count so the service
  // can derive the effective price/saving for the cards without fetching every
  // component (no N+1). The unit-price COALESCE mirrors listComponents exactly:
  // pinned variant price → product default-variant price → styled retail.
  const { rows } = await query(
    `SELECT b.*,
            COALESCE(agg.subtotal, 0) AS component_subtotal_ngn,
            COALESCE(agg.units, 0)    AS unit_count
       FROM ${t(brand, "bundle_offers")} b
       LEFT JOIN LATERAL (
         SELECT SUM(
                  COALESCE(
                    v.price_storefront_ngn,
                    (SELECT dv.price_storefront_ngn
                       FROM ${t(brand, "product_variants")} dv
                      WHERE dv.product_id = bop.product_id
                      ORDER BY dv.is_default DESC, dv.display_order
                      LIMIT 1),
                    sp.retail_price_ngn,
                    0
                  ) * COALESCE(bop.quantity, 1)
                ) AS subtotal,
                SUM(COALESCE(bop.quantity, 1)) AS units
           FROM ${t(brand, "bundle_offer_products")} bop
           LEFT JOIN ${t(brand, "product_variants")} v ON v.variant_id = bop.variant_id
           LEFT JOIN ${t(brand, "styled_products")} sp ON sp.styled_id = bop.styled_id
          WHERE bop.bundle_id = b.bundle_id
       ) agg ON true
       ${w}
      ORDER BY b.display_order, b.created_at DESC`,
  );
  return rows;
}

async function getById({ brand, id }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "bundle_offers")} WHERE bundle_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const components = await listComponents({ brand, bundle_id: id });
  return { ...rows[0], components };
}

async function update({ brand, id, patch }) {
  const keys = Object.keys(patch).filter((k) => BUNDLE_COLS.includes(k));
  if (keys.length === 0) return getById({ brand, id });
  const sets = keys.map((k, i) =>
    JSONB_COLS.has(k) ? `${k} = $${i + 2}::jsonb` : `${k} = $${i + 2}`,
  );
  const vals = keys.map((k) =>
    JSONB_COLS.has(k) ? JSON.stringify(patch[k]) : patch[k],
  );
  const { rows } = await query(
    `UPDATE ${t(brand, "bundle_offers")} SET ${sets.join(", ")}, updated_at = now()
      WHERE bundle_id = $1 RETURNING *`,
    [id, ...vals],
  );
  return rows[0] || null;
}

async function bumpUsage({ client, brand, bundle_id }) {
  const q = client ? client.query.bind(client) : query;
  await q(
    `UPDATE ${t(brand, "bundle_offers")} SET total_used = total_used + 1, updated_at = now()
      WHERE bundle_id = $1`,
    [bundle_id],
  );
}

async function setActive({ brand, id, is_active }) {
  const { rows } = await query(
    `UPDATE ${t(brand, "bundle_offers")} SET is_active = $2, updated_at = now()
      WHERE bundle_id = $1 RETURNING *`,
    [id, is_active],
  );
  return rows[0] || null;
}

/** The brand's branding row for the collage palette (accent + gradient ramp).
 *  business_key === the brand schema key. */
async function brandBranding({ brand }) {
  const { rows } = await query(
    `SELECT accent_colour, secondary_colour, brand_theme
       FROM shared.business_config WHERE business_key = $1`,
    [brand],
  );
  return rows[0] || null;
}

/** Ids of every bundle whose hero was generated (the restyle-all target). */
async function listGeneratedIds({ brand }) {
  const { rows } = await query(
    `SELECT bundle_id FROM ${t(brand, "bundle_offers")}
      WHERE cover_is_generated = true
      ORDER BY display_order, created_at DESC`,
  );
  return rows.map((r) => r.bundle_id);
}

/** Hard-delete a bundle. Component rows cascade via the FK. */
async function remove({ brand, id }) {
  const { rowCount } = await query(
    `DELETE FROM ${t(brand, "bundle_offers")} WHERE bundle_id = $1`,
    [id],
  );
  return rowCount > 0;
}

module.exports = {
  createBundle,
  addComponent,
  allowBaseTargets,
  removeComponent,
  listComponents,
  list,
  getById,
  update,
  setActive,
  remove,
  bumpUsage,
  brandBranding,
  listGeneratedIds,
};
