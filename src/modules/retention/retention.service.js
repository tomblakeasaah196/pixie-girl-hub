/**
 * Customer Retention & Loyalty + Streak Stars + Hair Quiz (V2.2 §6.23) —
 * business logic.
 *
 * Loyalty: 1 point per ₦`points_per_naira` spent (business_config
 * loyalty_settings, default ₦100/pt), scaled by the customer's tier
 * multiplier. The ledger trigger maintains the balance; we recompute tier.
 * Streak Stars: award per earn-rule; the ledger trigger maintains state+tier.
 * Referral: issue a code per customer; redeem once per referred customer.
 * Hair Quiz: public capture + recommendations + optional star award.
 */

"use strict";

const repo = require("./retention.repo");
const earnRepo = require("./earn.repo");
const referralConfig = require("./referral-config.repo");
const events = require("./retention.events");
const businessConfig = require("../business_setup/business-config.repo");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { money } = require("../../utils/money");
const { NotFoundError, AppError } = require("../../utils/errors");

const DEFAULT_POINTS_PER_NAIRA = 100; // ₦100 = 1 base point

// ── Loyalty ────────────────────────────────────────────────
function listTiers({ brand }) {
  return repo.listLoyaltyTiers({ brand });
}

async function createTier({ brand, user, request_id, input }) {
  const tier = await repo.createLoyaltyTier({ brand, input, user_id: user.user_id });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.loyalty.tier_create",
    target_type: "loyalty_tier",
    target_id: tier.tier_id,
    after: { tier_key: tier.tier_key },
    request_id,
  });
  return tier;
}

async function updateTier({ brand, user, request_id, id, patch }) {
  const tier = await repo.updateLoyaltyTier({ brand, id, patch, user_id: user.user_id });
  if (!tier) throw new NotFoundError("Loyalty tier");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.loyalty.tier_update",
    target_type: "loyalty_tier",
    target_id: id,
    after: patch,
    request_id,
  });
  return tier;
}

async function getLoyaltyState({ brand, contact_id }) {
  const state = await repo.getLoyaltyState({ brand, contact_id });
  const ledger = await repo.listLoyaltyLedger({ brand, contact_id });
  return { state: state || null, ledger };
}

async function recomputeTier({ client, brand, contact_id }) {
  const state = await repo.getLoyaltyState({ client, brand, contact_id });
  if (!state) return null;
  const tier = await repo.tierForLifetime({
    client,
    brand,
    lifetime: state.lifetime_earned,
  });
  if (tier && tier.tier_id !== state.current_tier_id) {
    await repo.setLoyaltyTier({
      client,
      brand,
      contact_id,
      tier_id: tier.tier_id,
    });
    events.emit("loyalty.tier_changed", {
      brand,
      contact_id,
      tier_key: tier.tier_key,
    });
  }
  return tier;
}

