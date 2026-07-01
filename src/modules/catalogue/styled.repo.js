/**
 * Styled products (V2.2 §6.4 P0-6) — repository. Parameterised SQL only.
 *
 * A styled product is a storefront skin over exactly one base product
 * (the row in `products`, which is the only stock-bearing record). This
 * layer also resolves base availability (for the OOS / pre-order cascade)
 * by reading stock_levels for the base's variants.
 */

"use strict";

const { query } = require("../../config/database");
const { VALID } = require("../../config/brands");

const t = (b, tbl) => {
  if (!VALID.has(b)) throw new Error(`Invalid brand: ${b}`);
  return `${b}.${tbl}`;
};
const ex = (c) => (c ? c.query.bind(c) : query);

// Resolve a styled product's module-card hero, in priority order: the explicit
// primary_image_id → the default colour's first picture → any picture on the
// styled product. Used by list + detail so the module shows imagery, not just
// the website.
function primaryImageSql(brand, alias) {
  return `COALESCE(
    (SELECT pi.cdn_url FROM ${t(brand, "product_images")} pi
      WHERE pi.image_id = ${alias}.primary_image_id),
    (SELECT pi.cdn_url FROM ${t(brand, "product_images")} pi
       JOIN ${t(brand, "styled_product_colours")} col ON col.colour_id = pi.styled_colour_id
      WHERE col.styled_id = ${alias}.styled_id
      ORDER BY col.is_default DESC, col.display_order, pi.display_order LIMIT 1),
    (SELECT pi.cdn_url FROM ${t(brand, "product_images")} pi
      WHERE pi.styled_id = ${alias}.styled_id
      ORDER BY pi.is_primary DESC, pi.display_order LIMIT 1))`;
}

const STYLED_COLS = [
  "base_product_id",
  "base_variant_id",
  "name",
  "slug",
  "short_description",
  "long_description",
  // Styled retail is its OWN price (the size-S anchor). style_addon_price_ngn
  // is retained for legacy rows but is no longer the pricing source.
  "retail_price_ngn",
  "retail_price_usd",
  "compare_at_price_ngn",
  "compare_at_price_usd",
  "style_addon_price_ngn",
  "category_id",
  "visible_on_channels",
  "meta_title",
  "meta_description",
  "search_keywords",
  // Lace constructions this styled offers (NULL/empty = inherit the base set).
  "lace_size_codes",
  // Explicit module-card hero (NULL = default colour's first picture).
  "primary_image_id",
  // "Shop by shade" section membership (NULL = unshaded). One shade per listing.
  "shade_id",
];

function insert(cols, src, extra = {}) {
  const f = [];
  const ph = [];
  const p = [];
  let i = 1;
  for (const c of cols) {
    if (src[c] === undefined) continue;
    f.push(c);
    ph.push(`$${i}`);
    p.push(src[c]);
    i++;
  }
  for (const [c, v] of Object.entries(extra)) {
    f.push(c);
    ph.push(`$${i}`);
    p.push(v);
    i++;
  }
  return { f, ph, p };
}
function setClause(cols, src, start = 1) {
  const f = [];
  const p = [];
  let i = start;
  for (const c of cols) {
    if (src[c] === undefined) continue;
    f.push(`${c} = $${i}`);
    p.push(src[c]);
    i++;
  }
  return { f, p, next: i };
}

async function nextCode({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT ${t(brand, "fn_next_document_number")}($1) AS num`,
    ["styled_product"],
  );
  return rows[0].num;
}

async function list({
  client,
  brand,
  filters = {},
  page = 1,
  page_size = 25,
  offset = 0,
}) {
  const where = ["s.is_deleted = false"];
  const params = [];
  let i = 1;
  if (filters.base_product_id) {
    where.push(`s.base_product_id = $${i++}`);
    params.push(filters.base_product_id);
  }
  if (filters.status) {
    where.push(`s.status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.category_id) {
    where.push(`s.category_id = $${i++}`);
    params.push(filters.category_id);
  }
  if (filters.q) {
    where.push(
      `(s.name ILIKE $${i} OR s.styled_code ILIKE $${i} OR s.slug ILIKE $${i})`,
    );
    params.push(`%${filters.q}%`);
    i++;
  }
  const w = `WHERE ${where.join(" AND ")}`;
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "styled_products")} s ${w}`,
    params,
  );
  // Availability + base price are resolved INLINE via LATERAL joins so the
  // list is a single query instead of an N+1 (two extra queries per row in
  // the old enrich loop). The base's pre-order fields are also selected here
  // so list cards can show the production-framed state (the old query omitted
  // them, so styled cards always read "out of stock" when a base hit zero).
  const { rows } = await run(
    `SELECT s.*, b.name AS base_name, b.product_code AS base_product_code,
            b.preorder_enabled, b.expected_ready_date, b.production_lead_days,
            b.lace_size_codes AS base_lace_size_codes,
            COALESCE(av.available, 0) AS base_available,
            pr.price_storefront_ngn AS base_price_storefront_ngn,
            ${primaryImageSql(brand, "s")} AS primary_image_url
       FROM ${t(brand, "styled_products")} s
       JOIN ${t(brand, "products")} b ON b.product_id = s.base_product_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(sl.available), 0)::int AS available
           FROM ${t(brand, "stock_levels")} sl
           JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = sl.variant_id
          WHERE CASE WHEN s.base_variant_id IS NOT NULL
                     THEN sl.variant_id = s.base_variant_id
                     ELSE pv.product_id = s.base_product_id AND pv.is_active = true
                END
       ) av ON true
       LEFT JOIN LATERAL (
         SELECT pv2.price_storefront_ngn
           FROM ${t(brand, "product_variants")} pv2
          WHERE CASE WHEN s.base_variant_id IS NOT NULL
                     THEN pv2.variant_id = s.base_variant_id
                     ELSE pv2.product_id = s.base_product_id AND pv2.is_active = true
                END
          ORDER BY pv2.is_default DESC, pv2.display_order ASC
          LIMIT 1
       ) pr ON true
       ${w}
      ORDER BY s.created_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, page_size, offset],
  );
  return {
    data: rows,
    meta: {
      page,
      page_size,
      total: c[0].total,
      has_more: offset + rows.length < c[0].total,
    },
  };
}

