/**
 * Crowns 👑 — unified loyalty + streak economy (Module 6.23). Repository:
 * parameterised SQL only. All tables are `shared`, filtered by `business`
 * (a Pixie Queen's Pixie wallet and Faitlyn wallet are separate rows).
 *
 * Balance + tier on shared.customer_crown_state are trigger-maintained from
 * shared.crown_ledger (see migration 000362). This repo never emits events.
 */

"use strict";

const { query, ex } = require("../../config/database");

// ── Tiers ──────────────────────────────────────────────────
async function listTiers({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.crown_tiers
      WHERE business = $1 AND is_active = true
      ORDER BY display_order`,
    [brand],
  );
  return rows;
}

async function getTierById({ client, brand, tier_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.crown_tiers WHERE tier_id = $1 AND business = $2`,
    [tier_id, brand],
  );
  return rows[0] || null;
}

async function tierForLifetime({ client, brand, lifetime }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.crown_tiers
      WHERE business = $1 AND is_active = true AND min_crowns <= $2
      ORDER BY display_order DESC LIMIT 1`,
    [brand, lifetime],
  );
  return rows[0] || null;
}

const TIER_COLS = [
  "tier_name",
  "description",
  "min_crowns",
  "display_order",
  "next_purchase_discount_pct",
  "grants_free_shipping_next",
  "lifetime_discount_pct",
  "earning_multiplier",
  "benefits",
  "badge_colour_hex",
  "badge_image_url",
  "is_active",
];
const TIER_JSON = new Set(["benefits"]);

async function updateTier({ brand, id, patch }) {
  const keys = Object.keys(patch).filter((k) => TIER_COLS.includes(k));
  if (keys.length === 0) return null;
  const sets = keys.map((k, i) =>
    TIER_JSON.has(k) ? `${k} = $${i + 3}::jsonb` : `${k} = $${i + 3}`,
  );
  const vals = keys.map((k) =>
    TIER_JSON.has(k) ? JSON.stringify(patch[k]) : patch[k],
  );
  const { rows } = await query(
    `UPDATE shared.crown_tiers SET ${sets.join(", ")}, updated_at = now()
      WHERE tier_id = $1 AND business = $2 RETURNING *`,
    [id, brand, ...vals],
  );
  return rows[0] || null;
}

// ── Earn rules ─────────────────────────────────────────────
async function listRules({ client, brand, action_type }) {
  const params = [brand];
  let where = "business = $1 AND is_active = true";
  if (action_type) {
    params.push(action_type);
    where += ` AND action_type = $${params.length}`;
  }
  const { rows } = await ex(client)(
    `SELECT * FROM shared.crown_earn_rules
      WHERE ${where} ORDER BY display_order`,
    params,
  );
  return rows;
}

async function getRuleByKey({ client, brand, rule_key }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.crown_earn_rules
      WHERE business = $1 AND rule_key = $2`,
    [brand, rule_key],
  );
  return rows[0] || null;
}

const RULE_COLS = [
  "display_name",
  "description",
  "crowns_mode",
  "crown_value",
  "unit_currency_per_crown",
  "verification_mode",
  "social_platform",
  "min_order_value",
  "max_awards_per_customer_lifetime",
  "max_awards_per_customer_per_month",
  "max_awards_per_customer_per_year",
  "required_minimum_tier_key",
  "eligibility_criteria",
  "apply_tier_multiplier",
  "is_active",
  "display_order",
];
const RULE_JSON = new Set(["eligibility_criteria"]);

async function updateRule({ brand, id, patch }) {
  const keys = Object.keys(patch).filter((k) => RULE_COLS.includes(k));
  if (keys.length === 0) return null;
  const sets = keys.map((k, i) =>
    RULE_JSON.has(k) ? `${k} = $${i + 3}::jsonb` : `${k} = $${i + 3}`,
  );
  const vals = keys.map((k) =>
    RULE_JSON.has(k) ? JSON.stringify(patch[k]) : patch[k],
  );
  const { rows } = await query(
    `UPDATE shared.crown_earn_rules SET ${sets.join(", ")}, updated_at = now()
      WHERE rule_id = $1 AND business = $2 RETURNING *`,
    [id, brand, ...vals],
  );
  return rows[0] || null;
}

