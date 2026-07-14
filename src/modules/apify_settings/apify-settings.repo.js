/**
 * Apify Settings — parameterised SQL over shared.apify_settings (singleton:
 * one platform-wide row) and shared.apify_settings_secret_reveals.
 *
 * Mirrors src/modules/messaging_accounts/messaging-accounts.repo.js's
 * masked-columns / raw-row / reveal-audit shape, minus the per-row id
 * lookups messaging_accounts needs for its many channels — there's only
 * ever one Apify settings row.
 */

"use strict";

const { query } = require("../../config/database");

const PUBLIC_COLUMNS = `
  setting_id, is_active, last_tested_at, last_test_ok, last_test_message,
  secrets_last_rotated_at, notes, updated_by, created_at, updated_at,
  (api_key_enc IS NOT NULL) AS has_api_key,
  api_key_first4
`;

async function get() {
  const { rows } = await query(
    `SELECT ${PUBLIC_COLUMNS} FROM shared.apify_settings
      ORDER BY created_at ASC LIMIT 1`,
  );
  return rows[0] || null;
}

// Internal only — carries api_key_enc. Never serialised over HTTP.
async function getRaw() {
  const { rows } = await query(
    `SELECT * FROM shared.apify_settings ORDER BY created_at ASC LIMIT 1`,
  );
  return rows[0] || null;
}

/**
 * `fields` only contains keys the caller actually wants to change (mirrors
 * messaging-accounts.repo.js's upsert — missing keys mean "leave alone").
 */
async function upsert({ user_id, fields }) {
  const existing = await getRaw();
  if (!existing) {
    const cols = Object.keys(fields);
    const values = Object.values(fields);
    const placeholders = cols.map((_, i) => `$${i + 2}`);
    const { rows } = await query(
      `INSERT INTO shared.apify_settings (updated_by${cols.length ? ", " + cols.join(", ") : ""})
       VALUES ($1${placeholders.length ? ", " + placeholders.join(", ") : ""})
       RETURNING ${PUBLIC_COLUMNS}`,
      [user_id, ...values],
    );
    return rows[0];
  }
  const setClauses = ["updated_by = $1"];
  const values = [user_id];
  let i = 2;
  for (const [col, val] of Object.entries(fields)) {
    setClauses.push(`${col} = $${i++}`);
    values.push(val);
  }
  values.push(existing.setting_id);
  const { rows } = await query(
    `UPDATE shared.apify_settings SET ${setClauses.join(", ")}
      WHERE setting_id = $${i}
      RETURNING ${PUBLIC_COLUMNS}`,
    values,
  );
  return rows[0];
}

async function recordTestResult({ setting_id, ok, message }) {
  await query(
    `UPDATE shared.apify_settings
        SET last_tested_at = now(), last_test_ok = $2, last_test_message = $3
      WHERE setting_id = $1`,
    [setting_id, ok, message || null],
  );
}

async function recordReveal({ setting_id, user_id, field, source_ip, request_id }) {
  await query(
    `INSERT INTO shared.apify_settings_secret_reveals
       (setting_id, user_id, field, source_ip, request_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [setting_id, user_id, field, source_ip || null, request_id || null],
  );
}

async function listReveals({ setting_id, limit = 25 }) {
  const { rows } = await query(
    `SELECT r.reveal_id, r.field, r.revealed_at, r.source_ip,
            u.display_name, u.email
       FROM shared.apify_settings_secret_reveals r
       LEFT JOIN shared.users u ON u.user_id = r.user_id
      WHERE r.setting_id = $1
      ORDER BY r.revealed_at DESC
      LIMIT $2`,
    [setting_id, limit],
  );
  return rows;
}

module.exports = {
  get,
  getRaw,
  upsert,
  recordTestResult,
  recordReveal,
  listReveals,
};
