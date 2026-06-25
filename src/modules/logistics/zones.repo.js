/**
 * Delivery zones — repository (per-brand {{BUSINESS}}.delivery_zones).
 * Geometry is JSONB; the point-in-zone test runs in zones.service.
 */

"use strict";

const { query } = require("../../config/database");
const { t } = require("../../config/brands");

async function list({ brand }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "delivery_zones")}
      ORDER BY priority DESC, name`,
  );
  return rows;
}

/** Active zones, optionally scoped to a country (NULL country = any). */
async function listActive({ brand, country_code }) {
  const params = [];
  let where = "WHERE is_active = true";
  if (country_code) {
    params.push(country_code);
    where += ` AND (country_code IS NULL OR country_code = $1)`;
  }
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "delivery_zones")} ${where}
      ORDER BY priority DESC`,
    params,
  );
  return rows;
}

async function getById({ brand, id }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "delivery_zones")} WHERE zone_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function create({ brand, z, user_id }) {
  const { rows } = await query(
    `INSERT INTO ${t(brand, "delivery_zones")}
       (name, description, geometry_type, geometry, fee_ngn, country_code,
        priority, is_active, rate_card, courier_key, is_free_delivery, created_by)
     VALUES ($1,$2,$3,$4::jsonb,COALESCE($5,0),$6,COALESCE($7,0),COALESCE($8,true),$9::jsonb,$10,COALESCE($11,false),$12)
     RETURNING *`,
    [
      z.name,
      z.description || null,
      z.geometry_type,
      JSON.stringify(z.geometry || {}),
      z.fee_ngn,
      z.country_code || null,
      z.priority,
      z.is_active,
      JSON.stringify(z.rate_card || { tiers: [] }),
      z.courier_key || null,
      z.is_free_delivery === undefined ? null : z.is_free_delivery,
      user_id || null,
    ],
  );
  return rows[0];
}

async function update({ brand, id, patch }) {
  const cols = [
    "name",
    "description",
    "geometry_type",
    "fee_ngn",
    "country_code",
    "priority",
    "is_active",
    "courier_key",
    "is_free_delivery",
  ];
  const set = [];
  const params = [id];
  let i = 2;
  for (const c of cols) {
    if (patch[c] === undefined) continue;
    set.push(`${c} = $${i++}`);
    params.push(patch[c]);
  }
  if (patch.geometry !== undefined) {
    set.push(`geometry = $${i++}::jsonb`);
    params.push(JSON.stringify(patch.geometry));
  }
  if (patch.rate_card !== undefined) {
    set.push(`rate_card = $${i++}::jsonb`);
    params.push(JSON.stringify(patch.rate_card));
  }
  if (!set.length) return getById({ brand, id });
  const { rows } = await query(
    `UPDATE ${t(brand, "delivery_zones")} SET ${set.join(", ")}, updated_at = now()
      WHERE zone_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function remove({ brand, id }) {
  const { rowCount } = await query(
    `DELETE FROM ${t(brand, "delivery_zones")} WHERE zone_id = $1`,
    [id],
  );
  return rowCount > 0;
}

module.exports = { list, listActive, getById, create, update, remove };
