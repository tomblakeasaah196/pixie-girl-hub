/**
 * AI Model Catalogue — parameterised SQL.
 *
 * The catalogue is the data side of "model + pricing without code".
 * Cost rows are in NGN per 1M tokens; chat models split input/output,
 * embeddings only use input, audio uses the per-minute column.
 */

"use strict";

const { query } = require("../../config/database");
const { money } = require("../../utils/money");

async function list({ vendor, capability, active_only = true } = {}) {
  const where = [];
  const params = [];
  let i = 1;
  if (active_only) where.push("is_active = true");
  if (vendor) {
    where.push(`vendor = $${i++}`);
    params.push(vendor);
  }
  if (capability) {
    where.push(`capability = $${i++}`);
    params.push(capability);
  }
  const sql = `
    SELECT model_id, vendor, display_name, family, capability,
           context_window, supports_tools, supports_streaming,
           input_cost_per_1m_ngn, output_cost_per_1m_ngn,
           cost_per_audio_minute_ngn, is_default, is_active, notes,
           updated_at
      FROM shared.ai_model_catalogue
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY vendor, capability, is_default DESC, display_name`;
  const { rows } = await query(sql, params);
  return rows;
}

async function get(model_id) {
  const { rows } = await query(
    `SELECT * FROM shared.ai_model_catalogue WHERE model_id = $1`,
    [model_id],
  );
  return rows[0] || null;
}

/**
 * Resolve a model for a (vendor, capability) pair. Looks at the
 * vendor's `current_model` column first (CEO selection), else the
 * catalogue row flagged `is_default`. Returns the catalogue row OR
 * null when no model is configured for that pairing.
 */
async function resolveActiveModel({ vendor, capability = "chat" }) {
  const { rows } = await query(
    `WITH selected AS (
       SELECT v.current_model AS chosen
         FROM shared.ai_vendor_credentials v
        WHERE v.vendor = $1 AND v.is_active = true
        LIMIT 1
     )
     SELECT m.*
       FROM shared.ai_model_catalogue m
       LEFT JOIN selected s ON TRUE
      WHERE m.vendor = $1 AND m.capability = $2 AND m.is_active = true
        AND (
          (s.chosen IS NOT NULL AND m.model_id = s.chosen)
          OR (s.chosen IS NULL  AND m.is_default = true)
        )
      LIMIT 1`,
    [vendor, capability],
  );
  return rows[0] || null;
}

async function upsert({ user_id, input }) {
  const { rows } = await query(
    `INSERT INTO shared.ai_model_catalogue
       (model_id, vendor, display_name, family, capability,
        context_window, supports_tools, supports_streaming,
        input_cost_per_1m_ngn, output_cost_per_1m_ngn,
        cost_per_audio_minute_ngn, is_default, is_active, notes, updated_by)
     VALUES ($1,$2,$3,$4,COALESCE($5,'chat'),
             $6,COALESCE($7,false),COALESCE($8,true),
             COALESCE($9,0),COALESCE($10,0),
             COALESCE($11,0),COALESCE($12,false),COALESCE($13,true),$14,$15)
     ON CONFLICT (model_id) DO UPDATE
       SET vendor                    = EXCLUDED.vendor,
           display_name              = EXCLUDED.display_name,
           family                    = EXCLUDED.family,
           capability                = EXCLUDED.capability,
           context_window            = EXCLUDED.context_window,
           supports_tools            = EXCLUDED.supports_tools,
           supports_streaming        = EXCLUDED.supports_streaming,
           input_cost_per_1m_ngn     = EXCLUDED.input_cost_per_1m_ngn,
           output_cost_per_1m_ngn    = EXCLUDED.output_cost_per_1m_ngn,
           cost_per_audio_minute_ngn = EXCLUDED.cost_per_audio_minute_ngn,
           is_default                = EXCLUDED.is_default,
           is_active                 = EXCLUDED.is_active,
           notes                     = EXCLUDED.notes,
           updated_by                = EXCLUDED.updated_by,
           updated_at                = now()
     RETURNING *`,
    [
      input.model_id,
      input.vendor,
      input.display_name,
      input.family || null,
      input.capability,
      input.context_window || null,
      input.supports_tools,
      input.supports_streaming,
      input.input_cost_per_1m_ngn,
      input.output_cost_per_1m_ngn,
      input.cost_per_audio_minute_ngn,
      input.is_default,
      input.is_active,
      input.notes || null,
      user_id || null,
    ],
  );
  return rows[0];
}

/**
 * Compute NGN cost of one call from a (model_id, tokens) pair.
 * Returns a decimal string formatted at 4dp; safe to pass to
 * governance.recordUsage().
 */
function computeCost({ model, input_tokens, output_tokens }) {
  const inCost = money(input_tokens || 0)
    .div(1_000_000)
    .times(money(model.input_cost_per_1m_ngn || 0));
  const outCost = money(output_tokens || 0)
    .div(1_000_000)
    .times(money(model.output_cost_per_1m_ngn || 0));
  return inCost.plus(outCost).toFixed(4);
}

module.exports = { list, get, resolveActiveModel, upsert, computeCost };
