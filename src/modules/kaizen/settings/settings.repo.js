/**
 * Kaizen settings repository — key/value over shared.kaizen_settings.
 * Used by alerts (recipients), backups (retention), and the Settings screen.
 */

"use strict";

const { query } = require("../../../config/database");

async function get(key, fallback = null) {
  const { rows } = await query(
    `SELECT value FROM shared.kaizen_settings WHERE key = $1`,
    [key],
  );
  return rows[0] ? rows[0].value : fallback;
}

async function set(key, value) {
  const { rows } = await query(
    `INSERT INTO shared.kaizen_settings (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
     RETURNING key, value, updated_at`,
    [key, JSON.stringify(value)],
  );
  return rows[0];
}

async function all() {
  const { rows } = await query(
    `SELECT key, value, updated_at FROM shared.kaizen_settings ORDER BY key ASC`,
  );
  return rows;
}

module.exports = { get, set, all };
