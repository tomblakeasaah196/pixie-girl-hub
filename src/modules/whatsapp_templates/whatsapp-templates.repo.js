/**
 * WhatsApp Templates — parameterised SQL over shared.whatsapp_templates
 * and shared.whatsapp_template_rates.
 *
 * Both tables are per-brand (keyed on the `business` text column, same
 * convention as shared.messaging_accounts). Every query is scoped by
 * brand — the caller passes req.brand through the service.
 */

"use strict";

const { query } = require("../../config/database");

const COLUMNS = `
  template_id, business, meta_template_id, name, language, category,
  status, components, body_text, variables, quality_score,
  rejected_reason, last_synced_at, created_by, created_at, updated_at
`;

async function listTemplates({ brand }) {
  const { rows } = await query(
    `SELECT ${COLUMNS}
       FROM shared.whatsapp_templates
      WHERE business = $1
      ORDER BY
        CASE status WHEN 'APPROVED' THEN 0 WHEN 'PENDING' THEN 1
                    WHEN 'LOCAL_DRAFT' THEN 2 ELSE 3 END,
        name, language`,
    [brand],
  );
  return rows;
}

async function getTemplate({ brand, id }) {
  const { rows } = await query(
    `SELECT ${COLUMNS}
       FROM shared.whatsapp_templates
      WHERE business = $1 AND template_id = $2`,
    [brand, id],
  );
  return rows[0] || null;
}

async function findByName({ brand, name, language }) {
  const { rows } = await query(
    `SELECT ${COLUMNS}
       FROM shared.whatsapp_templates
      WHERE business = $1 AND name = $2 AND language = $3`,
    [brand, name, language],
  );
  return rows[0] || null;
}

async function insertTemplate({ brand, user_id, input }) {
  const { rows } = await query(
    `INSERT INTO shared.whatsapp_templates
       (business, name, language, category, status, components,
        body_text, variables, created_by)
     VALUES ($1,$2,$3,$4,COALESCE($5,'LOCAL_DRAFT'),
             $6::jsonb,$7,$8::jsonb,$9)
     RETURNING ${COLUMNS}`,
    [
      brand,
      input.name,
      input.language,
      input.category,
      input.status || null,
      JSON.stringify(input.components || []),
      input.body_text || null,
      JSON.stringify(input.variables || []),
      user_id || null,
    ],
  );
  return rows[0];
}

async function updateTemplate({ brand, id, patch }) {
  const { rows } = await query(
    `UPDATE shared.whatsapp_templates
        SET name           = COALESCE($3, name),
            language        = COALESCE($4, language),
            category        = COALESCE($5, category),
            status          = COALESCE($6, status),
            components      = COALESCE($7::jsonb, components),
            body_text       = COALESCE($8, body_text),
            variables       = COALESCE($9::jsonb, variables),
            meta_template_id = COALESCE($10, meta_template_id),
            quality_score   = COALESCE($11, quality_score),
            rejected_reason = $12,
            last_synced_at  = COALESCE($13, last_synced_at),
            updated_at      = now()
      WHERE business = $1 AND template_id = $2
      RETURNING ${COLUMNS}`,
    [
      brand,
      id,
      patch.name ?? null,
      patch.language ?? null,
      patch.category ?? null,
      patch.status ?? null,
      patch.components ? JSON.stringify(patch.components) : null,
      patch.body_text ?? null,
      patch.variables ? JSON.stringify(patch.variables) : null,
      patch.meta_template_id ?? null,
      patch.quality_score ?? null,
      patch.rejected_reason ?? null,
      patch.last_synced_at ?? null,
    ],
  );
  return rows[0] || null;
}

async function deleteTemplate({ brand, id }) {
  const { rows } = await query(
    `DELETE FROM shared.whatsapp_templates
      WHERE business = $1 AND template_id = $2
      RETURNING template_id`,
    [brand, id],
  );
  return rows[0] || null;
}

/**
 * Upsert a template discovered/refreshed from a Meta sync. Matched on
 * (business, name, language) — Meta's natural key. Preserves the local
 * template_id + created_by so the row's identity survives a sync.
 */
async function upsertFromMeta({ brand, tpl }) {
  const { rows } = await query(
    `INSERT INTO shared.whatsapp_templates
       (business, meta_template_id, name, language, category, status,
        components, body_text, variables, quality_score, rejected_reason,
        last_synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,$11,now())
     ON CONFLICT (business, name, language) DO UPDATE
       SET meta_template_id = EXCLUDED.meta_template_id,
           category         = EXCLUDED.category,
           status           = EXCLUDED.status,
           components       = EXCLUDED.components,
           body_text        = EXCLUDED.body_text,
           variables        = EXCLUDED.variables,
           quality_score    = EXCLUDED.quality_score,
           rejected_reason  = EXCLUDED.rejected_reason,
           last_synced_at   = now(),
           updated_at       = now()
     RETURNING ${COLUMNS}`,
    [
      brand,
      tpl.meta_template_id || null,
      tpl.name,
      tpl.language,
      tpl.category,
      tpl.status,
      JSON.stringify(tpl.components || []),
      tpl.body_text || null,
      JSON.stringify(tpl.variables || []),
      tpl.quality_score || null,
      tpl.rejected_reason || null,
    ],
  );
  return rows[0];
}

// ── Rates ──────────────────────────────────────────────────

async function listRates({ brand }) {
  const { rows } = await query(
    `SELECT rate_id, business, category, amount_ngn, currency, note, updated_at
       FROM shared.whatsapp_template_rates
      WHERE business = $1
      ORDER BY category`,
    [brand],
  );
  return rows;
}

async function upsertRate({ brand, user_id, category, amount_ngn, note }) {
  const { rows } = await query(
    `INSERT INTO shared.whatsapp_template_rates
       (business, category, amount_ngn, note, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,now())
     ON CONFLICT (business, category) DO UPDATE
       SET amount_ngn = EXCLUDED.amount_ngn,
           note       = COALESCE(EXCLUDED.note, shared.whatsapp_template_rates.note),
           updated_by = EXCLUDED.updated_by,
           updated_at = now()
     RETURNING rate_id, business, category, amount_ngn, currency, note, updated_at`,
    [brand, category, amount_ngn, note || null, user_id || null],
  );
  return rows[0];
}

module.exports = {
  listTemplates,
  getTemplate,
  findByName,
  insertTemplate,
  updateTemplate,
  deleteTemplate,
  upsertFromMeta,
  listRates,
  upsertRate,
};
