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
  let voucher_code = result.voucher_code || null;
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

module.exports = { loyalty, referral, rewards, redeem };
