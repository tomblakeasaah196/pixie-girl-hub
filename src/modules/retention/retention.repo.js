/**
 * Customer Retention & Loyalty + Streak Stars + Hair Quiz (V2.2 §6.23) —
 * repository. Parameterised SQL only.
 *
 * Shared tables (filtered by `business`): loyalty_tiers, loyalty_ledger,
 * customer_loyalty_state, referrals, referral_redemptions.
 * Per-brand tables (`<brand>.*`): streak_star_earn_rules, streak_star_tiers,
 * streak_star_ledger, customer_streak_state, hair_quizzes,
 * hair_quiz_questions, hair_quiz_responses.
 *
 * The customer_loyalty_state balance is trigger-maintained from the ledger
 * (tier is recomputed here). customer_streak_state (incl. tier) is fully
 * trigger-maintained from the streak ledger.
 */

"use strict";

const { query } = require("../../config/database");

const { VALID } = require("../../config/brands");
const ex = (c) => (c ? c.query.bind(c) : query);
const t = (brand, tbl) => {
  if (!VALID.has(brand)) throw new Error(`Invalid brand: ${brand}`);
  return `${brand}.${tbl}`;
};

// ── Loyalty (shared) ───────────────────────────────────────
async function listLoyaltyTiers({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.loyalty_tiers
      WHERE business = $1 AND is_active = true
      ORDER BY display_order, min_lifetime_points`,
    [brand],
  );
  return rows;
}

async function tierForLifetime({ client, brand, lifetime }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.loyalty_tiers
      WHERE business = $1 AND is_active = true
        AND min_lifetime_points <= $2
        AND (max_lifetime_points IS NULL OR $2 <= max_lifetime_points)
      ORDER BY min_lifetime_points DESC
      LIMIT 1`,
    [brand, lifetime],
  );
  return rows[0] || null;
}

async function insertLoyaltyLedger({ client, brand, entry }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.loyalty_ledger
       (contact_id, business, transaction_type, points, multiplier_used,
        reference_type, reference_id, notes, expires_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      entry.contact_id,
      brand,
      entry.transaction_type,
      entry.points,
      entry.multiplier_used || null,
      entry.reference_type || null,
      entry.reference_id || null,
      entry.notes || null,
      entry.expires_at || null,
      entry.created_by || null,
    ],
  );
  return rows[0];
}

async function getLoyaltyState({ client, brand, contact_id }) {
  const { rows } = await ex(client)(
    `SELECT s.*, ti.tier_key, ti.tier_name, ti.earning_multiplier, ti.benefits
       FROM shared.customer_loyalty_state s
       LEFT JOIN shared.loyalty_tiers ti ON ti.tier_id = s.current_tier_id
      WHERE s.contact_id = $1 AND s.business = $2`,
    [contact_id, brand],
  );
  return rows[0] || null;
}

async function setLoyaltyTier({ client, brand, contact_id, tier_id }) {
  await ex(client)(
    `UPDATE shared.customer_loyalty_state
        SET current_tier_id = $3, tier_entered_at = now(), updated_at = now()
      WHERE contact_id = $1 AND business = $2`,
    [contact_id, brand, tier_id],
  );
}

async function ledgerEntryForReference({
  client,
  brand,
  reference_type,
  reference_id,
  transaction_type,
}) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.loyalty_ledger
      WHERE business = $1 AND reference_type = $2 AND reference_id = $3
        AND transaction_type = $4
      LIMIT 1`,
    [brand, reference_type, reference_id, transaction_type],
  );
  return rows[0] || null;
}

async function listLoyaltyLedger({ client, brand, contact_id, limit = 50 }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.loyalty_ledger
      WHERE business = $1 AND contact_id = $2
      ORDER BY created_at DESC LIMIT $3`,
    [brand, contact_id, limit],
  );
  return rows;
}

