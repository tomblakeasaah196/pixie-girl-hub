/**
 * Service Catalogue — parameterised SQL.
 */

"use strict";

const { query } = require("../../config/database");

async function listServices({ brand, category, active_only = true }) {
  const where = ["business = $1"];
  const params = [brand];
  let i = 2;
  if (active_only) where.push(`is_active = true`);
  if (category) {
    where.push(`category = $${i++}`);
    params.push(category);
  }
  const { rows } = await query(
    `SELECT * FROM shared.service_offerings
      WHERE ${where.join(" AND ")}
      ORDER BY sort_order ASC, name ASC`,
    params,
  );
  return rows;
}

async function getService({ brand, id }) {
  const { rows } = await query(
    `SELECT * FROM shared.service_offerings
      WHERE service_id = $1 AND business = $2`,
    [id, brand],
  );
  return rows[0] || null;
}

async function createService({ brand, user_id, input }) {
  const { rows } = await query(
    `INSERT INTO shared.service_offerings
       (business, name, slug, description, base_price_ngn, duration_minutes,
        category, image_url, is_active, sort_order, required_stylist_tier, created_by)
     VALUES ($1,$2,$3,$4,COALESCE($5,0),$6,$7,$8,COALESCE($9,true),COALESCE($10,0),$11,$12)
     RETURNING *`,
    [
      brand,
      input.name,
      input.slug,
      input.description || null,
      input.base_price_ngn || 0,
      input.duration_minutes || null,
      input.category || null,
      input.image_url || null,
      input.is_active,
      input.sort_order,
      input.required_stylist_tier || null,
      user_id || null,
    ],
  );
  return rows[0];
}

// Only updates the fields actually present in `input`. The previous version
// direct-SET duration_minutes / required_stylist_tier, so a partial PATCH (e.g.
// toggling is_active) silently WIPED them. A dynamic SET clause respects
// explicit nulls (clearing) without clobbering omitted fields.
const UPDATABLE_COLS = [
  "name",
  "slug",
  "description",
  "base_price_ngn",
  "duration_minutes",
  "category",
  "image_url",
  "is_active",
  "sort_order",
  "required_stylist_tier",
];
async function updateService({ brand, id, input }) {
  const sets = [];
  const params = [id, brand];
  let i = 3;
  for (const c of UPDATABLE_COLS) {
    if (input[c] === undefined) continue;
    sets.push(`${c} = $${i++}`);
    params.push(input[c]);
  }
  if (sets.length === 0) return getService({ brand, id });
  const { rows } = await query(
    `UPDATE shared.service_offerings SET ${sets.join(", ")}
      WHERE service_id = $1 AND business = $2 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function deleteService({ brand, id }) {
  // Soft delete via is_active=false to keep historical references.
  const { rows } = await query(
    `UPDATE shared.service_offerings
        SET is_active = false
      WHERE service_id = $1 AND business = $2 RETURNING service_id`,
    [id, brand],
  );
  return rows[0] || null;
}

module.exports = {
  listServices,
  getService,
  createService,
  updateService,
  deleteService,
};