function expiryFromDays(days) {
  if (!days || days <= 0) return null;
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/**
 * Award purchase points for a paid order. Config-driven: resolves the active
 * `earned_purchase` rules in shared.loyalty_earn_rules (flat or per-currency,
 * with optional tier multiplier + expiry) and writes a single ledger entry.
 * Falls back to the legacy ₦/point rate if no rule is configured. Idempotent
 * on (order → earned_purchase).
 */
async function earnForOrder({
  client,
  brand,
  contact_id,
  order_id,
  total_ngn,
  created_by,
}) {
  const run = async (c) => {
    const existing = await repo.ledgerEntryForReference({
      client: c,
      brand,
      reference_type: "sales_order",
      reference_id: order_id,
      transaction_type: "earned_purchase",
    });
    if (existing) return existing;

    const state = await repo.getLoyaltyState({ client: c, brand, contact_id });
    const multiplier =
      state && state.earning_multiplier ? Number(state.earning_multiplier) : 1;
    const orderValue = Number(money(total_ngn).toFixed(2));

    const rules = await earnRepo.listActiveEarnRules({
      client: c,
      brand,
      action_type: "earned_purchase",
    });

    let points = 0;
    let expireDays = 0;
    if (rules.length > 0) {
      for (const rule of rules) {
        if (rule.min_order_value && orderValue < Number(rule.min_order_value)) continue;
        let base;
        if (rule.points_mode === "per_currency") {
          base = Math.floor(orderValue / Number(rule.currency_per_point));
        } else {
          base = Number(rule.points_value || 0);
        }
        const mult = rule.apply_tier_multiplier ? multiplier : 1;
        points += Math.floor(base * mult);
        if (rule.points_expire_days)
          expireDays = Math.max(expireDays, Number(rule.points_expire_days));
      }
    } else {
      // Legacy fallback (no earn rule configured for this brand yet).
      const cfg = await businessConfig.findByKey(brand);
      const perNaira =
        (cfg && cfg.loyalty_settings && cfg.loyalty_settings.points_per_naira) ||
        DEFAULT_POINTS_PER_NAIRA;
      points = Math.floor(Math.floor(orderValue / perNaira) * multiplier);
    }
    if (points <= 0) return null;

    const entry = await repo.insertLoyaltyLedger({
      client: c,
      brand,
      entry: {
        contact_id,
        transaction_type: "earned_purchase",
        points,
        multiplier_used: multiplier,
        reference_type: "sales_order",
        reference_id: order_id,
        notes: `Purchase points for order`,
        expires_at: expiryFromDays(expireDays),
        created_by,
      },
    });
    await recomputeTier({ client: c, brand, contact_id });
    events.emit("loyalty.earned", { brand, contact_id, points, order_id });
    return entry;
  };
  return client ? run(client) : transaction(run);
}

/**
 * Award points for a non-purchase earn action (review, social-share,
 * milestone, bonus) using the config-driven earn rules. Idempotent per
 * (reference, action) and honours per-customer lifetime caps. Returns the
 * ledger entry, or null if no rule / cap reached / zero points.
 */
async function earnForAction({
  client,
  brand,
  contact_id,
  action_type,
  reference_type,
  reference_id,
  amount_ngn,
  notes,
  created_by,
}) {
  const run = async (c) => {
    const rules = await earnRepo.listActiveEarnRules({ client: c, brand, action_type });
    const rule = rules[0];
    if (!rule) return null;

    if (reference_id) {
      const existing = await repo.ledgerEntryForReference({
        client: c,
        brand,
        reference_type,
        reference_id,
        transaction_type: action_type,
      });
      if (existing) return existing;
    }
    if (rule.max_awards_per_customer_lifetime) {
      const count = await earnRepo.countEarnsByType({
        client: c,
        brand,
        contact_id,
        transaction_type: action_type,
      });
      if (count >= rule.max_awards_per_customer_lifetime) return null;
    }

    const state = await repo.getLoyaltyState({ client: c, brand, contact_id });
    const multiplier =
      state && state.earning_multiplier ? Number(state.earning_multiplier) : 1;
    let base;
    if (rule.points_mode === "per_currency" && amount_ngn) {
      base = Math.floor(Number(money(amount_ngn).toFixed(2)) / Number(rule.currency_per_point));
    } else {
      base = Number(rule.points_value || 0);
    }
    const points = Math.floor(base * (rule.apply_tier_multiplier ? multiplier : 1));
    if (points <= 0) return null;

    const entry = await repo.insertLoyaltyLedger({
      client: c,
      brand,
      entry: {
        contact_id,
        transaction_type: action_type,
        points,
        multiplier_used: rule.apply_tier_multiplier ? multiplier : null,
        reference_type,
        reference_id,
        notes: notes || rule.display_name,
        expires_at: expiryFromDays(rule.points_expire_days),
        created_by,
      },
    });
    await recomputeTier({ client: c, brand, contact_id });
    events.emit("loyalty.earned", { brand, contact_id, points, action_type });
    return entry;
  };
  return client ? run(client) : transaction(run);
}

async function redeemPoints({
  brand,
  user,
  request_id,
  contact_id,
  points,
  notes,
}) {
  return transaction(async (client) => {
    const state = await repo.getLoyaltyState({ client, brand, contact_id });
    if (!state || state.current_balance < points)
      throw new AppError(
        "INSUFFICIENT_POINTS",
        "Not enough points to redeem",
        409,
      );
    const entry = await repo.insertLoyaltyLedger({
      client,
      brand,
      entry: {
        contact_id,
        transaction_type: "redeemed",
        points: -Math.abs(points),
        notes: notes || "Points redeemed",
        created_by: user.user_id,
      },
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "retention.loyalty.redeem",
      target_type: "contact",
      target_id: contact_id,
      after: { points: -Math.abs(points) },
      request_id,
    });
    events.emit("loyalty.redeemed", { brand, contact_id, points });
    return entry;
  });
}

async function adjustPoints({
  brand,
  user,
  request_id,
  contact_id,
  points,
  notes,
}) {
  return transaction(async (client) => {
    const entry = await repo.insertLoyaltyLedger({
      client,
      brand,
      entry: {
        contact_id,
        transaction_type: "adjustment",
        points,
        notes: notes || "Manual adjustment",
        created_by: user.user_id,
      },
    });
    await recomputeTier({ client, brand, contact_id });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "retention.loyalty.adjust",
      target_type: "contact",
      target_id: contact_id,
      after: { points },
      request_id,
    });
    return entry;
  });
}

