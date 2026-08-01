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
const crownService = require("./crown.service");
const engine = require("./strategy.engine");
const events = require("./retention.events");
const repo = require("./retention.repo");
const couponRepo = require("./coupon.repo");
const { query, transaction } = require("../../config/database");
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

/**
 * P1-3 settlement: on order.paid, actually SPEND the coupon (record the
 * redemption + bump usage_count) and DEBIT the redeemed points. Both used
 * to happen inside createOrderTx, which meant an abandoned checkout ate the
 * shopper's per-customer allowance / loyalty balance forever. Now the burn
 * only fires when the order is genuinely settled, and the cancellation
 * subscriber below reverses it for a paid-then-cancelled order.
 *
 * Idempotent — safe to fire twice (outbox at-least-once):
 *   coupon: redemptionExists() gate; usage only bumps on a fresh insert.
 *   points: ledgerEntryForReference() gate on (order, contact, redeemed).
 */
async function settleAfterPaid({ brand, order_id, contact_id }) {
  if (!VALID.has(brand)) return;
  const { rows } = await query(
    `SELECT so.coupon_code,
            coup.amount_ngn  AS coupon_amt,
            pts.source_reference AS pts_ref
       FROM ${brand}.sales_orders so
       LEFT JOIN ${brand}.sales_order_discounts coup
         ON coup.order_id = so.order_id AND coup.source = 'coupon'
       LEFT JOIN ${brand}.sales_order_discounts pts
         ON pts.order_id = so.order_id AND pts.source = 'loyalty_points'
      WHERE so.order_id = $1`,
    [order_id],
  );
  const row = rows[0];
  if (!row) return;

  // Coupon settlement — lock the coupon row while we bump.
  if (row.coupon_code && row.coupon_amt) {
    await transaction(async (client) => {
      const coupon = await couponRepo.lockByCode({
        client,
        brand,
        code: row.coupon_code,
      });
      if (!coupon) return;
      const already = await couponRepo.redemptionExists({
        client,
        coupon_id: coupon.coupon_id,
        reference_type: "sales_order",
        reference_id: order_id,
      });
      if (already) return;
      await couponRepo.recordRedemption({
        client,
        redemption: {
          coupon_id: coupon.coupon_id,
          contact_id: contact_id || null,
          business: brand,
          reference_type: "sales_order",
          reference_id: order_id,
          discount_applied: row.coupon_amt,
        },
      });
      await couponRepo.bumpUsage({
        client,
        coupon_id: coupon.coupon_id,
        discount_ngn: row.coupon_amt,
      });
    });
  }

  // Points redemption settlement — insert the negative ledger entry.
  if (contact_id && row.pts_ref) {
    const pts = parseInt(row.pts_ref, 10);
    if (Number.isFinite(pts) && pts > 0) {
      const existing = await repo.ledgerEntryForReference({
        brand,
        contact_id,
        reference_type: "sales_order",
        reference_id: order_id,
        transaction_type: "redeemed",
      });
      if (!existing) {
        await repo.insertLoyaltyLedger({
          brand,
          entry: {
            contact_id,
            transaction_type: "redeemed",
            points: -Math.abs(pts),
            reference_type: "sales_order",
            reference_id: order_id,
            notes: `Redeemed ${pts} pts (settled on payment)`,
          },
        });
      }
    }
  }
}

/**
 * P1-3 clawback: an order cancelled AFTER it was paid must give the
 * customer back what they spent — and take back the earned points, since
 * the underlying sale is void. Unpaid cancels are no-ops because nothing
 * was burned in the first place (settleAfterPaid never ran).
 */