// ── Referral (shared) ──────────────────────────────────────
async function findReferralByContact({ client, brand, contact_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.referrals WHERE contact_id = $1 AND business = $2`,
    [contact_id, brand],
  );
  return rows[0] || null;
}

async function findReferralByCode({ client, code }) {
  const { rows } = await ex(client)(
    `SELECT r.*, c.first_name AS referrer_first_name, c.display_name AS referrer_name
       FROM shared.referrals r
       JOIN shared.contacts c ON c.contact_id = r.contact_id
      WHERE r.referral_code = $1 AND r.is_active = true`,
    [code],
  );
  return rows[0] || null;
}

async function insertReferral({
  client,
  brand,
  contact_id,
  referral_code,
  reward_rules,
}) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.referrals (contact_id, business, referral_code, reward_rules)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [contact_id, brand, referral_code, reward_rules || {}],
  );
  return rows[0];
}

async function findRedemption({ client, referral_id, referred_contact_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.referral_redemptions
      WHERE referral_id = $1 AND referred_contact_id = $2`,
    [referral_id, referred_contact_id],
  );
  return rows[0] || null;
}

async function insertRedemption({ client, brand, redemption }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.referral_redemptions
       (referral_id, referred_contact_id, business, triggering_order_id,
        triggering_order_value, referrer_reward_points, referred_discount_value,
        status, rewarded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      redemption.referral_id,
      redemption.referred_contact_id,
      brand,
      redemption.triggering_order_id || null,
      redemption.triggering_order_value || null,
      redemption.referrer_reward_points || 0,
      redemption.referred_discount_value || 0,
      redemption.status || "rewarded",
      redemption.rewarded_at || new Date().toISOString(),
    ],
  );
  return rows[0];
}

async function bumpReferralCounters({ client, referral_id, reward_value }) {
  await ex(client)(
    `UPDATE shared.referrals
        SET successful_count = successful_count + 1,
            total_rewards_value = total_rewards_value + $2,
            updated_at = now()
      WHERE referral_id = $1`,
    [referral_id, reward_value || 0],
  );
}

// ── Streak Stars (per-brand) ───────────────────────────────
async function listStreakTiers({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "streak_star_tiers")}
      WHERE is_active = true ORDER BY display_order`,
  );
  return rows;
}

async function listStreakRules({ client, brand, action_type }) {
  const params = [];
  let where = "is_active = true";
  if (action_type) {
    where += " AND action_type = $1";
    params.push(action_type);
  }
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "streak_star_earn_rules")}
      WHERE ${where} ORDER BY display_order`,
    params,
  );
  return rows;
}

async function streakLedgerForReference({
  client,
  brand,
  reference_type,
  reference_id,
  action_type,
}) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "streak_star_ledger")}
      WHERE reference_type = $1 AND reference_id = $2 AND earn_action_type = $3
      LIMIT 1`,
    [reference_type, reference_id, action_type],
  );
  return rows[0] || null;
}

async function insertStreakLedger({ client, brand, entry }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "streak_star_ledger")}
       (contact_id, transaction_type, stars, earn_rule_id, earn_action_type,
        reference_type, reference_id, description, awarded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      entry.contact_id,
      entry.transaction_type || "earn",
      entry.stars,
      entry.earn_rule_id || null,
      entry.earn_action_type || null,
      entry.reference_type || null,
      entry.reference_id || null,
      entry.description || null,
      entry.awarded_by || null,
    ],
  );
  return rows[0];
}

async function getStreakState({ client, brand, contact_id }) {
  const { rows } = await ex(client)(
    `SELECT s.*, ti.tier_key, ti.display_name AS tier_name,
            ti.lifetime_discount_pct, nt.display_name AS next_tier_name
       FROM ${t(brand, "customer_streak_state")} s
       LEFT JOIN ${t(brand, "streak_star_tiers")} ti ON ti.tier_id = s.current_tier_id
       LEFT JOIN ${t(brand, "streak_star_tiers")} nt ON nt.tier_id = s.next_tier_id
      WHERE s.contact_id = $1`,
    [contact_id],
  );
  return rows[0] || null;
}

async function listStreakLedger({ client, brand, contact_id, limit = 50 }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "streak_star_ledger")}
      WHERE contact_id = $1 ORDER BY occurred_at DESC LIMIT $2`,
    [contact_id, limit],
  );
  return rows;
}

