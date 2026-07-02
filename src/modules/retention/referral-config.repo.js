/**
 * Referral programme configuration repository (Module 6.23). Reads/writes the
 * config-driven shared.referral_program_settings (one row per business) and
 * shared.referral_reward_tiers (the referrer ladder), replacing the hardcoded
 * reward value in retention.service.
 */

"use strict";

const { query, ex } = require("../../config/database");
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

async function createTier({ brand, input }) {
  const { rows } = await query(
    `INSERT INTO shared.referral_reward_tiers
       (business, display_name, min_successful_referrals, referrer_points, referrer_credit_ngn, is_active)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,true)) RETURNING *`,
    [
      brand,
      input.display_name || null,
      input.min_successful_referrals,
      input.referrer_points || 0,
      input.referrer_credit_ngn || 0,
      input.is_active,
    ],
  );
  return rows[0];
}

async function updateTier({ brand, id, patch }) {
  const cols = ["display_name", "min_successful_referrals", "referrer_points", "referrer_credit_ngn", "is_active"];
  const keys = cols.filter((c) => patch[c] !== undefined);
  if (keys.length === 0) return null;
  const sets = keys.map((k, i) => `${k} = $${i + 3}`);
  const { rows } = await query(
    `UPDATE shared.referral_reward_tiers SET ${sets.join(", ")}, updated_at = now()
      WHERE tier_id = $1 AND business = $2 RETURNING *`,
    [id, brand, ...keys.map((k) => patch[k])],
  );
  return rows[0] || null;
}

async function deleteTier({ brand, id }) {
  await query(
    `DELETE FROM shared.referral_reward_tiers WHERE tier_id = $1 AND business = $2`,
    [id, brand],
  );
}

/** Referral dashboard: top referrers + programme totals. */
async function dashboard({ brand, limit = 20 }) {
  const top = await query(
    `SELECT r.referral_id, r.referral_code, r.successful_count, r.total_rewards_value,
            c.first_name, c.display_name
       FROM shared.referrals r
       JOIN shared.contacts c ON c.contact_id = r.contact_id
      WHERE r.business = $1
      ORDER BY r.successful_count DESC, r.total_rewards_value DESC
      LIMIT $2`,
    [brand, limit],
  );
  const totals = await query(
    `SELECT
        (SELECT count(*)::int FROM shared.referrals WHERE business = $1) AS total_referrers,
        (SELECT COALESCE(SUM(successful_count),0)::int FROM shared.referrals WHERE business = $1) AS total_conversions,
        (SELECT count(*)::int FROM shared.referral_redemptions WHERE business = $1 AND status = 'rewarded') AS total_rewarded,
        (SELECT count(*)::int FROM shared.referral_redemptions WHERE business = $1 AND fraud_check_result <> 'passed') AS flagged`,
    [brand],
  );
  return { top_referrers: top.rows, totals: totals.rows[0] };
}

module.exports = {
  getSettings,
  upsertSettings,
  tierForCount,
  listTiers,
  createTier,
  updateTier,
  deleteTier,
  dashboard,
};
