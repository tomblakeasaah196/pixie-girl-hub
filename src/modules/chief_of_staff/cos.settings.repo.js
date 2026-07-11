/**
 * Chief of Staff (PR6) — settings repository.
 *
 * shared.cos_settings holds one row per user (PK user_id). A missing row is
 * equivalent to all-defaults, so reads never fail on a fresh account: get()
 * returns the DB row when present, else the DEFAULTS below (kept in sync with
 * the migration §1.9). ensureDefault() lazily materialises the row on first
 * CoS use so the settings UI has something to PUT against.
 *
 * Parameterised SQL only.
 */

"use strict";

const { query } = require("../../config/database");

// Mirrors migration 000327 column defaults. Used as the read fallback when no
// row exists yet, so every consumer (persona, scheduler, briefing) sees a
// complete settings object regardless of whether the CEO has saved anything.
const DEFAULTS = Object.freeze({
  assistant_name: "Chief of Staff",
  tone: "warm",
  avatar_url: null,
  pronoun: "she",
  work_start: "08:00",
  work_end: "18:00",
  timezone: "Africa/Lagos",
  morning_brief_at: "07:00",
  evening_review_at: "18:00",
  quiet_start: "21:00",
  quiet_end: "06:00",
  celebrate_wins: true,
  adaptive_timing: true,
});

// The columns a caller is allowed to update (avatar included; timestamps + PK
// are not). Order-independent — update() only touches provided keys.
const UPDATABLE = [
  "assistant_name",
  "tone",
  "avatar_url",
  "pronoun",
  "work_start",
  "work_end",
  "timezone",
  "morning_brief_at",
  "evening_review_at",
  "quiet_start",
  "quiet_end",
  "celebrate_wins",
  "adaptive_timing",
];

/** The raw row for a user, or null when none has been saved yet. */
async function findRow({ user_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.cos_settings WHERE user_id = $1`,
    [user_id],
  );
  return rows[0] || null;
}

/**
 * The effective settings for a user: the saved row, or DEFAULTS + user_id when
 * none exists. Always resolves a complete object — never null.
 */
async function get({ user_id }) {
  const row = await findRow({ user_id });
  return row || { user_id, ...DEFAULTS };
}

/** Create the default row if absent (lazy). Returns the row either way. */
async function ensureDefault({ user_id }) {
  const { rows } = await query(
    `INSERT INTO shared.cos_settings (user_id)
       VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING *`,
    [user_id],
  );
  return rows[0];
}

/**
 * Upsert the provided fields. Unknown keys are ignored (defence in depth — the
 * validator already strips them). Returns the full row after the write.
 */
async function update({ user_id, patch }) {
  const entries = Object.entries(patch || {}).filter(
    ([k, v]) => UPDATABLE.includes(k) && v !== undefined,
  );
  if (!entries.length) return ensureDefault({ user_id });

  const cols = entries.map(([k]) => k);
  const insertCols = ["user_id", ...cols];
  const values = [user_id, ...entries.map(([, v]) => v)];
  const placeholders = insertCols.map((_, i) => `$${i + 1}`);
  const setClause = cols.map((c) => `${c} = EXCLUDED.${c}`).join(", ");

  const { rows } = await query(
    `INSERT INTO shared.cos_settings (${insertCols.join(", ")})
       VALUES (${placeholders.join(", ")})
     ON CONFLICT (user_id) DO UPDATE SET ${setClause}, updated_at = now()
     RETURNING *`,
    values,
  );
  return rows[0];
}

module.exports = { get, findRow, ensureDefault, update, DEFAULTS, UPDATABLE };