// ── Ledger ─────────────────────────────────────────────────
async function insertLedger({ client, brand, entry }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.crown_ledger
       (contact_id, business, transaction_type, crowns, earn_rule_id,
        earn_action_type, multiplier_used, reference_type, reference_id,
        description, awarded_by, reverses_ledger_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      entry.contact_id,
      brand,
      entry.transaction_type || "earn",
      entry.crowns,
      entry.earn_rule_id || null,
      entry.earn_action_type || null,
      entry.multiplier_used || null,
      entry.reference_type || null,
      entry.reference_id || null,
      entry.description || null,
      entry.awarded_by || null,
      entry.reverses_ledger_id || null,
    ],
  );
  return rows[0];
}

/** Idempotency probe — has this (contact, reference, action) already earned? */
async function ledgerForReference({
  client,
  brand,
  contact_id,
  reference_type,
  reference_id,
  action_type,
}) {
  const params = [brand, reference_type, reference_id, action_type];
  let contactPredicate = "";
  if (contact_id) {
    params.push(contact_id);
    contactPredicate = ` AND contact_id = $${params.length}`;
  }
  const { rows } = await ex(client)(
    `SELECT * FROM shared.crown_ledger
      WHERE business = $1 AND reference_type = $2 AND reference_id = $3
        AND earn_action_type = $4${contactPredicate}
      LIMIT 1`,
    params,
  );
  return rows[0] || null;
}

async function countAwards({ client, brand, contact_id, rule_id }) {
  const { rows } = await ex(client)(
    `SELECT COUNT(*)::int AS n FROM shared.crown_ledger
      WHERE business = $1 AND contact_id = $2 AND earn_rule_id = $3
        AND transaction_type = 'earn'`,
    [brand, contact_id, rule_id],
  );
  return rows[0].n;
}

/** Count earns for a rule within a rolling window (e.g. '1 month', '1 year'). */
async function countAwardsInWindow({
  client,
  brand,
  contact_id,
  rule_id,
  interval,
}) {
  const { rows } = await ex(client)(
    `SELECT COUNT(*)::int AS n FROM shared.crown_ledger
      WHERE business = $1 AND contact_id = $2 AND earn_rule_id = $3
        AND transaction_type = 'earn'
        AND occurred_at >= now() - $4::interval`,
    [brand, contact_id, rule_id, interval],
  );
  return rows[0].n;
}

async function listLedger({ client, brand, contact_id, limit = 50 }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.crown_ledger
      WHERE business = $1 AND contact_id = $2
      ORDER BY occurred_at DESC LIMIT $3`,
    [brand, contact_id, limit],
  );
  return rows;
}

// ── State ──────────────────────────────────────────────────
async function getState({ client, brand, contact_id }) {
  const { rows } = await ex(client)(
    `SELECT s.*,
            ct.tier_key, ct.tier_name, ct.lifetime_discount_pct,
            ct.benefits AS tier_benefits,
            nt.tier_name AS next_tier_name, nt.min_crowns AS next_tier_min
       FROM shared.customer_crown_state s
       LEFT JOIN shared.crown_tiers ct ON ct.tier_id = s.current_tier_id
       LEFT JOIN shared.crown_tiers nt ON nt.tier_id = s.next_tier_id
      WHERE s.business = $1 AND s.contact_id = $2`,
    [brand, contact_id],
  );
  return rows[0] || null;
}

// ── Streak config ──────────────────────────────────────────
async function listStreakConfig({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.crown_streak_config
      WHERE business = $1 AND is_active = true ORDER BY streak_type`,
    [brand],
  );
  return rows;
}

