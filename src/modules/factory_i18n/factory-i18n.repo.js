/**
 * Factory i18n — data access layer.
 * Raw parameterised SQL; no ORM.
 */

"use strict";

const { query } = require("../../config/database");

/**
 * Return all languages (without translations) for the language selector.
 * @returns {Promise<Array>}
 */
async function listLanguages() {
  const { rows } = await query(
    "SELECT language_code, display_name, is_active, created_at FROM shared.factory_i18n ORDER BY language_code",
  );
  return rows;
}

/**
 * Return a single language row including its translations JSONB.
 * @param {string} code
 * @returns {Promise<object|null>}
 */
async function getWithTranslations(code) {
  const { rows } = await query(
    "SELECT language_code, display_name, translations, is_active FROM shared.factory_i18n WHERE language_code = $1",
    [code],
  );
  return rows[0] || null;
}

/**
 * Return all active languages with their translations JSONB.
 * Used by the frontend to load all bundles into i18next.
 * @returns {Promise<Array>}
 */
async function listAllWithTranslations() {
  const { rows } = await query(
    "SELECT language_code, display_name, translations, is_active FROM shared.factory_i18n WHERE is_active = true ORDER BY language_code",
  );
  return rows;
}

/**
 * Insert a new language row.
 * @param {{ language_code: string, display_name: string, translations: object }} param
 * @returns {Promise<object>}
 */
async function create({ language_code, display_name, translations }) {
  const { rows } = await query(
    `INSERT INTO shared.factory_i18n (language_code, display_name, translations)
     VALUES ($1, $2, $3::jsonb)
     RETURNING language_code, display_name, is_active, created_at`,
    [language_code.toLowerCase(), display_name, JSON.stringify(translations)],
  );
  return rows[0];
}

/**
 * Partial update of a language row.
 * @param {string} code
 * @param {{ display_name?: string, translations?: object, is_active?: boolean }} fields
 * @returns {Promise<object|null>}
 */
async function update(code, { display_name, translations, is_active }) {
  const sets = [];
  const vals = [];
  let i = 1;
  if (display_name !== undefined) {
    sets.push(`display_name = $${i++}`);
    vals.push(display_name);
  }
  if (translations !== undefined) {
    sets.push(`translations = $${i++}::jsonb`);
    vals.push(JSON.stringify(translations));
  }
  if (is_active !== undefined) {
    sets.push(`is_active = $${i++}`);
    vals.push(is_active);
  }
  if (!sets.length) return null;
  sets.push(`updated_at = now()`);
  vals.push(code);
  const { rows } = await query(
    `UPDATE shared.factory_i18n SET ${sets.join(", ")} WHERE language_code = $${i} RETURNING language_code, display_name, is_active`,
    vals,
  );
  return rows[0] || null;
}

/**
 * Delete a language row by code.
 * @param {string} code
 * @returns {Promise<void>}
 */
async function remove(code) {
  await query("DELETE FROM shared.factory_i18n WHERE language_code = $1", [
    code,
  ]);
}

module.exports = {
  listLanguages,
  getWithTranslations,
  listAllWithTranslations,
  create,
  update,
  remove,
};
