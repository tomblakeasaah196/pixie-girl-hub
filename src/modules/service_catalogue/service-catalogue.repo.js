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

async function updateService({ brand, id, input }) {
  const { rows } = await query(
    `UPDATE shared.service_offerings
        SET name                  = COALESCE($3, name),
            description           = COALESCE($4, description),
            base_price_ngn        = COALESCE($5, base_price_ngn),
            duration_minutes      = $6,
            category              = COALESCE($7, category),
            image_url             = COALESCE($8, image_url),
            is_active             = COALESCE($9, is_active),
            sort_order            = COALESCE($10, sort_order),
            required_stylist_tier = $11
      WHERE service_id = $1 AND business = $2 RETURNING *`,
    [
      id,
      brand,
      input.name || null,
      input.description || null,
      input.base_price_ngn || null,
      input.duration_minutes === undefined ? null : input.duration_minutes,
      input.category || null,
      input.image_url || null,
      input.is_active === undefined ? null : input.is_active,
      input.sort_order === undefined ? null : input.sort_order,
      input.required_stylist_tier === undefined
        ? null
        : input.required_stylist_tier,
    ],
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
