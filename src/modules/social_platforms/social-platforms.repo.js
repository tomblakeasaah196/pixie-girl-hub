/**
 * Social platform registry — parameterised SQL over
 * shared.social_platforms. See migration 000340 for why this exists: an
 * admin adding "X" or "Pinterest" is a row insert here, not a schema change.
 */

"use strict";

const { query } = require("../../config/database");

const COLUMNS = `
  platform_key, display_name, brand_color, icon_glyph, apify_actor_id,
  apify_input_template, metrics_schema, supports_bio, is_active,
  sort_order, notes, created_by, created_at, updated_at
`;

async function list({ includeInactive = true } = {}) {
  const where = includeInactive ? "" : "WHERE is_active = true";
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM shared.social_platforms
      ${where}
      ORDER BY sort_order, display_name`,
  );
  return rows;
}

async function get({ key }) {
  const { rows } = await query(
    `SELECT ${COLUMNS} FROM shared.social_platforms WHERE platform_key = $1`,
    [key],
  );
  return rows[0] || null;
}

async function create({ input, created_by }) {
  const { rows } = await query(
    `INSERT INTO shared.social_platforms
       (platform_key, display_name, brand_color, icon_glyph, apify_actor_id,
        apify_input_template, metrics_schema, supports_bio, sort_order, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,'{}'::jsonb),COALESCE($7,'[]'::jsonb),
             COALESCE($8,true),COALESCE($9,100),$10,$11)
     RETURNING ${COLUMNS}`,
    [
      input.platform_key,
      input.display_name,
      input.brand_color,
      input.icon_glyph || "",
      input.apify_actor_id || null,
      input.apify_input_template ? JSON.stringify(input.apify_input_template) : null,
      input.metrics_schema ? JSON.stringify(input.metrics_schema) : null,
      input.supports_bio,
      input.sort_order,
      input.notes || null,
      created_by,
    ],
  );
  return rows[0];
}

async function update({ key, fields }) {
  const cols = Object.keys(fields);
  if (!cols.length) return get({ key });
  const jsonCols = new Set(["apify_input_template", "metrics_schema"]);
  const set = cols.map((col, i) => `${col} = $${i + 2}`);
  const values = cols.map((col) =>
    jsonCols.has(col) ? JSON.stringify(fields[col]) : fields[col],
  );
  const { rows } = await query(
    `UPDATE shared.social_platforms SET ${set.join(", ")}, updated_at = now()
      WHERE platform_key = $1
      RETURNING ${COLUMNS}`,
    [key, ...values],
  );
  return rows[0] || null;
}

async function setActive({ key, is_active }) {
  const { rows } = await query(
    `UPDATE shared.social_platforms SET is_active = $2, updated_at = now()
      WHERE platform_key = $1
      RETURNING ${COLUMNS}`,
    [key, is_active],
  );
  return rows[0] || null;
}

module.exports = { list, get, create, update, setActive };
