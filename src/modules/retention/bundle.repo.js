/**
 * Bundle offers repository (F-2 / PD §6.23.4). Per-brand tables
 * bundle_offers + bundle_offer_products.
 */

"use strict";

const { query } = require("../../config/database");
const { VALID } = require("../../config/brands");

const t = (b, tbl) => {
  if (!VALID.has(b)) throw new Error(`Invalid brand: ${b}`);
  return `${b}.${tbl}`;
};
const ex = (c) => (c ? c.query.bind(c) : query);

const BUNDLE_COLS = [
  "bundle_code",
  "display_name",
  "description",
  "pricing_model",
  "bundle_price_ngn",
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
];

function buildInsert(cols, src, extra = {}) {
  const f = [];
  const ph = [];
  const p = [];
  let i = 1;
  for (const c of cols) {
    if (src[c] === undefined) continue;
    f.push(c);
    ph.push(c === "qty_tiers" ? `$${i++}::jsonb` : `$${i++}`);
    p.push(c === "qty_tiers" ? JSON.stringify(src[c]) : src[c]);
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
       (bundle_id, product_id, variant_id, quantity, role, display_order)
     VALUES ($1,$2,$3,COALESCE($4,1),COALESCE($5,'core'),COALESCE($6,0)) RETURNING *`,
    [
      bundle_id,
      component.product_id || null,
      component.variant_id || null,
      component.quantity,
      component.role,
      component.display_order,
    ],
  );
  return rows[0];
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
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "bundle_offer_products")}
      WHERE bundle_id = $1 ORDER BY display_order`,
    [bundle_id],
  );
  return rows;
}

async function list({ brand, only_active, storefront }) {
  const where = [];
  if (only_active) where.push("is_active = true");
  if (storefront) where.push("is_visible_storefront = true");
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "bundle_offers")} ${w} ORDER BY display_order, created_at DESC`,
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
    k === "qty_tiers" ? `${k} = $${i + 2}::jsonb` : `${k} = $${i + 2}`,
  );
  const vals = keys.map((k) =>
    k === "qty_tiers" ? JSON.stringify(patch[k]) : patch[k],
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

module.exports = {
  createBundle,
  addComponent,
  removeComponent,
  listComponents,
  list,
  getById,
  update,
  setActive,
  bumpUsage,
};