// ── Referral ───────────────────────────────────────────────
function buildCode(contact) {
  const base = (contact.first_name || contact.display_name || "REF")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${base || "REF"}${suffix}`;
}

async function getOrCreateReferral({ brand, contact_id, contact }) {
  return transaction(async (client) => {
    const existing = await repo.findReferralByContact({
      client,
      brand,
      contact_id,
    });
    if (existing) return existing;
    let code = buildCode(contact || { display_name: "REF" });
    // Retry once on the (unlikely) unique collision.
    try {
      return await repo.insertReferral({
        client,
        brand,
        contact_id,
        referral_code: code,
      });
    } catch {
      code = `${code}${Math.floor(Math.random() * 90 + 10)}`;
      return repo.insertReferral({
        client,
        brand,
        contact_id,
        referral_code: code,
      });
    }
  });
}

async function validateReferralCode({ code }) {
  const ref = await repo.findReferralByCode({ code });
  if (!ref) return { valid: false };
  return {
    valid: true,
    referral_code: ref.referral_code,
    referrer_first_name: ref.referrer_first_name || null,
    successful_count: ref.successful_count,
  };
}

/**
 * Redeem a referral when a referred customer's order qualifies. Awards the
 * referrer loyalty points; idempotent per (referral, referred contact).
 */
async function redeemReferral({
  brand,
  code,
  referred_contact_id,
  order_id,
  order_value,
}) {
  return transaction(async (client) => {
    const ref = await repo.findReferralByCode({ client, code });
    if (!ref) throw new NotFoundError("Referral code");

    const settings = await referralConfig.getSettings({ client, brand });
    if (settings && settings.is_active === false)
      throw new AppError("REFERRALS_OFF", "Referral programme is not active", 409);

    // Anti-fraud: block self-referral (config-gated, on by default).
    const af = (settings && settings.anti_fraud) || {};
    if (af.block_self_referral !== false && ref.contact_id === referred_contact_id)
      throw new AppError("SELF_REFERRAL", "Cannot redeem your own code", 409);

    // Minimum qualifying order value.
    const minQualifying = settings ? Number(settings.min_qualifying_order_ngn || 0) : 0;
    if (minQualifying > 0 && Number(order_value || 0) < minQualifying)
      throw new AppError("ORDER_TOO_SMALL", "Order does not qualify for referral reward", 409);

    const dup = await repo.findRedemption({
      client,
      referral_id: ref.referral_id,
      referred_contact_id,
    });
    if (dup) return dup;

    // Tiered ladder: reward scales with the referrer's successful count.
    const newCount = (ref.successful_count || 0) + 1;
    const tier = await referralConfig.tierForCount({ client, brand, count: newCount });
    const rewardPoints = tier
      ? tier.referrer_points
      : settings
        ? settings.default_referrer_points
        : (ref.reward_rules && ref.reward_rules.referrer_points) || 500;
    const rewardCredit = tier
      ? Number(tier.referrer_credit_ngn || 0)
      : settings
        ? Number(settings.default_referrer_credit_ngn || 0)
        : 0;

    // Friend (referred) discount value, for the record.
    let friendDiscount = 0;
    if (settings && settings.friend_discount_type && settings.friend_discount_value) {
      friendDiscount =
        settings.friend_discount_type === "percentage"
          ? Math.round(Number(order_value || 0) * Number(settings.friend_discount_value))
          : Number(settings.friend_discount_value);
    }

    const redemption = await repo.insertRedemption({
      client,
      brand,
      redemption: {
        referral_id: ref.referral_id,
        referred_contact_id,
        triggering_order_id: order_id,
        triggering_order_value: order_value,
        referrer_reward_points: rewardPoints,
        referred_discount_value: friendDiscount,
        status: "rewarded",
      },
    });
    await repo.bumpReferralCounters({
      client,
      referral_id: ref.referral_id,
      reward_value: rewardCredit,
    });
    // Credit the referrer's loyalty balance.
    await repo.insertLoyaltyLedger({
      client,
      brand,
      entry: {
        contact_id: ref.contact_id,
        transaction_type: "earned_referral",
        points: rewardPoints,
        reference_type: "referral_redemption",
        reference_id: redemption.redemption_id,
        notes: `Referral reward (${code})`,
      },
    });
    await recomputeTier({ client, brand, contact_id: ref.contact_id });
    events.emit("referral.redeemed", {
      brand,
      referral_id: ref.referral_id,
      referrer_contact_id: ref.contact_id,
      referred_contact_id,
    });
    return redemption;
  });
}

// ── Streak Stars ───────────────────────────────────────────
function listStreakTiers({ brand }) {
  return repo.listStreakTiers({ brand });
}

async function getStreakState({ brand, contact_id }) {
  const state = await repo.getStreakState({ brand, contact_id });
  const ledger = await repo.listStreakLedger({ brand, contact_id });
  return { state: state || null, ledger };
}

/**
 * Award stars for an action. Resolves the active earn rule for the
 * action_type, enforces lifetime caps, is idempotent per reference.
 */
async function awardStars({
  client,
  brand,
  contact_id,
  action_type,
  reference_type,
  reference_id,
  amount_ngn,
  awarded_by,
  description,
}) {
  const run = async (c) => {
    const rules = await repo.listStreakRules({ client: c, brand, action_type });
    const rule = rules[0];
    if (!rule) return null;

    if (reference_id) {
      const existing = await repo.streakLedgerForReference({
        client: c,
        brand,
        reference_type,
        reference_id,
        action_type,
      });
      if (existing) return existing;
    }
    if (rule.max_awards_per_customer_lifetime) {
      const count = await repo.countStreakAwards({
        client: c,
        brand,
        contact_id,
        rule_id: rule.rule_id,
      });
      if (count >= rule.max_awards_per_customer_lifetime) return null;
    }

    // money_spent rules scale by currency spent; others award the flat value.
    let stars = rule.star_value;
    if (
      action_type === "money_spent" &&
      rule.unit_currency_per_star &&
      amount_ngn
    ) {
      stars = Math.floor(
        Number(money(amount_ngn).toFixed(2)) /
          Number(rule.unit_currency_per_star),
      );
    }
    if (stars <= 0) return null;

    const entry = await repo.insertStreakLedger({
      client: c,
      brand,
      entry: {
        contact_id,
        transaction_type: "earn",
        stars,
        earn_rule_id: rule.rule_id,
        earn_action_type: action_type,
        reference_type,
        reference_id,
        description: description || rule.display_name,
        awarded_by,
      },
    });
    events.emit("streak.earned", { brand, contact_id, stars, action_type });
    return entry;
  };
  return client ? run(client) : transaction(run);
}

// ── Hair Quiz ──────────────────────────────────────────────
async function getQuiz({ brand, slug }) {
  const quiz = await repo.getActiveQuiz({ brand, slug });
  if (!quiz) throw new NotFoundError("Quiz");
  const questions = await repo.getQuizQuestions({
    brand,
    quiz_id: quiz.quiz_id,
  });
  return {
    quiz_id: quiz.quiz_id,
    quiz_key: quiz.quiz_key,
    display_name: quiz.display_name,
    description: quiz.description,
    cta_label: quiz.cta_label,
    hero_image_url: quiz.hero_image_url,
    completion_message: quiz.completion_message,
    questions,
  };
}

async function submitQuiz({ brand, input, ip, user_agent }) {
  return transaction(async (client) => {
    const quiz = await repo.getActiveQuiz({ brand, slug: input.slug });
    if (!quiz) throw new NotFoundError("Quiz");

    const recommended = await repo.recommendVariants({
      client,
      brand,
      hints: input.answers || {},
    });

    // Award completion stars if the quiz is wired to a rule and we have a
    // contact to credit (logged-in or matched). Anonymous responses still save.
    let starsAwarded = null;
    let starsEntryId = null;
    if (input.contact_id) {
      const entry = await awardStars({
        client,
        brand,
        contact_id: input.contact_id,
        action_type: "hair_quiz_complete",
        reference_type: "hair_quiz",
        reference_id: quiz.quiz_id,
        awarded_by: null,
        description: "Completed the hair quiz",
      });
      if (entry) {
        starsAwarded = entry.stars;
        starsEntryId = entry.entry_id;
      }
    }

    const response = await repo.insertQuizResponse({
      client,
      brand,
      response: {
        quiz_id: quiz.quiz_id,
        storefront_session_id: input.storefront_session_id,
        contact_id: input.contact_id,
        visitor_email: input.visitor_email,
        visitor_first_name: input.visitor_first_name,
        visitor_phone: input.visitor_phone,
        answers: input.answers || {},
        recommended_variant_ids: recommended,
        stars_awarded: starsAwarded,
        stars_ledger_entry_id: starsEntryId,
        ip_address: ip,
        user_agent,
        utm_source: input.utm_source,
        utm_medium: input.utm_medium,
        utm_campaign: input.utm_campaign,
      },
    });
    events.emit("quiz.completed", {
      brand,
      quiz_id: quiz.quiz_id,
      response_id: response.response_id,
      visitor_email: input.visitor_email || null,
    });
    return {
      response_id: response.response_id,
      recommended_variant_ids: recommended,
      stars_awarded: starsAwarded,
      completion_message: quiz.completion_message,
    };
  });
}

module.exports = {
  // loyalty
  listTiers,
  createTier,
  updateTier,
  getLoyaltyState,
  earnForOrder,
  earnForAction,
  redeemPoints,
  adjustPoints,
  recomputeTier,
  // referral
  getOrCreateReferral,
  validateReferralCode,
  redeemReferral,
  // streak
  listStreakTiers,
  getStreakState,
  awardStars,
  // quiz
  getQuiz,
  submitQuiz,
};