async function getById({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT s.*, b.name AS base_name, b.product_code AS base_product_code,
            b.preorder_enabled, b.expected_ready_date, b.production_lead_days,
            b.lace_size_codes AS base_lace_size_codes,
            ${primaryImageSql(brand, "s")} AS primary_image_url
       FROM ${t(brand, "styled_products")} s
       JOIN ${t(brand, "products")} b ON b.product_id = s.base_product_id
      WHERE s.styled_id = $1 AND s.is_deleted = false`,
    [id],
  );
  return rows[0] || null;
}

async function baseProduct({ client, brand, base_product_id }) {
  const { rows } = await ex(client)(
    `SELECT product_id, name, product_code, is_deleted, track_stock,
            preorder_enabled, expected_ready_date, production_lead_days,
            lace_size_codes
       FROM ${t(brand, "products")} WHERE product_id = $1`,
    [base_product_id],
  );
  return rows[0] || null;
}

async function create({ client, brand, row }) {
  // styled_code is generated server-side (not a client-supplied column),
  // so it lives in the extras here, never in STYLED_COLS.
  const { f, ph, p } = insert(STYLED_COLS, row, {
    styled_code: row.styled_code,
    created_by: row.created_by ?? null,
  });
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "styled_products")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}

async function update({ client, brand, id, patch }) {
  const { f, p, next } = setClause(STYLED_COLS, patch);
  if (!f.length) return getById({ client, brand, id });
  p.push(id);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "styled_products")} SET ${f.join(",")}
      WHERE styled_id = $${next} AND is_deleted = false RETURNING *`,
    p,
  );
  return rows[0] || null;
}

async function setStatus({ client, brand, id, status, fields = {} }) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = $${i++}`);
    params.push(v);
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "styled_products")} SET ${sets.join(", ")}
      WHERE styled_id = $1 AND is_deleted = false RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function softDelete({ client, brand, id }) {
  const { rowCount } = await ex(client)(
    `UPDATE ${t(brand, "styled_products")}
        SET is_deleted = true, deleted_at = now(), is_visible_storefront = false
      WHERE styled_id = $1 AND is_deleted = false`,
    [id],
  );
  return rowCount > 0;
}

// ── Trash + Restore (names are partial-unique over live rows, 000041) ──
async function listTrashed({
  client,
  brand,
  page = 1,
  page_size = 25,
  offset = 0,
}) {
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "styled_products")} WHERE is_deleted = true`,
  );
  const { rows } = await run(
    `SELECT s.*, b.name AS base_name, b.product_code AS base_product_code,
            (s.deleted_at + INTERVAL '15 days') AS purge_at
       FROM ${t(brand, "styled_products")} s
       JOIN ${t(brand, "products")} b ON b.product_id = s.base_product_id
      WHERE s.is_deleted = true
      ORDER BY s.deleted_at DESC NULLS LAST LIMIT $1 OFFSET $2`,
    [page_size, offset],
  );
  return {
    data: rows,
    meta: {
      page,
      page_size,
      total: c[0].total,
      has_more: offset + rows.length < c[0].total,
    },
  };
}
async function getTrashedById({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "styled_products")} WHERE styled_id = $1 AND is_deleted = true`,
    [id],
  );
  return rows[0] || null;
}
async function styledSlugTaken({ client, brand, slug }) {
  const { rows } = await ex(client)(
    `SELECT 1 FROM ${t(brand, "styled_products")} WHERE slug = $1 AND is_deleted = false LIMIT 1`,
    [slug],
  );
  return rows.length > 0;
}
async function styledCodeTaken({ client, brand, code }) {
  const { rows } = await ex(client)(
    `SELECT 1 FROM ${t(brand, "styled_products")} WHERE styled_code = $1 AND is_deleted = false LIMIT 1`,
    [code],
  );
  return rows.length > 0;
}
async function restore({ client, brand, id, slug, styled_code }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "styled_products")}
        SET is_deleted = false, deleted_at = null,
            slug = COALESCE($2, slug), styled_code = COALESCE($3, styled_code)
      WHERE styled_id = $1 AND is_deleted = true RETURNING *`,
    [id, slug || null, styled_code || null],
  );
  return rows[0] || null;
}