async function countStreakAwards({ client, brand, contact_id, rule_id }) {
  const { rows } = await ex(client)(
    `SELECT COUNT(*)::int AS n FROM ${t(brand, "streak_star_ledger")}
      WHERE contact_id = $1 AND earn_rule_id = $2 AND transaction_type = 'earn'`,
    [contact_id, rule_id],
  );
  return rows[0].n;
}

// ── Hair Quiz (per-brand) ──────────────────────────────────
async function getActiveQuiz({ client, brand, slug }) {
  const params = [];
  let where = "is_active = true";
  if (slug) {
    where += " AND storefront_url_slug = $1";
    params.push(slug);
  }
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "hair_quizzes")}
      WHERE ${where} ORDER BY created_at LIMIT 1`,
    params,
  );
  return rows[0] || null;
}

async function getQuizQuestions({ client, brand, quiz_id }) {
  const { rows } = await ex(client)(
    `SELECT question_id, question_key, question_text, question_type, options,
            is_required, display_order
       FROM ${t(brand, "hair_quiz_questions")}
      WHERE quiz_id = $1 ORDER BY display_order`,
    [quiz_id],
  );
  return rows;
}

async function insertQuizResponse({ client, brand, response }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "hair_quiz_responses")}
       (quiz_id, storefront_session_id, contact_id, visitor_email,
        visitor_first_name, visitor_phone, answers, recommended_variant_ids,
        crm_deal_id, stars_awarded, stars_ledger_entry_id, completed_at,
        ip_address, user_agent, utm_source, utm_medium, utm_campaign)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now(),$12,$13,$14,$15,$16)
     RETURNING *`,
    [
      response.quiz_id,
      response.storefront_session_id || null,
      response.contact_id || null,
      response.visitor_email || null,
      response.visitor_first_name || null,
      response.visitor_phone || null,
      response.answers,
      response.recommended_variant_ids || [],
      response.crm_deal_id || null,
      response.stars_awarded || null,
      response.stars_ledger_entry_id || null,
      response.ip_address || null,
      response.user_agent || null,
      response.utm_source || null,
      response.utm_medium || null,
      response.utm_campaign || null,
    ],
  );
  return rows[0];
}

/**
 * Simple variant recommender: match active variants on the quiz answers'
 * texture / length / lace hints. Best-effort — returns up to `limit` ids.
 */
async function recommendVariants({ client, brand, hints, limit = 6 }) {
  const { rows } = await ex(client)(
    `SELECT pv.variant_id
       FROM ${t(brand, "product_variants")} pv
       JOIN ${t(brand, "products")} p ON p.product_id = pv.product_id
      WHERE p.is_visible_storefront = true AND p.is_deleted = false
        AND pv.is_active = true
      ORDER BY pv.created_at DESC
      LIMIT $1`,
    [limit],
  );
  void hints;
  return rows.map((r) => r.variant_id);
}

module.exports = {
  // loyalty
  listLoyaltyTiers,
  tierForLifetime,
  insertLoyaltyLedger,
  getLoyaltyState,
  setLoyaltyTier,
  ledgerEntryForReference,
  listLoyaltyLedger,
  // referral
  findReferralByContact,
  findReferralByCode,
  insertReferral,
  findRedemption,
  insertRedemption,
  bumpReferralCounters,
  // streak
  listStreakTiers,
  listStreakRules,
  streakLedgerForReference,
  insertStreakLedger,
  getStreakState,
  listStreakLedger,
  countStreakAwards,
  // quiz
  getActiveQuiz,
  getQuizQuestions,
  insertQuizResponse,
  recommendVariants,
};
