/**
 * Loyalty earn-rules repository (Module 6.23). Reads the config-driven
 * shared.loyalty_earn_rules table that replaces the hardcoded "1pt per ₦100"
 * rule, so new ways to earn points are added as data, not code.
 */

"use strict";

const { query, ex } = require("../../config/database");
async function listActiveEarnRules({ client, brand, action_type }) {
  const params = [brand];
  let where = "business = $1 AND is_active = true";
  if (action_type) {
    where += " AND action_type = $2";
    params.push(action_type);
  }
  const { rows } = await ex(client)(
    `SELECT * FROM shared.loyalty_earn_rules WHERE ${where} ORDER BY display_order`,
    params,
  );
  return rows;
}

/** Lifetime count of earns of a given transaction_type for a contact. */
async function countEarnsByType({ client, brand, contact_id, transaction_type }) {
  const { rows } = await ex(client)(
    `SELECT count(*)::int AS c FROM shared.loyalty_ledger
      WHERE business = $1 AND contact_id = $2 AND transaction_type = $3`,
    [brand, contact_id, transaction_type],
  );
  return rows[0].c;
}

// ── CRUD (admin) ──────────────────────────────────────────
const COLS = [
  "rule_key",
  "display_name",
  "description",
  "action_type",
  "points_mode",
  "points_value",
  "currency_per_point",
  "apply_tier_multiplier",
  "min_order_value",
  "max_awards_per_customer_lifetime",
  "rate_limit_days",
  "max_per_window",
  "points_expire_days",
  "eligibility_criteria",
  "is_active",
  "display_order",
];
const JSON_COLS = new Set(["eligibility_criteria"]);

async function listAll({ brand }) {
  const { rows } = await query(
    `SELECT * FROM shared.loyalty_earn_rules WHERE business = $1 ORDER BY display_order, created_at`,
    [brand],
  );
  return rows;
}

async function create({ brand, input, user_id }) {
  const f = ["business"];
  const ph = ["$1"];
  const p = [brand];
  let i = 2;
  for (const c of COLS) {
    if (input[c] === undefined) continue;
    f.push(c);
    ph.push(JSON_COLS.has(c) ? `$${i++}::jsonb` : `$${i++}`);
    p.push(JSON_COLS.has(c) ? JSON.stringify(input[c]) : input[c]);
  }
  f.push("created_by");
  ph.push(`$${i}`);
  p.push(user_id || null);
  const { rows } = await query(
    `INSERT INTO shared.loyalty_earn_rules (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}

async function update({ brand, id, patch }) {
  const keys = Object.keys(patch).filter((k) => COLS.includes(k));
  if (keys.length === 0) {
    const { rows } = await query(
      `SELECT * FROM shared.loyalty_earn_rules WHERE rule_id = $1 AND business = $2`,
      [id, brand],
    );
    return rows[0] || null;
  }
  const sets = keys.map((k, idx) =>
    JSON_COLS.has(k) ? `${k} = $${idx + 3}::jsonb` : `${k} = $${idx + 3}`,
  );
  const vals = keys.map((k) => (JSON_COLS.has(k) ? JSON.stringify(patch[k]) : patch[k]));
  const { rows } = await query(
    `UPDATE shared.loyalty_earn_rules SET ${sets.join(", ")}, updated_at = now()
      WHERE rule_id = $1 AND business = $2 RETURNING *`,
    [id, brand, ...vals],
  );
  return rows[0] || null;
}

module.exports = { listActiveEarnRules, countEarnsByType, listAll, create, update };
