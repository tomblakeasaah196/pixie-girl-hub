/**
 * Loyalty rewards catalogue service (Module 6.23). The config-driven
 * redemption engine: admins define what points buy (order discount, free
 * shipping, free product, gift) and customers redeem them at checkout/POS.
 *
 * Redeeming deducts points via the loyalty ledger (the single source of
 * truth) and records a reward redemption with the resolved fulfilment effect,
 * which the caller applies to the order. Order-discount fulfilment must still
 * respect the Pricing min-margin floor at the point of application (D-6).
 */

"use strict";

const repo = require("./rewards.repo");
const lrepo = require("./retention.repo");
const retentionService = require("./retention.service");
const { transaction } = require("../../config/database");
const { audit } = require("../../middleware/audit");
const { NotFoundError, AppError } = require("../../utils/errors");

const listCatalogue = ({ brand }) => repo.listActive({ brand });
const listAll = ({ brand }) => repo.listAll({ brand });

async function create({ brand, user, request_id, input }) {
  const reward = await repo.create({ brand, input, user_id: user.user_id });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.reward.create",
    target_type: "loyalty_reward",
    target_id: reward.reward_id,
    after: { reward_key: reward.reward_key },
    request_id,
  });
  return reward;
}

async function update({ brand, user, request_id, id, patch }) {
  const reward = await repo.update({ brand, id, patch });
  if (!reward) throw new NotFoundError("Loyalty reward");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.reward.update",
    target_type: "loyalty_reward",
    target_id: id,
    after: patch,
    request_id,
  });
  return reward;
}

/** Translate a reward into the order effect the checkout will apply. */
function fulfilmentFor(reward) {
  switch (reward.reward_type) {
    case "order_discount":
      return {
        kind: "discount",
        discount_type: reward.discount_type,
        discount_value: Number(reward.discount_value || 0),
        max_discount_value: reward.max_discount_value ? Number(reward.max_discount_value) : null,
      };
    case "free_shipping":
      return { kind: "free_shipping" };
    case "free_product":
      return {
        kind: "free_product",
        product_id: reward.free_product_id,
        variant_id: reward.free_variant_id,
      };
    case "gift":
      return { kind: "gift", description: reward.gift_description };
    default:
      return { kind: reward.reward_type };
  }
}

/**
 * Redeem a catalogue reward for a customer.
 * @returns {Promise<{redemption_id, points_spent, fulfilment}>}
 */
async function redeemReward({
  brand,
  contact_id,
  reward_id,
  reference_type,
  reference_id,
  user,
  request_id,
}) {
  if (!contact_id) throw new AppError("NO_CONTACT", "A customer is required to redeem.", 400);
  return transaction(async (client) => {
    const reward = await repo.get({ client, brand, id: reward_id });
    if (!reward || !reward.is_active) throw new NotFoundError("Loyalty reward");

    const now = new Date();
    if (reward.valid_to && new Date(reward.valid_to) < now)
      throw new AppError("REWARD_EXPIRED", "This reward is no longer available.", 409);

    const state = await lrepo.getLoyaltyState({ client, brand, contact_id });
    const balance = state ? Number(state.current_balance) : 0;
    if (balance < reward.points_cost)
      throw new AppError("INSUFFICIENT_POINTS", "Not enough points for this reward.", 409);

    // Tier gating.
    if (reward.min_tier_id) {
      const minLifetime = await repo.tierMinLifetime({ client, tier_id: reward.min_tier_id });
      const lifetime = state ? Number(state.lifetime_earned) : 0;
      if (minLifetime !== null && minLifetime !== undefined && lifetime < minLifetime)
        throw new AppError("TIER_LOCKED", "Your tier cannot redeem this reward yet.", 403);
    }

    // Limits.
    if (reward.max_redemptions_per_customer) {
      const used = await repo.countCustomerRedemptions({ client, reward_id, contact_id });
      if (used >= reward.max_redemptions_per_customer)
        throw new AppError("REWARD_LIMIT", "You have already redeemed this reward.", 409);
    }
    if (
      reward.total_redemption_limit &&
      reward.total_redeemed >= reward.total_redemption_limit
    )
      throw new AppError("REWARD_SOLD_OUT", "This reward is fully redeemed.", 409);

    // Deduct points via the ledger.
    const ledger = await lrepo.insertLoyaltyLedger({
      client,
      brand,
      entry: {
        contact_id,
        transaction_type: "redeemed",
        points: -Math.abs(reward.points_cost),
        reference_type: reference_type || "loyalty_reward",
        reference_id: reference_id || reward_id,
        notes: `Redeemed reward: ${reward.display_name}`,
        created_by: user && user.user_id,
      },
    });
    await retentionService.recomputeTier({ client, brand, contact_id });

    const fulfilment = fulfilmentFor(reward);
    const redemption = await repo.insertRedemption({
      client,
      brand,
      redemption: {
        reward_id,
        contact_id,
        points_spent: reward.points_cost,
        ledger_id: ledger.ledger_id,
        reference_type,
        reference_id,
        fulfilment,
      },
    });
    await repo.bumpRedeemed({ client, reward_id });

    await audit({
      business: brand,
      user_id: user && user.user_id,
      action_key: "retention.reward.redeem",
      target_type: "loyalty_reward",
      target_id: reward_id,
      after: { contact_id, points_spent: reward.points_cost },
      request_id,
    });

    return {
      redemption_id: redemption.redemption_id,
      points_spent: reward.points_cost,
      fulfilment,
    };
  });
}

module.exports = { listCatalogue, listAll, create, update, redeemReward };
