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
const crownService = require("../retention/crown.service");
const crownStreak = require("../retention/crown.streak");
const tasksService = require("../../shared/tasks/tasks.service");
const { getBroadcaster } = require("../../realtime/emitter");
const { logger } = require("../../config/logger");

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

  // P1-6: the voucher is now minted atomically inside redeemReward's
  // transaction (contact-bound, single-use, per-reward expiry). The
  // customer-facing wrapper just surfaces the code and, for physical
  // rewards, opens a fulfilment task.
  const voucher_code = result.voucher_code || null;
  let fulfilment_task_id = null;
  const f = result.fulfilment || {};
  if (f.kind === "free_product" || f.kind === "gift") {
    // P2-5: physical-goods rewards need a human to fulfil. Before this the
    // JSON was stored on the redemption row and the storefront said "our
    // team will be in touch" — but no task, notification, or queue was
    // created for staff. Points left the account with nothing on the ops
    // side. Now we open a task in shared.tasks and ping the ops rail so it
    // shows up wherever the retention team already lives.
    try {
      const task = await tasksService.createFromModule({
        brand,
        created_by: null,
        task: {
          title:
            f.kind === "free_product"
              ? "Fulfil free-product reward redemption"
              : "Fulfil gift reward redemption",
          description: JSON.stringify(
            {
              redemption_id: result.redemption_id,
              contact_id,
              reward_kind: f.kind,
              details: f,
            },
            null,
            2,
          ),
          priority: "high",
          reference_type: "reward_redemption",
          reference_id: result.redemption_id,
        },
      });
      fulfilment_task_id = task.task_id;
      // Fan out to the brand's retention room so the Tasks widget on
      // whoever's staffing retention ops updates live. Matches the room
      // naming convention (`brand:<brand>:<resource>`) used across the app.
      try {
        getBroadcaster()
          .to(`brand:${brand}:retention`)
          .emit("reward.fulfilment_task", {
            task_id: task.task_id,
            reward_kind: f.kind,
            redemption_id: result.redemption_id,
          });
      } catch (err) {
        logger.debug(
          { err: err.message },
          "reward fulfilment socket ping skipped",
        );
      }
    } catch (err) {
      // Never fail the redemption on a task-creation hiccup; the points are
      // already spent and the customer-facing UX must return cleanly. The
      // redemption row still carries the fulfilment JSON so ops can
      // reconcile from the retention analytics view if needed.
      logger.error(
        { err: err.message, redemption_id: result.redemption_id },
        "reward fulfilment task creation failed",
      );
    }
  }

  return {
    points_spent: result.points_spent,
    fulfilment: result.fulfilment,
    voucher_code,
    fulfilment_task_id,
  };
}

// ── Crowns 👑 (§6.23 unified economy) ──────────────────────
/** The shopper's own wallet: balance, tier + progress, streaks, vouchers, history. */
async function crownWallet({ brand, contact_id }) {
  const w = await crownService.getWallet({ brand, contact_id });
  const st = w.state;
  return {
    balance: st ? Number(st.current_crowns || 0) : 0,
    lifetime_earned: st ? Number(st.lifetime_earned || 0) : 0,
    tier: st && st.tier_key
      ? {
          key: st.tier_key,
          name: st.tier_name,
          lifetime_discount_pct: Number(st.lifetime_discount_pct || 0),
        }
      : null,
    next_tier: st && st.next_tier_name
      ? { name: st.next_tier_name, crowns_to_go: Number(st.crowns_to_next_tier || 0) }
      : null,
    streaks: (w.streaks || []).map((s) => ({
      streak_type: s.streak_type,
      current_length: s.current_length,
      longest_length: s.longest_length,
      status: s.status,
      deadline_at: s.deadline_at,
      freezes_available: s.freezes_available,
    })),
    vouchers: (w.grants || []).map((g) => ({
      grant_type: g.grant_type,
      discount_pct:
        g.discount_pct !== null && g.discount_pct !== undefined
          ? Number(g.discount_pct)
          : null,
      tier_name: g.tier_name,
      expires_at: g.expires_at,
    })),
    ledger: (w.ledger || []).slice(0, 15).map((e) => ({
      transaction_type: e.transaction_type,
      crowns: e.crowns,
      description: e.description || e.earn_action_type,
      occurred_at: e.occurred_at,
    })),
  };
}

/** The public programme: tier ladder + ways to earn + streak defs (marketing page). */
async function crownProgramme({ brand }) {
  const [tiers, rules, streaks] = await Promise.all([
    crownService.listTiers({ brand }),
    crownService.listRules({ brand }),
    crownService.listStreakConfig({ brand }),
  ]);
  return {
    tiers: tiers.map((t) => ({
      tier_key: t.tier_key,
      tier_name: t.tier_name,
      description: t.description,
      min_crowns: Number(t.min_crowns),
      next_purchase_discount_pct: Number(t.next_purchase_discount_pct),
      lifetime_discount_pct: Number(t.lifetime_discount_pct),
      grants_free_shipping_next: t.grants_free_shipping_next,
      benefits: t.benefits || {},
      badge_colour_hex: t.badge_colour_hex,
    })),
    earn_rules: rules.map((r) => ({
      rule_key: r.rule_key,
      display_name: r.display_name,
      description: r.description,
      action_type: r.action_type,
      crowns_mode: r.crowns_mode,
      crown_value: r.crown_value,
      unit_currency_per_crown:
        r.unit_currency_per_crown !== null && r.unit_currency_per_crown !== undefined
          ? Number(r.unit_currency_per_crown)
          : null,
      verification_mode: r.verification_mode,
      social_platform: r.social_platform,
    })),
    streaks: streaks.map((s) => ({
      streak_type: s.streak_type,
      display_name: s.display_name,
      description: s.description,
      period_unit: s.period_unit,
    })),
  };
}

/** The shopper's checkout entitlement (lifetime + best one-time voucher). */
function crownDiscount({ brand, contact_id }) {
  return crownService.getActiveDiscount({ brand, contact_id });
}

/** Submit a social/UGC action (honor auto-approves; manual queues for review). */
function crownSubmit({ brand, contact_id, input }) {
  return crownService.submitAction({
    brand,
    contact_id,
    rule_key: input.rule_key,
    social_handle: input.social_handle,
    proof_url: input.proof_url,
    media_asset_id: input.media_asset_id,
    note: input.note,
  });
}

/** Weekly engagement check-in — advances the shopper's check-in streak. */
async function crownCheckIn({ brand, contact_id }) {
  const streaks = await crownStreak.checkIn({ brand, contact_id });
  return { streaks };
}

module.exports = {
  loyalty,
  referral,
  rewards,
  redeem,
  crownWallet,
  crownProgramme,
  crownDiscount,
  crownSubmit,
  crownCheckIn,
};
