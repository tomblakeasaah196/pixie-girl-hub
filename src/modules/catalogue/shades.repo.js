/**
 * Product Shades (V2.2 §6.4 — "Shop by shade") — repository. Parameterised
 * SQL only.
 *
 * A shade is a STANDALONE storefront content entity (cover image, short + long
 * copy, SEO slug + meta) that sits beside Collections. STYLED products carry a
 * shade via styled_products.shade_id (one shade per listing); a base product
 * never does. Membership is therefore a column update, not a join table.
 *
 * Schema: {{BUSINESS}}.styled_shades (migration 000062) + meta_title /
 * meta_description (000063). Soft-delete via deleted_at gives Trash/Restore
 * parity with products; slug + shade_code are unique among LIVE rows only.
 */

"use strict";

const { ex } = require("../../config/database");
const { t } = require("../../config/brands");
// Client-settable columns. shade_code is generated server-side (NOT NULL,
// never patched here); created_by / deleted_at are set explicitly.
const SHADE_COLS = [
  "name",
  "slug",
  "short_description",
  "long_description",
  "cover_image_url",
  "display_order",
  "is_active",
  "meta_title",
  "meta_description",
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

/** All live shades for the brand, each with its live styled-product count. */
async function list({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT sh.*,
            (SELECT COUNT(*)::int FROM ${t(brand, "styled_products")} sp
              WHERE sp.shade_id = sh.shade_id AND sp.is_deleted = false)
              AS product_count
       FROM ${t(brand, "styled_shades")} sh
      WHERE sh.deleted_at IS NULL
      ORDER BY sh.display_order, sh.name`,
  );
  return rows;
}

async function getById({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "styled_shades")}
      WHERE shade_id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return rows[0] || null;
}

async function getBySlug({ client, brand, slug }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "styled_shades")}
      WHERE slug = $1 AND deleted_at IS NULL`,
    [slug],
  );
  return rows[0] || null;
}

/** Is this slug taken by a LIVE shade? (A trashed shade frees its slug.) */
async function slugTaken({ client, brand, slug }) {
  const { rows } = await ex(client)(
    `SELECT 1 FROM ${t(brand, "styled_shades")}
      WHERE slug = $1 AND deleted_at IS NULL LIMIT 1`,
    [slug],
  );
  return rows.length > 0;
}

/** Is this shade_code taken by a LIVE shade? */
async function codeTaken({ client, brand, code }) {
  const { rows } = await ex(client)(
    `SELECT 1 FROM ${t(brand, "styled_shades")}
      WHERE shade_code = $1 AND deleted_at IS NULL LIMIT 1`,
    [code],
  );
  return rows.length > 0;
}

async function create({ client, brand, input, shade_code, created_by }) {
  const { f, ph, p } = insert(SHADE_COLS, input, {
    shade_code,
    created_by: created_by ?? null,
  });
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "styled_shades")} (${f.join(",")})
     VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}

async function update({ client, brand, id, patch }) {
  const { f, p, next } = setClause(SHADE_COLS, patch);
  if (!f.length) return getById({ client, brand, id });
  p.push(id);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "styled_shades")} SET ${f.join(",")}
      WHERE shade_id = $${next} AND deleted_at IS NULL RETURNING *`,
    p,
  );
  return rows[0] || null;
}

/** Soft-delete (Trash). The FK is ON DELETE SET NULL, but we keep the row and
 *  clear membership ourselves so a future Restore is possible and the products
 *  are unshaded immediately. */
async function remove({ client, brand, id }) {
  const run = ex(client);
  // Unshade every styled product currently in this shade.
  await run(
    `UPDATE ${t(brand, "styled_products")}
        SET shade_id = NULL WHERE shade_id = $1`,
    [id],
  );
  const { rowCount } = await run(
    `UPDATE ${t(brand, "styled_shades")}
        SET deleted_at = now()
      WHERE shade_id = $1 AND deleted_at IS NULL`,
    [id],
  );
  return rowCount > 0;
}

/** The live styled products currently in this shade (storefront + admin). */
async function listMembers({ client, brand, shade_id }) {
  const { rows } = await ex(client)(
    `SELECT sp.styled_id, sp.name AS styled_name, sp.slug AS styled_slug,
            sp.status, sp.retail_price_ngn, sp.retail_price_usd,
            (SELECT pi.cdn_url FROM ${t(brand, "product_images")} pi
              WHERE pi.styled_id = sp.styled_id
              ORDER BY pi.is_primary DESC, pi.display_order LIMIT 1) AS image_url
       FROM ${t(brand, "styled_products")} sp
      WHERE sp.shade_id = $1 AND sp.is_deleted = false
      ORDER BY sp.name`,
    [shade_id],
  );
  return rows;
}

/** Every live styled product (id + name + code). Powers the import name→id
 *  resolution AND the template's Reference sheet of pickable product names. */
async function listStyledLookup({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT styled_id, name, styled_code
       FROM ${t(brand, "styled_products")}
      WHERE is_deleted = false
      ORDER BY name`,
  );
  return rows;
}

/** Live styled-product names grouped by the shade they belong to — the export
 *  "Products" cell for each shade (so a download re-imports its membership). */
async function styledNamesByShade({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT shade_id, name
       FROM ${t(brand, "styled_products")}
      WHERE shade_id IS NOT NULL AND is_deleted = false
      ORDER BY name`,
  );
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.shade_id)) map.set(r.shade_id, []);
    map.get(r.shade_id).push(r.name);
  }
  return map;
}

/** Bulk-assign styled products to a shade (the Flow-2 "select all → add").
 *  Re-homes a product even if it was on another shade. Returns rows affected. */
async function assignMembers({ client, brand, shade_id, styled_ids }) {
  if (!styled_ids || styled_ids.length === 0) return 0;
  const { rowCount } = await ex(client)(
    `UPDATE ${t(brand, "styled_products")}
        SET shade_id = $1
      WHERE styled_id = ANY($2::uuid[]) AND is_deleted = false`,
    [shade_id, styled_ids],
  );
  return rowCount;
}

/** Remove one styled product from a shade (clears its shade_id). */
async function unassignMember({ client, brand, shade_id, styled_id }) {
  const { rowCount } = await ex(client)(
    `UPDATE ${t(brand, "styled_products")}
        SET shade_id = NULL
      WHERE styled_id = $1 AND shade_id = $2 AND is_deleted = false`,
    [styled_id, shade_id],
  );
  return rowCount > 0;
}

module.exports = {
  SHADE_COLS,
  list,
  getById,
  getBySlug,
  slugTaken,
  codeTaken,
  create,
  update,
  remove,
  listMembers,
  listStyledLookup,
  styledNamesByShade,
  assignMembers,
  unassignMember,
};