async function reverseOnCancelled({ brand, order_id }) {
  if (!VALID.has(brand)) return;
  const { rows } = await query(
    `SELECT contact_id, paid_at FROM ${brand}.sales_orders WHERE order_id = $1`,
    [order_id],
  );
  const order = rows[0];
  if (!order || !order.paid_at) return; // never burned → nothing to reverse

  // 1) Reverse coupon redemptions attached to this order.
  const redemptions = await couponRepo.listRedemptionsForOrder({
    reference_type: "sales_order",
    reference_id: order_id,
  });
  for (const r of redemptions) {
    await transaction(async (client) => {
      await couponRepo.reverseUsage({
        client,
        coupon_id: r.coupon_id,
        discount_ngn: r.discount_applied,
      });
      await couponRepo.deleteRedemption({
        client,
        redemption_id: r.redemption_id,
      });
    });
  }

  // 2) Reverse points redemption (give the customer their points back).
  const redeemed = await repo.ledgerEntryForReference({
    brand,
    contact_id: order.contact_id,
    reference_type: "sales_order",
    reference_id: order_id,
    transaction_type: "redeemed",
  });
  if (redeemed) {
    const already = await repo.ledgerEntryForReference({
      brand,
      contact_id: order.contact_id,
      reference_type: "sales_order",
      reference_id: order_id,
      transaction_type: "reversal",
    });
    if (!already) {
      await repo.insertLoyaltyLedger({
        brand,
        entry: {
          contact_id: order.contact_id,
          transaction_type: "reversal",
          points: Math.abs(redeemed.points),
          reference_type: "sales_order",
          reference_id: order_id,
          notes: "Order cancelled — redeemed points refunded",
        },
      });
    }
  }

  // 3) Claw back earned purchase points (order didn't complete, so the
  //    accrual is void). Skip if already reversed (idempotency: we key the
  //    reversal on transaction_type='adjustment' so it doesn't collide with
  //    the redeemed reversal above).
  const earned = await repo.ledgerEntryForReference({
    brand,
    contact_id: order.contact_id,
    reference_type: "sales_order",
    reference_id: order_id,
    transaction_type: "earned_purchase",
  });
  if (earned && earned.points > 0) {
    const already = await repo.ledgerEntryForReference({
      brand,
      contact_id: order.contact_id,
      reference_type: "sales_order",
      reference_id: order_id,
      transaction_type: "adjustment",
    });
    if (!already) {
      await repo.insertLoyaltyLedger({
        brand,
        entry: {
          contact_id: order.contact_id,
          transaction_type: "adjustment",
          points: -Math.abs(earned.points),
          reference_type: "sales_order",
          reference_id: order_id,
          notes: "Order cancelled — earned points clawed back",
        },
      });
    }
  }
}

async function awardLoyaltyAndStreak(payload) {
  const { brand, order_id, contact_id, total_ngn, referral_code } = payload;
  if (!contact_id) return;

  // 1. Crowns 👑 — the unified economy (cutover: this REPLACES the legacy
  //    loyalty-points + Streak-Stars earners, which no longer run). Awards the
  //    flat "complete a purchase" + per-₦ "money spent" Crowns and advances the
  //    monthly-purchase streak. Idempotent per order. Both legacy ledgers were
  //    backfilled 1:1 into Crowns by migration 000362.
  await crownService
    .earnForOrder({ brand, contact_id, order_id, total_ngn })
    .catch(swallow("crown earn"));

  // 2. Referral auto-redeem on full settlement, if the order used a code.
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
  // P1-3: settle coupon usage + points redemption ONLY on real payment. A
  // separate outbox handler so a failure in settlement is retried
  // independently of the earn/streak path.
  outbox.register("order.paid", "retention-settle", (p) =>
    settleAfterPaid(p).catch(swallow("settle after paid")),
  );
  // P1-3: reverse settlement on cancellation. In-process event is
  // sufficient — the cancellation transaction already committed the
  // status change by the time the emit fires.
  events.on("order.cancelled", ({ brand, order_id }) => {
    reverseOnCancelled({ brand, order_id }).catch(
      swallow("reverse on cancelled"),
    );
  });

  // Bridge in-process domain events into the strategy engine (best-effort).
  events.on("loyalty.tier_changed", ({ brand, contact_id }) => {
    engine
      .trigger({ brand, trigger_type: "tier_upgrade", contact_id })
      .catch(swallow("strategy tier_upgrade"));
  });
  events.on(
    "referral.redeemed",
    ({ brand, referrer_contact_id, referred_contact_id }) => {
      if (!referrer_contact_id) return;
      // Cutover: the referrer's reward is Crowns 👑 (was legacy loyalty points,
      // now removed from redeemReferral). Keyed on the referred friend so each
      // distinct conversion earns once.
      crownService
        .awardForAction({
          brand,
          contact_id: referrer_contact_id,
          action_type: "refer_friend_purchase",
          reference_type: "referral",
          reference_id: referred_contact_id,
        })
        .catch(swallow("crown referral"));
      engine
        .trigger({ brand, trigger_type: "referral_completed", contact_id: referrer_contact_id })
        .catch(swallow("strategy referral_completed"));
    },
  );
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
    "retention subscribers registered (order.paid → Crowns + referral + strategy spine)",
  );
}

register();

module.exports = {
  register,
  awardLoyaltyAndStreak,
  settleAfterPaid,
  reverseOnCancelled,
  isFirstOrder,
};
