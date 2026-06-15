/**
 * Settings module — repository for the schemas introduced in
 * migration 000210: document_templates, notification_preferences,
 * scheduled_reports, integration_secrets.
 *
 * The older config tables (currencies, tax, numbering, custom fields,
 * pipelines, banks, gateways) live in business_setup; this module owns
 * only the new ones. Parameterised SQL only.
 */

"use strict";

const { query } = require("../../config/database");

const ex = (client) => (client ? client.query.bind(client) : query);

// ── document_templates ───────────────────────────────────
async function listTemplates({ client, brand, doc_type }) {
  const where = ["business = $1"];
  const params = [brand];
  let i = 2;
  if (doc_type) {
    where.push(`doc_type = $${i++}`);
    params.push(doc_type);
  }
  const { rows } = await ex(client)(
    `SELECT * FROM shared.document_templates
     WHERE ${where.join(" AND ")}
     ORDER BY doc_type ASC, is_default DESC, version DESC`,
    params,
  );
  return rows;
}
async function getTemplate({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.document_templates WHERE template_id = $1 AND business = $2`,
    [id, brand],
  );
  return rows[0] || null;
}
async function createTemplate({ client, brand, row, user_id }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.document_templates
       (business, doc_type, name, version, status, header_html, body_html,
        footer_html, css_vars, is_default, updated_by)
     VALUES ($1,$2,$3,COALESCE($4,1),COALESCE($5,'draft'),$6,$7,$8,
             COALESCE($9,'{}')::jsonb,COALESCE($10,false),$11)
     RETURNING *`,
    [
      brand,
      row.doc_type,
      row.name,
      row.version,
      row.status,
      row.header_html || null,
      row.body_html || null,
      row.footer_html || null,
      JSON.stringify(row.css_vars || {}),
      row.is_default,
      user_id || null,
    ],
  );
  return rows[0];
}
async function updateTemplate({ client, brand, id, patch, user_id }) {
  const sets = [];
  const params = [id, brand];
  let i = 3;
  for (const col of ["doc_type", "name", "status", "header_html", "body_html", "footer_html", "is_default"]) {
    if (patch[col] === undefined) continue;
    sets.push(`${col} = $${i++}`);
    params.push(patch[col]);
  }
  if (patch.css_vars !== undefined) {
    sets.push(`css_vars = $${i++}::jsonb`);
    params.push(JSON.stringify(patch.css_vars));
  }
  if (sets.length === 0) return getTemplate({ client, brand, id });
  sets.push(`updated_by = $${i++}`);
  params.push(user_id || null);
  const { rows } = await ex(client)(
    `UPDATE shared.document_templates SET ${sets.join(", ")}
     WHERE template_id = $1 AND business = $2 RETURNING *`,
    params,
  );
  return rows[0] || null;
}
// Make one template the default for its (business, doc_type) — clears the
// previous default first so the partial unique index never collides.
async function setDefaultTemplate({ client, brand, id }) {
  const target = await getTemplate({ client, brand, id });
  if (!target) return null;
  await ex(client)(
    `UPDATE shared.document_templates SET is_default = false
     WHERE business = $1 AND doc_type = $2 AND is_default = true`,
    [brand, target.doc_type],
  );
  const { rows } = await ex(client)(
    `UPDATE shared.document_templates
     SET is_default = true, status = 'published'
     WHERE template_id = $1 AND business = $2 RETURNING *`,
    [id, brand],
  );
  return rows[0] || null;
}
async function deleteTemplate({ client, brand, id }) {
  const { rowCount } = await ex(client)(
    `DELETE FROM shared.document_templates WHERE template_id = $1 AND business = $2`,
    [id, brand],
  );
  return rowCount > 0;
}

// ── notification_preferences ─────────────────────────────
async function listNotificationPrefs({ client, user_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.notification_preferences
     WHERE user_id = $1 ORDER BY category ASC, channel ASC`,
    [user_id],
  );
  return rows;
}
// Upsert a single (user, channel, category) toggle.
async function upsertNotificationPref({ client, user_id, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.notification_preferences
       (user_id, channel, category, enabled, config)
     VALUES ($1,$2,$3,COALESCE($4,true),COALESCE($5,'{}')::jsonb)
     ON CONFLICT (user_id, channel, category) DO UPDATE
       SET enabled = COALESCE(EXCLUDED.enabled, shared.notification_preferences.enabled),
           config  = COALESCE(EXCLUDED.config, shared.notification_preferences.config),
           updated_at = now()
     RETURNING *`,
    [
      user_id,
      row.channel,
      row.category,
      row.enabled,
      row.config !== undefined ? JSON.stringify(row.config) : null,
    ],
  );
  return rows[0];
}

