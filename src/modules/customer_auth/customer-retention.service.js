/**
 * Customer-facing retention surface (§6.23) for the storefront. Composes the
 * (permission-gated, staff-facing) retention services into safe, contact-scoped
 * reads + actions a logged-in shopper can perform on their own account:
 * loyalty status, their referral code, the rewards catalogue, and redeeming a
 * reward into a single-use voucher code they apply at checkout.
 */

"use strict";

const retentionService = require("../retention/retention.service");
const rewardsService = require("../retention/rewards.service");
const couponService = require("../retention/coupon.service");

/** Loyalty status: balance, current tier + progress to the next, recent ledger. */
async function loyalty({ brand, contact_id }) {
  const { state, ledger } = await retentionService.getLoyaltyState({ brand, contact_id });
  const tiers = await retentionService.listTiers({ brand });

  const lifetime = state ? Number(state.lifetime_earned || 0) : 0;
  const sorted = [...tiers].sort((a, b) => a.min_lifetime_points - b.min_lifetime_points);
  const next = sorted.find((t) => Number(t.min_lifetime_points) > lifetime) || null;

  return {
    balance: state ? Number(state.current_balance || 0) : 0,
    lifetime_earned: lifetime,
    tier: state && state.tier_key ? { key: state.tier_key, name: state.tier_name } : null,
    next_tier: next
      ? { name: next.tier_name, points_to_go: Number(next.min_lifetime_points) - lifetime }
      : null,
    ledger: (ledger || []).slice(0, 12).map((e) => ({
      transaction_type: e.transaction_type,
      points: e.points,
      notes: e.notes,
      created_at: e.created_at,
    })),
  };
}

/** The shopper's referral code + share stats (created on first view). */
async function referral({ brand, contact_id, contact }) {
  const ref = await retentionService.getOrCreateReferral({ brand, contact_id, contact });
  return {
    referral_code: ref.referral_code,
    successful_count: ref.successful_count || 0,
    total_rewards_value: Number(ref.total_rewards_value || 0),
  };
}

/** Active rewards catalogue (display only — redeeming is a separate action). */
async function rewards({ brand }) {
  const list = await rewardsService.listCatalogue({ brand });
  return list.map((r) => ({
    reward_id: r.reward_id,
    display_name: r.display_name,
    description: r.description,
    reward_type: r.reward_type,
    points_cost: r.points_cost,
    discount_type: r.discount_type,
    discount_value:
      r.discount_value !== null && r.discount_value !== undefined
        ? Number(r.discount_value)
        : null,
  }));
}

/**
 * Redeem a reward for the shopper: deducts points (via the ledger) and, for
 * discount / free-shipping rewards, mints a single-use coupon code they can
 * apply at checkout. Free-product / gift rewards are recorded for fulfilment.
 */
async function redeem({ brand, contact_id, reward_id, request_id }) {
  const result = await rewardsService.redeemReward({
    brand,
    contact_id,
    reward_id,
    reference_type: "manual",
    user: { user_id: null },
    request_id,
  });

  let voucher_code = null;
  const f = result.fulfilment || {};
  if (f.kind === "discount" || f.kind === "free_shipping") {
    const code = "PTS-" + Math.random().toString(36).slice(2, 8).toUpperCase();
    const input =
      f.kind === "free_shipping"
        ? { discount_type: "free_shipping", discount_value: 0 }
        : {
            discount_type: f.discount_type || "fixed_amount",
            discount_value: Number(f.discount_value || 0),
            max_discount_value: f.max_discount_value || undefined,
          };
    const coupon = await couponService.createCoupon({
      brand,
      user: { user_id: null },
      request_id: request_id || `reward:${result.redemption_id}`,
      input: {
        ...input,
        coupon_code: code,
        display_name: "Reward voucher",
        is_single_use: true,
        per_customer_limit: 1,
      },
    });
    voucher_code = coupon.coupon_code;
  }

  return {
    points_spent: result.points_spent,
    fulfilment: result.fulfilment,
    voucher_code,
  };
}

module.exports = { loyalty, referral, rewards, redeem };
