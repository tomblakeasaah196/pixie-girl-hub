"use strict";

const { ex } = require("../../config/database");
const { t } = require("../../config/brands");

// The UI never supplies these values. Do not use the generic base writer: a
// classified product's immutable identity and stock-only invariants are set
// here and backed by the 000094 CHECK / triggers.
async function create({ client, brand, input, user_id }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "products")}
      (product_code, name, slug, category_id, short_description, long_description,
       ingredients, directions, warnings, taxable, vat_rate, search_keywords,
       catalogue_role, retail_status, product_type, is_custom, track_stock,
       preorder_enabled, preorder_excluded, rewig_eligible, payment_model,
       is_visible_storefront, visible_on_channels, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
             'retail','draft','physical',false,true,false,true,false,'full_payment_only',
             false,ARRAY[]::text[],$13)
     RETURNING *`,
    [
      input.product_code, input.name, input.slug, input.category_id,
      input.short_description ?? null, input.long_description ?? null,
      input.ingredients ?? null, input.directions ?? null, input.warnings ?? null,
      input.taxable, input.vat_rate ?? null, input.search_keywords ?? [], user_id,
    ],
  );
  return rows[0];
}

const EDITABLE = [
  "name", "slug", "category_id", "short_description", "long_description",
  "ingredients", "directions", "warnings", "taxable", "vat_rate",
  "search_keywords",
];
async function update({ client, brand, id, patch }) {
  const cols = EDITABLE.filter((c) => patch[c] !== undefined);
  if (!cols.length) return null;
  const params = cols.map((c) => patch[c]);
  params.push(id);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "products")}
        SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(", ")},
            retail_status = 'draft'
      WHERE product_id = $${params.length} AND catalogue_role = 'retail'
        AND is_deleted = false RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function setStatus({ client, brand, id, status }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "products")}
        SET retail_status = $2,
            published_at = CASE WHEN $2 = 'live' THEN COALESCE(published_at, now())
                                ELSE published_at END
      WHERE product_id = $1 AND catalogue_role = 'retail' AND is_deleted = false
      RETURNING *`,
    [id, status],
  );
  return rows[0] || null;
}

async function categoryAllowed({ client, brand, id }) {
  const { rows } = await ex(client)(
    `WITH RECURSIVE parents AS (
       SELECT category_id, parent_category_id, slug, is_active
         FROM ${t(brand, "product_categories")} WHERE category_id = $1
       UNION ALL
       SELECT c.category_id, c.parent_category_id, c.slug, c.is_active
         FROM ${t(brand, "product_categories")} c
         JOIN parents p ON p.parent_category_id = c.category_id
     )
     SELECT EXISTS (
       SELECT 1 FROM parents
        WHERE slug = 'care-and-accessories' AND parent_category_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM parents WHERE is_active = false)
     ) AS allowed`,
    [id],
  );
  return rows[0]?.allowed === true;
}

async function categories({ client, brand }) {
  const { rows } = await ex(client)(
    `WITH RECURSIVE child AS (
       SELECT category_id, parent_category_id, name, slug, is_active, 0 AS depth
         FROM ${t(brand, "product_categories")}
        WHERE slug = 'care-and-accessories' AND parent_category_id IS NULL
       UNION ALL
       SELECT c.category_id, c.parent_category_id, c.name, c.slug,
              c.is_active, child.depth + 1
         FROM ${t(brand, "product_categories")} c
         JOIN child ON child.category_id = c.parent_category_id
        WHERE child.depth < 6
     )
     SELECT category_id, parent_category_id, name, slug, depth
       FROM child WHERE is_active = true ORDER BY depth, name`,
  );
  return rows;
}

async function priceAndMediaReady({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT
       (SELECT COUNT(*)::int FROM ${t(brand, "product_variants")} v
         WHERE v.product_id = $1 AND v.is_active = true) AS active_skus,
       (SELECT COUNT(*)::int FROM ${t(brand, "product_variants")} v
         WHERE v.product_id = $1 AND v.is_active = true
           AND (v.sku = '' OR v.variant_name = ''
                OR COALESCE(v.price_storefront_ngn, 0) <= 0
                OR COALESCE(v.price_pos_ngn, 0) <= 0)) AS invalid_skus,
       (SELECT COUNT(*)::int FROM ${t(brand, "product_images")} pi
         WHERE pi.product_id = $1) AS images`,
    [id],
  );
  return rows[0];
}

async function costHealth({ client, brand, id }) {
  // Only a boolean is exposed; operational weighted-average cost and the
  // encrypted true cost are never included in an ordinary catalogue DTO.
  const { rows } = await ex(client)(
    `SELECT v.variant_id,
            COALESCE(c.avg_cost_ngn > 0, false) AS has_operational_cost
       FROM ${t(brand, "product_variants")} v
       LEFT JOIN ${t(brand, "variant_costing")} c ON c.variant_id = v.variant_id
      WHERE v.product_id = $1`,
    [id],
  );
  return new Map(rows.map((r) => [r.variant_id, r.has_operational_cost]));
}

async function hasStock({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT EXISTS (
       SELECT 1 FROM ${t(brand, "product_variants")} pv
       JOIN ${t(brand, "stock_levels")} sl ON sl.variant_id = pv.variant_id
      WHERE pv.product_id = $1 AND (sl.on_hand <> 0 OR sl.reserved <> 0)
     ) AS stocked`,
    [id],
  );
  return rows[0].stocked;
}

