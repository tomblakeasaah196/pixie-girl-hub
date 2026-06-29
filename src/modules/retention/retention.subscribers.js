/**
 * Retention subscribers (Module 6.23) — the trigger spine.
 *
 * On `order.paid` (via the transactional outbox, post-commit, at-least-once):
 *   1. award loyalty purchase points (config-driven earn rules) + Streak Stars;
 *   2. auto-redeem a referral if the order carried a referral code (full
 *      settlement);
 *   3. feed the retention strategy engine — fire `order_placed`, plus
 *      `first_purchase` for a first order and `high_value_purchase` (the
 *      strategy's own conditions decide the value threshold).
 *
 * In-process domain events (retention.events) are also bridged into the
 * strategy engine: tier changes → `tier_upgrade`, referral redemptions →
 * `referral_completed`, quiz completions → `custom_event`.
 *
 * Every earner/trigger is idempotent + best-effort: one failure is logged and
 * swallowed so the others (and the row's other consumers) are unaffected.
 */

"use strict";

const outbox = require("../../shared/outbox/outbox");
const service = require("./retention.service");
const engine = require("./strategy.engine");
const events = require("./retention.events");
const { query } = require("../../config/database");
const { VALID } = require("../../config/brands");
const { logger } = require("../../config/logger");

const swallow = (label) => (err) =>
  logger.error({ err: err.message }, `retention: ${label} failed`);

/** Count a contact's counted orders to detect a first purchase. */
async function isFirstOrder(brand, contact_id) {
  if (!VALID.has(brand) || !contact_id) return false;
  try {
    const { rows } = await query(
      `SELECT count(*)::int AS c FROM ${brand}.sales_orders
        WHERE contact_id = $1 AND placed_at IS NOT NULL
          AND status NOT IN ('draft','cancelled','refunded','cancellation_requested')`,
      [contact_id],
    );
    return rows[0].c <= 1;
  } catch {
    return false;
  }
}

async function awardLoyaltyAndStreak(payload) {
  const { brand, order_id, contact_id, total_ngn, referral_code } = payload;
  if (!contact_id) return;

  // 1. Loyalty purchase points (config-driven earn rules).
  await service
    .earnForOrder({ brand, contact_id, order_id, total_ngn })
    .catch(swallow("loyalty earn"));

  // 2. Streak Stars (money spent + first order).
  await service
    .awardStars({
      brand,
      contact_id,
      action_type: "money_spent",
      reference_type: "sales_order",
      reference_id: order_id,
      amount_ngn: total_ngn,
    })
    .catch(swallow("streak money_spent"));
  await service
    .awardStars({
      brand,
      contact_id,
      action_type: "first_order",
      reference_type: "sales_order",
      reference_id: order_id,
    })
    .catch(swallow("streak first_order"));

  // 3. Referral auto-redeem on full settlement, if the order used a code.
  if (referral_code) {
    await service
      .redeemReferral({
        brand,
        code: referral_code,
        referred_contact_id: contact_id,
        order_id,
        order_value: total_ngn,
      })
      .catch(swallow("referral redeem"));
  }

  // 4. Strategy engine triggers.
  const first = await isFirstOrder(brand, contact_id);
  const event = { order_id, total_ngn, order_total_ngn: total_ngn };
  await engine
    .trigger({ brand, trigger_type: "order_placed", contact_id, source_table: "sales_orders", source_id: order_id, event })
    .catch(swallow("strategy order_placed"));
  if (first) {
    await engine
      .trigger({ brand, trigger_type: "first_purchase", contact_id, source_table: "sales_orders", source_id: order_id, event })
      .catch(swallow("strategy first_purchase"));
  }
  await engine
    .trigger({ brand, trigger_type: "high_value_purchase", contact_id, source_table: "sales_orders", source_id: order_id, event })
    .catch(swallow("strategy high_value_purchase"));
}

let registered = false;

function register() {
  if (registered) return;
  registered = true;

  outbox.register("order.paid", "retention", awardLoyaltyAndStreak);

  // Bridge in-process domain events into the strategy engine (best-effort).
  events.on("loyalty.tier_changed", ({ brand, contact_id }) => {
    engine
      .trigger({ brand, trigger_type: "tier_upgrade", contact_id })
      .catch(swallow("strategy tier_upgrade"));
  });
  events.on("referral.redeemed", ({ brand, referrer_contact_id }) => {
    if (!referrer_contact_id) return;
    engine
      .trigger({ brand, trigger_type: "referral_completed", contact_id: referrer_contact_id })
      .catch(swallow("strategy referral_completed"));
  });
  events.on("quiz.completed", ({ brand, quiz_id, response_id }) => {
    engine
      .trigger({
        brand,
        trigger_type: "custom_event",
        source_table: "hair_quiz_responses",
        source_id: response_id,
        event: { quiz_id, custom_event: "quiz_completed" },
      })
      .catch(swallow("strategy quiz custom_event"));
  });

  logger.info(
    "retention subscribers registered (order.paid → loyalty + streak + referral + strategy spine)",
  );
}

register();

module.exports = { register, awardLoyaltyAndStreak, isFirstOrder };
