/**
 * Referral programme configuration repository (Module 6.23). Reads/writes the
 * config-driven shared.referral_program_settings (one row per business) and
 * shared.referral_reward_tiers (the referrer ladder), replacing the hardcoded
 * reward value in retention.service.
 */

"use strict";

const { query } = require("../../config/database");

const ex = (c) => (c ? c.query.bind(c) : query);

async function getSettings({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.referral_program_settings WHERE business = $1`,
    [brand],
  );
  return rows[0] || null;
}

async function upsertSettings({ brand, patch, user_id }) {
  const cols = [
    "is_active",
    "reward_on",
    "friend_discount_type",
    "friend_discount_value",
    "friend_min_order_value",
    "default_referrer_points",
    "default_referrer_credit_ngn",
    "min_qualifying_order_ngn",
    "anti_fraud",
  ];
  const present = cols.filter((c) => patch[c] !== undefined);
  const insCols = ["business", ...present, "updated_by"];
  const insVals = [
    brand,
    ...present.map((c) => (c === "anti_fraud" ? JSON.stringify(patch[c]) : patch[c])),
    user_id || null,
  ];
  const ph = insCols.map((c, i) => (c === "anti_fraud" ? `$${i + 1}::jsonb` : `$${i + 1}`));
  const updates = present
    .map((c) => (c === "anti_fraud" ? `${c} = EXCLUDED.${c}` : `${c} = EXCLUDED.${c}`))
    .concat("updated_by = EXCLUDED.updated_by", "updated_at = now()")
    .join(", ");
  const { rows } = await query(
    `INSERT INTO shared.referral_program_settings (${insCols.join(",")})
     VALUES (${ph.join(",")})
     ON CONFLICT (business) DO UPDATE SET ${updates}
     RETURNING *`,
    insVals,
  );
  return rows[0];
}

/** Highest ladder rung whose threshold the count satisfies (or null). */
async function tierForCount({ client, brand, count }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.referral_reward_tiers
      WHERE business = $1 AND is_active = true AND min_successful_referrals <= $2
      ORDER BY min_successful_referrals DESC LIMIT 1`,
    [brand, count],
  );
  return rows[0] || null;
}

async function listTiers({ brand }) {
  const { rows } = await query(
    `SELECT * FROM shared.referral_reward_tiers WHERE business = $1 ORDER BY min_successful_referrals`,
    [brand],
  );
  return rows;
}

module.exports = { getSettings, upsertSettings, tierForCount, listTiers };