// The list derives its cover from product_images. Atomically return the item
// to draft on every media change, so a removed photo cannot leave it live.
async function syncPrimaryImage({ client, brand, id }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "products")} p SET retail_status = 'draft'
      WHERE p.product_id = $1 AND p.catalogue_role = 'retail' AND p.is_deleted = false
      RETURNING p.product_id`,
    [id],
  );
  return rows[0] || null;
}

async function hasSkuHistory({ client, brand, variant_id }) {
  const { rows } = await ex(client)(
    `SELECT EXISTS (SELECT 1 FROM ${t(brand, "stock_levels")}
                     WHERE variant_id = $1 AND (on_hand <> 0 OR reserved <> 0))
         OR EXISTS (SELECT 1 FROM ${t(brand, "stock_movements")}
                     WHERE variant_id = $1)
         OR EXISTS (SELECT 1 FROM ${t(brand, "po_lines")}
                     WHERE variant_id = $1)
         OR EXISTS (SELECT 1 FROM ${t(brand, "inbound_shipment_lines")}
                     WHERE variant_id = $1) AS used`,
    [variant_id],
  );
  return rows[0].used;
}

async function deactivate({ client, brand, product_id, variant_id }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "product_variants")} SET is_active = false
      WHERE product_id = $1 AND variant_id = $2 AND is_default = false
        AND NOT EXISTS (
          SELECT 1 FROM ${t(brand, "stock_levels")} sl
           WHERE sl.variant_id = $2 AND (sl.on_hand <> 0 OR sl.reserved <> 0)
        )
        AND NOT EXISTS (
          SELECT 1 FROM ${t(brand, "po_lines")} pl
          JOIN ${t(brand, "purchase_orders")} po ON po.po_id = pl.po_id
           WHERE pl.variant_id = $2 AND pl.qty_outstanding > 0
             AND po.status NOT IN ('received', 'closed', 'cancelled')
        )
        AND NOT EXISTS (
          SELECT 1 FROM ${t(brand, "inbound_shipment_lines")} il
          JOIN ${t(brand, "inbound_shipments")} sh ON sh.shipment_id = il.shipment_id
           WHERE il.variant_id = $2
             AND sh.status NOT IN ('received', 'cancelled')
        ) RETURNING variant_id`,
    [product_id, variant_id],
  );
  return rows[0] || null;
}

async function trash({ client, brand, id }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "products")} p
        SET is_deleted = true, deleted_at = now(), retail_status = 'archived'
      WHERE p.product_id = $1 AND p.catalogue_role = 'retail'
        AND p.is_deleted = false
        AND NOT EXISTS (
          SELECT 1 FROM ${t(brand, "product_variants")} pv
          JOIN ${t(brand, "stock_levels")} sl ON sl.variant_id = pv.variant_id
          WHERE pv.product_id = p.product_id
            AND (sl.on_hand <> 0 OR sl.reserved <> 0)
        )
        AND NOT EXISTS (
          SELECT 1 FROM ${t(brand, "product_variants")} pv
          JOIN ${t(brand, "po_lines")} pl ON pl.variant_id = pv.variant_id
          JOIN ${t(brand, "purchase_orders")} po ON po.po_id = pl.po_id
          WHERE pv.product_id = p.product_id AND pl.qty_outstanding > 0
            AND po.status NOT IN ('received', 'closed', 'cancelled')
        )
        AND NOT EXISTS (
          SELECT 1 FROM ${t(brand, "product_variants")} pv
          JOIN ${t(brand, "inbound_shipment_lines")} il ON il.variant_id = pv.variant_id
          JOIN ${t(brand, "inbound_shipments")} sh ON sh.shipment_id = il.shipment_id
          WHERE pv.product_id = p.product_id
            AND sh.status NOT IN ('received', 'cancelled')
        ) RETURNING *`,
    [id],
  );
  return rows[0] || null;
}

async function trashed({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "products")}
      WHERE product_id = $1 AND catalogue_role = 'retail' AND is_deleted = true`,
    [id],
  );
  return rows[0] || null;
}

async function restore({ client, brand, id, slug, product_code }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "products")}
        SET is_deleted = false, deleted_at = null, retail_status = 'draft',
            slug = $2, product_code = $3
      WHERE product_id = $1 AND catalogue_role = 'retail' AND is_deleted = true
      RETURNING *`,
    [id, slug, product_code],
  );
  return rows[0] || null;
}

async function trashList({ client, brand, page_size, offset }) {
  const run = ex(client);
  const { rows: count } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "products")}
      WHERE catalogue_role = 'retail' AND is_deleted = true`,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "products")}
      WHERE catalogue_role = 'retail' AND is_deleted = true
      ORDER BY deleted_at DESC LIMIT $1 OFFSET $2`,
    [page_size, offset],
  );
  return { rows, total: count[0].total };
}

module.exports = {
  create, update, setStatus, categoryAllowed, categories, priceAndMediaReady,
  costHealth, hasStock, hasSkuHistory, syncPrimaryImage, deactivate, trash, trashed, restore, trashList,
};