async function getStreakConfig({ client, brand, streak_type }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.crown_streak_config
      WHERE business = $1 AND streak_type = $2`,
    [brand, streak_type],
  );
  return rows[0] || null;
}

// ── Streaks (per customer) ─────────────────────────────────
async function getStreak({ client, brand, contact_id, streak_type }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.crown_streaks
      WHERE business = $1 AND contact_id = $2 AND streak_type = $3`,
    [brand, contact_id, streak_type],
  );
  return rows[0] || null;
}

async function listStreaksForContact({ client, brand, contact_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.crown_streaks
      WHERE business = $1 AND contact_id = $2 ORDER BY streak_type`,
    [brand, contact_id],
  );
  return rows;
}

async function upsertStreak({ client, brand, streak }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.crown_streaks
       (contact_id, business, streak_type, current_length, longest_length,
        status, period_anchor_at, last_qualified_at, current_period_qualified,
        deadline_at, freezes_available, freezes_used, last_nudge_at,
        started_at, broken_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
             COALESCE($14, now()), $15)
     ON CONFLICT (contact_id, business, streak_type) DO UPDATE
       SET current_length          = EXCLUDED.current_length,
           longest_length          = GREATEST(shared.crown_streaks.longest_length, EXCLUDED.longest_length),
           status                  = EXCLUDED.status,
           period_anchor_at        = EXCLUDED.period_anchor_at,
           last_qualified_at       = EXCLUDED.last_qualified_at,
           current_period_qualified = EXCLUDED.current_period_qualified,
           deadline_at             = EXCLUDED.deadline_at,
           freezes_available       = EXCLUDED.freezes_available,
           freezes_used            = EXCLUDED.freezes_used,
           last_nudge_at           = EXCLUDED.last_nudge_at,
           broken_at               = EXCLUDED.broken_at,
           updated_at              = now()
     RETURNING *`,
    [
      streak.contact_id,
      brand,
      streak.streak_type,
      streak.current_length ?? 0,
      streak.longest_length ?? 0,
      streak.status || "active",
      streak.period_anchor_at || null,
      streak.last_qualified_at || null,
      streak.current_period_qualified ?? false,
      streak.deadline_at || null,
      streak.freezes_available ?? 0,
      streak.freezes_used ?? 0,
      streak.last_nudge_at || null,
      streak.started_at || null,
      streak.broken_at || null,
    ],
  );
  return rows[0];
}