// ── scheduled_reports ────────────────────────────────────
async function listReports({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.scheduled_reports WHERE business = $1 ORDER BY created_at DESC`,
    [brand],
  );
  return rows;
}
async function getReport({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.scheduled_reports WHERE report_id = $1 AND business = $2`,
    [id, brand],
  );
  return rows[0] || null;
}
async function createReport({ client, brand, row, user_id }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.scheduled_reports
       (business, name, source_module, trigger_event, params, cadence,
        recipients, formats, is_active, next_run_at, created_by)
     VALUES ($1,$2,$3,$4,COALESCE($5,'{}')::jsonb,$6,
             COALESCE($7,'{}'),COALESCE($8,ARRAY['pdf']),COALESCE($9,true),$10,$11)
     RETURNING *`,
    [
      brand,
      row.name,
      row.source_module,
      row.trigger_event || null,
      JSON.stringify(row.params || {}),
      row.cadence,
      row.recipients || null,
      row.formats || null,
      row.is_active,
      row.next_run_at || null,
      user_id || null,
    ],
  );
  return rows[0];
}
async function updateReport({ client, brand, id, patch }) {
  const sets = [];
  const params = [id, brand];
  let i = 3;
  for (const col of ["name", "source_module", "trigger_event", "cadence", "is_active", "next_run_at"]) {
    if (patch[col] === undefined) continue;
    sets.push(`${col} = $${i++}`);
    params.push(patch[col]);
  }
  for (const col of ["recipients", "formats"]) {
    if (patch[col] === undefined) continue;
    sets.push(`${col} = $${i++}`);
    params.push(patch[col]);
  }
  if (patch.params !== undefined) {
    sets.push(`params = $${i++}::jsonb`);
    params.push(JSON.stringify(patch.params));
  }
  if (sets.length === 0) return getReport({ client, brand, id });
  const { rows } = await ex(client)(
    `UPDATE shared.scheduled_reports SET ${sets.join(", ")}
     WHERE report_id = $1 AND business = $2 RETURNING *`,
    params,
  );
  return rows[0] || null;
}
async function deleteReport({ client, brand, id }) {
  const { rowCount } = await ex(client)(
    `DELETE FROM shared.scheduled_reports WHERE report_id = $1 AND business = $2`,
    [id, brand],
  );
  return rowCount > 0;
}

// ── integration_secrets (write-only) ─────────────────────
// list NEVER selects secret_enc — only the safe metadata.
async function listSecrets({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT secret_id, business, provider, key_name, last4, is_active,
            updated_at, updated_by
     FROM shared.integration_secrets
     WHERE business IS NOT DISTINCT FROM $1
     ORDER BY provider ASC, key_name ASC`,
    [brand || null],
  );
  return rows;
}
async function upsertSecret({ client, brand, row, user_id }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.integration_secrets
       (business, provider, key_name, secret_enc, last4, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (business, provider, key_name) DO UPDATE
       SET secret_enc = EXCLUDED.secret_enc,
           last4      = EXCLUDED.last4,
           is_active  = true,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()
     RETURNING secret_id, business, provider, key_name, last4, is_active, updated_at`,
    [brand || null, row.provider, row.key_name, row.secret_enc, row.last4 || null, user_id || null],
  );
  return rows[0];
}
async function deleteSecret({ client, brand, id }) {
  const { rowCount } = await ex(client)(
    `DELETE FROM shared.integration_secrets
     WHERE secret_id = $1 AND business IS NOT DISTINCT FROM $2`,
    [id, brand || null],
  );
  return rowCount > 0;
}

module.exports = {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  setDefaultTemplate,
  deleteTemplate,
  listNotificationPrefs,
  upsertNotificationPref,
  listReports,
  getReport,
  createReport,
  updateReport,
  deleteReport,
  listSecrets,
  upsertSecret,
  deleteSecret,
};