/**
 * Total available units for the base behind a styled product. When the
 * styled row pins a base_variant_id we sum just that variant; otherwise we
 * sum every active variant of the base. This is the number that drives the
 * out-of-stock / pre-order cascade.
 */
async function baseAvailability({
  client,
  brand,
  base_product_id,
  base_variant_id,
}) {
  if (base_variant_id) {
    const { rows } = await ex(client)(
      `SELECT COALESCE(SUM(available), 0)::int AS available
         FROM ${t(brand, "stock_levels")} WHERE variant_id = $1`,
      [base_variant_id],
    );
    return rows[0].available;
  }
  const { rows } = await ex(client)(
    `SELECT COALESCE(SUM(sl.available), 0)::int AS available
       FROM ${t(brand, "stock_levels")} sl
       JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = sl.variant_id
      WHERE pv.product_id = $1 AND pv.is_active = true`,
    [base_product_id],
  );
  return rows[0].available;
}

/**
 * Storefront selling price of the base behind a styled product: the pinned
 * base variant's price, else the base's default (then first) active variant.
 * The styling add-on is layered on top in the service.
 */
async function basePrice({ client, brand, base_product_id, base_variant_id }) {
  if (base_variant_id) {
    const { rows } = await ex(client)(
      `SELECT price_storefront_ngn FROM ${t(brand, "product_variants")} WHERE variant_id = $1`,
      [base_variant_id],
    );
    return rows[0] ? rows[0].price_storefront_ngn : null;
  }
  const { rows } = await ex(client)(
    `SELECT price_storefront_ngn FROM ${t(brand, "product_variants")}
      WHERE product_id = $1 AND is_active = true
      ORDER BY is_default DESC, display_order ASC
      LIMIT 1`,
    [base_product_id],
  );
  return rows[0] ? rows[0].price_storefront_ngn : null;
}

// ── Stylist Studio: production DNA + default materials (BOM) ──
async function setProduction({ brand, id, patch }) {
  const sets = [];
  const params = [id];
  let i = 2;
  for (const k of [
    "default_service_type_id",
    "default_recipe_id",
    "standard_turnaround_days",
  ]) {
    if (patch[k] !== undefined) {
      sets.push(`${k} = $${i++}`);
      params.push(patch[k]);
    }
  }
  if (patch.sop_steps !== undefined) {
    sets.push(`sop_steps = $${i++}::jsonb`);
    params.push(JSON.stringify(patch.sop_steps ?? []));
  }
  if (!sets.length) return getById({ brand, id });
  const { rows } = await query(
    `UPDATE ${t(brand, "styled_products")}
        SET ${sets.join(", ")}, updated_at = now()
      WHERE styled_id = $1
      RETURNING styled_id, default_service_type_id, default_recipe_id,
                standard_turnaround_days, sop_steps`,
    params,
  );
  return rows[0] || null;
}
async function listBom({ brand, styled_id }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "styled_product_bom")}
      WHERE styled_id = $1 ORDER BY display_order, created_at`,
    [styled_id],
  );
  return rows;
}
async function addBom({ brand, styled_id, item }) {
  const { rows } = await query(
    `INSERT INTO ${t(brand, "styled_product_bom")}
       (styled_id, kind, variant_id, default_quantity, chemical_name, display_order)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,0)) RETURNING *`,
    [
      styled_id,
      item.kind,
      item.variant_id || null,
      item.default_quantity ?? null,
      item.chemical_name || null,
      item.display_order ?? null,
    ],
  );
  return rows[0];
}
async function deleteBom({ brand, styled_id, bom_id }) {
  const { rowCount } = await query(
    `DELETE FROM ${t(brand, "styled_product_bom")}
      WHERE bom_id = $1 AND styled_id = $2`,
    [bom_id, styled_id],
  );
  return rowCount > 0;
}

module.exports = {
  nextCode,
  list,
  getById,
  baseProduct,
  basePrice,
  create,
  update,
  setStatus,
  softDelete,
  listTrashed,
  getTrashedById,
  styledSlugTaken,
  styledCodeTaken,
  restore,
  baseAvailability,
  setProduction,
  listBom,
  addBom,
  deleteBom,
};