/** Streaks whose deadline has passed or is within the nudge window. */
async function listStreaksDue({ client, brand, streak_type, before }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.crown_streaks
      WHERE business = $1 AND streak_type = $2
        AND status IN ('active','at_risk','frozen')
        AND deadline_at IS NOT NULL AND deadline_at <= $3
      ORDER BY deadline_at ASC
      LIMIT 500`,
    [brand, streak_type, before],
  );
  return rows;
}

// ── Reward grants ──────────────────────────────────────────
async function grantExistsForTier({
  client,
  brand,
  contact_id,
  tier_id,
  grant_type,
}) {
  const { rows } = await ex(client)(
    `SELECT grant_id FROM shared.crown_reward_grants
      WHERE business = $1 AND contact_id = $2 AND tier_id = $3
        AND grant_type = $4 AND source_type = 'tier_promotion'
      LIMIT 1`,
    [brand, contact_id, tier_id, grant_type],
  );
  return rows[0] || null;
}

async function insertGrant({ client, brand, grant }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.crown_reward_grants
       (contact_id, business, source_type, tier_id, grant_type,
        discount_pct, status, expires_at, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      grant.contact_id,
      brand,
      grant.source_type || "tier_promotion",
      grant.tier_id || null,
      grant.grant_type,
      grant.discount_pct ?? null,
      grant.status || "active",
      grant.expires_at || null,
      grant.notes || null,
    ],
  );
  return rows[0];
}

async function listActiveGrants({ client, brand, contact_id }) {
  const { rows } = await ex(client)(
    `SELECT g.*, ct.tier_name
       FROM shared.crown_reward_grants g
       LEFT JOIN shared.crown_tiers ct ON ct.tier_id = g.tier_id
      WHERE g.business = $1 AND g.contact_id = $2 AND g.status = 'active'
        AND (g.expires_at IS NULL OR g.expires_at > now())
      ORDER BY g.issued_at DESC`,
    [brand, contact_id],
  );
  return rows;
}

async function consumeGrant({ client, brand, grant_id, order_id }) {
  const { rows } = await ex(client)(
    `UPDATE shared.crown_reward_grants
        SET status = 'redeemed', redeemed_order_id = $3, redeemed_at = now()
      WHERE grant_id = $1 AND business = $2 AND status = 'active'
      RETURNING *`,
    [grant_id, brand, order_id || null],
  );
  return rows[0] || null;
}

// ── Action submissions (verification queue) ────────────────
async function insertSubmission({ client, brand, submission }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.crown_action_submissions
       (contact_id, business, earn_rule_id, action_type, verification_mode,
        social_platform, social_handle, proof_url, media_asset_id, note, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      submission.contact_id,
      brand,
      submission.earn_rule_id || null,
      submission.action_type,
      submission.verification_mode,
      submission.social_platform || null,
      submission.social_handle || null,
      submission.proof_url || null,
      submission.media_asset_id || null,
      submission.note || null,
      submission.status || "pending",
    ],
  );
  return rows[0];
}

async function listPendingSubmissions({ client, brand, limit = 50, offset = 0 }) {
  const { rows } = await ex(client)(
    `SELECT s.*, c.display_name AS contact_name, r.display_name AS rule_name
       FROM shared.crown_action_submissions s
       LEFT JOIN shared.contacts c ON c.contact_id = s.contact_id
       LEFT JOIN shared.crown_earn_rules r ON r.rule_id = s.earn_rule_id
      WHERE s.business = $1 AND s.status = 'pending'
      ORDER BY s.submitted_at ASC
      LIMIT $2 OFFSET $3`,
    [brand, limit, offset],
  );
  return rows;
}

async function getSubmission({ client, brand, submission_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.crown_action_submissions
      WHERE submission_id = $1 AND business = $2`,
    [submission_id, brand],
  );
  return rows[0] || null;
}

async function countSubmissionsInWindow({
  client,
  brand,
  contact_id,
  earn_rule_id,
  interval,
  statuses = ["pending", "approved", "auto_approved"],
}) {
  const { rows } = await ex(client)(
    `SELECT COUNT(*)::int AS n FROM shared.crown_action_submissions
      WHERE business = $1 AND contact_id = $2 AND earn_rule_id = $3
        AND status = ANY($4::text[])
        AND submitted_at >= now() - $5::interval`,
    [brand, contact_id, earn_rule_id, statuses, interval],
  );
  return rows[0].n;
}

async function reviewSubmission({ client, brand, submission_id, patch }) {
  const { rows } = await ex(client)(
    `UPDATE shared.crown_action_submissions
        SET status = $3, reviewed_by = $4, reviewed_at = now(),
            review_note = $5, crowns_awarded = $6, ledger_id = $7
      WHERE submission_id = $1 AND business = $2
      RETURNING *`,
    [
      submission_id,
      brand,
      patch.status,
      patch.reviewed_by || null,
      patch.review_note || null,
      patch.crowns_awarded ?? null,
      patch.ledger_id || null,
    ],
  );
  return rows[0] || null;
}

module.exports = {
  // tiers
  listTiers,
  getTierById,
  tierForLifetime,
  updateTier,
  // earn rules
  listRules,
  getRuleByKey,
  updateRule,
  // ledger
  insertLedger,
  ledgerForReference,
  countAwards,
  countAwardsInWindow,
  listLedger,
  // state
  getState,
  // streak config
  listStreakConfig,
  getStreakConfig,
  // streaks
  getStreak,
  listStreaksForContact,
  upsertStreak,
  listStreaksDue,
  // grants
  grantExistsForTier,
  insertGrant,
  listActiveGrants,
  consumeGrant,
  // submissions
  insertSubmission,
  listPendingSubmissions,
  getSubmission,
  countSubmissionsInWindow,
  reviewSubmission,
};
