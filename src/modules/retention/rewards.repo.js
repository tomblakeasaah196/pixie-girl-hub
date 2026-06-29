/**
 * Loyalty rewards catalogue repository (Module 6.23). Parameterised SQL over
 * shared.loyalty_rewards + shared.loyalty_reward_redemptions — the config-driven
 * "what can points buy" layer.
 */

"use strict";

const { query } = require("../../config/database");

const ex = (c) => (c ? c.query.bind(c) : query);

const COLS = [
  "reward_key",
  "display_name",
  "description",
  "reward_type",
  "points_cost",
  "discount_type",
  "discount_value",
  "max_discount_value",
  "free_product_id",
  "free_variant_id",
  "gift_description",
  "min_tier_id",
  "max_redemptions_per_customer",
  "total_redemption_limit",
  "valid_from",
  "valid_to",
  "is_active",
  "display_order",
  "metadata",
];
const JSON_COLS = new Set(["metadata"]);

async function listActive({ brand }) {
  const { rows } = await query(
    `SELECT * FROM shared.loyalty_rewards
      WHERE business = $1 AND is_active = true
        AND valid_from <= now() AND (valid_to IS NULL OR valid_to >= now())
      ORDER BY display_order, points_cost`,
    [brand],
  );
  return rows;
}

async function listAll({ brand }) {
  const { rows } = await query(
    `SELECT * FROM shared.loyalty_rewards WHERE business = $1 ORDER BY display_order, created_at`,
    [brand],
  );
  return rows;
}

async function get({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.loyalty_rewards WHERE reward_id = $1 AND business = $2`,
    [id, brand],
  );
  return rows[0] || null;
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
    `INSERT INTO shared.loyalty_rewards (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}

async function update({ brand, id, patch }) {
  const keys = Object.keys(patch).filter((k) => COLS.includes(k));
  if (keys.length === 0) return get({ brand, id });
  const sets = keys.map((k, idx) =>
    JSON_COLS.has(k) ? `${k} = $${idx + 3}::jsonb` : `${k} = $${idx + 3}`,
  );
  const vals = keys.map((k) => (JSON_COLS.has(k) ? JSON.stringify(patch[k]) : patch[k]));
  const { rows } = await query(
    `UPDATE shared.loyalty_rewards SET ${sets.join(", ")}, updated_at = now()
      WHERE reward_id = $1 AND business = $2 RETURNING *`,
    [id, brand, ...vals],
  );
  return rows[0] || null;
}

async function countCustomerRedemptions({ client, reward_id, contact_id }) {
  const { rows } = await ex(client)(
    `SELECT count(*)::int AS c FROM shared.loyalty_reward_redemptions
      WHERE reward_id = $1 AND contact_id = $2 AND status = 'applied'`,
    [reward_id, contact_id],
  );
  return rows[0].c;
}

async function insertRedemption({ client, brand, redemption }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.loyalty_reward_redemptions
       (reward_id, contact_id, business, points_spent, ledger_id, reference_type, reference_id, fulfilment, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'applied') RETURNING *`,
    [
      redemption.reward_id,
      redemption.contact_id,
      brand,
      redemption.points_spent,
      redemption.ledger_id || null,
      redemption.reference_type || null,
      redemption.reference_id || null,
      JSON.stringify(redemption.fulfilment || {}),
    ],
  );
  return rows[0];
}

async function bumpRedeemed({ client, reward_id }) {
  await ex(client)(
    `UPDATE shared.loyalty_rewards SET total_redeemed = total_redeemed + 1 WHERE reward_id = $1`,
    [reward_id],
  );
}

async function tierMinLifetime({ client, tier_id }) {
  if (!tier_id) return null;
  const { rows } = await ex(client)(
    `SELECT min_lifetime_points FROM shared.loyalty_tiers WHERE tier_id = $1`,
    [tier_id],
  );
  return rows[0] ? Number(rows[0].min_lifetime_points) : null;
}

module.exports = {
  listActive,
  listAll,
  get,
  create,
  update,
  countCustomerRedemptions,
  insertRedemption,
  bumpRedeemed,
  tierMinLifetime,
};
