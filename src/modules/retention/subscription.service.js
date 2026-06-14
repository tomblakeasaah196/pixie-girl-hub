/**
 * Wig subscription service (F-1 / PD §6.23.5).
 *
 * Plan admin CRUD + subscriber lifecycle (enrol / pause / resume / cancel).
 * Recurring billing (Paystack charge_authorization → order) runs on a cron and
 * is the remaining F-1 step — it moves real money and must be validated against
 * staging before enablement, so it is intentionally not wired here yet.
 */

"use strict";

const repo = require("./subscription.repo");
const { query, transaction } = require("../../config/database");
const { audit } = require("../../middleware/audit");
const { money, toCurrencyString } = require("../../utils/money");
const { logger } = require("../../config/logger");
const { NotFoundError, AppError } = require("../../utils/errors");
const { BRANDS } = require("../../config/brands");

const CYCLE_INTERVAL = {
  monthly: "1 month",
  quarterly: "3 months",
  annually: "1 year",
};

async function nextBillingFromNow(cycle) {
  const interval = CYCLE_INTERVAL[cycle];
  if (!interval)
    throw new AppError("BAD_CYCLE", `Unknown billing cycle: ${cycle}`, 400);
  const { rows } = await query(`SELECT (now() + $1::interval) AS next`, [
    interval,
  ]);
  return rows[0].next;
}

// ── Plans ─────────────────────────────────────────────────
async function createPlan({ brand, user, request_id, input }) {
  const plan = await transaction((client) =>
    repo.createPlan({ client, brand, input }),
  );
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.subscription_plan.create",
    target_type: "subscription_plan",
    target_id: plan.plan_id,
    after: { plan_key: plan.plan_key },
    request_id,
  });
  return plan;
}

const listPlans = ({ brand, only_active }) =>
  repo.listPlans({ brand, only_active });

async function getPlan({ brand, id }) {
  const p = await repo.getPlan({ brand, id });
  if (!p) throw new NotFoundError("Subscription plan");
  return p;
}

async function updatePlan({ brand, user, request_id, id, patch }) {
  const p = await repo.updatePlan({ brand, id, patch });
  if (!p) throw new NotFoundError("Subscription plan");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.subscription_plan.update",
    target_type: "subscription_plan",
    target_id: id,
    after: patch,
    request_id,
  });
  return p;
}

async function setPlanActive({ brand, user, request_id, id, is_active }) {
  const p = await repo.setPlanActive({ brand, id, is_active });
  if (!p) throw new NotFoundError("Subscription plan");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: is_active
      ? "retention.subscription_plan.activate"
      : "retention.subscription_plan.deactivate",
    target_type: "subscription_plan",
    target_id: id,
    request_id,
  });
  return p;
}

// ── Subscriptions ─────────────────────────────────────────
async function enrol({ brand, user, request_id, input }) {
  const plan = await repo.getPlan({ brand, id: input.plan_id });
  if (!plan) throw new NotFoundError("Subscription plan");
  if (!plan.is_active)
    throw new AppError("PLAN_INACTIVE", "Plan is not active", 409);

  const next_billing_at = await nextBillingFromNow(plan.billing_cycle);
  const sub = await transaction((client) =>
    repo.createSubscription({
      client,
      brand,
      sub: {
        contact_id: input.contact_id,
        plan_id: input.plan_id,
        paystack_authorization_code: input.paystack_authorization_code,
        paystack_customer_code: input.paystack_customer_code,
        next_billing_at,
        preferences: input.preferences,
        default_delivery_address_id: input.default_delivery_address_id,
        maintenance_addon: input.maintenance_addon === true,
      },
    }),
  );
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.subscription.enrol",
    target_type: "subscription",
    target_id: sub.subscription_id,
    after: { plan_id: input.plan_id, contact_id: input.contact_id },
    request_id,
  });
  return repo.getSubscription({ brand, id: sub.subscription_id });
}

const listSubscriptions = ({ brand, contact_id, status }) =>
  repo.listSubscriptions({ brand, contact_id, status });

async function getSubscription({ brand, id }) {
  const s = await repo.getSubscription({ brand, id });
  if (!s) throw new NotFoundError("Subscription");
  return s;
}

async function pause({ brand, user, request_id, id, reason }) {
  const current = await repo.getSubscription({ brand, id });
  if (!current) throw new NotFoundError("Subscription");
  if (current.status !== "active")
    throw new AppError(
      "INVALID_STATE",
      `Cannot pause a ${current.status} subscription`,
      409,
    );
  const s = await repo.setStatus({
    brand,
    id,
    status: "paused",
    fields: {
      paused_at: new Date().toISOString(),
      pause_reason: reason || null,
    },
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.subscription.pause",
    target_type: "subscription",
    target_id: id,
    request_id,
  });
  return s;
}

async function resume({ brand, user, request_id, id }) {
  const current = await repo.getSubscription({ brand, id });
  if (!current) throw new NotFoundError("Subscription");
  if (current.status !== "paused")
    throw new AppError(
      "INVALID_STATE",
      `Cannot resume a ${current.status} subscription`,
      409,
    );
  // Push the next billing date out so a paused member isn't charged for the gap.
  const next_billing_at = await nextBillingFromNow(current.billing_cycle);
  const s = await repo.setStatus({
    brand,
    id,
    status: "active",
    fields: { resumed_at: new Date().toISOString(), next_billing_at },
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.subscription.resume",
    target_type: "subscription",
    target_id: id,
    request_id,
  });
  return s;
}

async function cancel({ brand, user, request_id, id, reason }) {
  const current = await repo.getSubscription({ brand, id });
  if (!current) throw new NotFoundError("Subscription");
  if (current.status === "cancelled") return current;
  const s = await repo.setStatus({
    brand,
    id,
    status: "cancelled",
    fields: {
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason || null,
    },
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.subscription.cancel",
    target_type: "subscription",
    target_id: id,
    request_id,
  });
  return s;
}

// ── Recurring billing (W-C / §6.23.5) ─────────────────────
const FAIL_LIMIT = 3;

/**
 * Charge every due active subscription off-session and resolve the revenue in
 * Sales. Idempotent per cycle (reference + order idempotency key are keyed on
 * next_billing_at, so a retry never double-charges). Money-moving — validate on
 * staging before enabling the cron.
 */
async function runDueBilling({ limit = 50 } = {}) {
  const paystack = require("../../services/paystack.service");
  const salesService = require("../sales/sales.service");
  let charged = 0;
  for (const brand of BRANDS) {
    let due = [];
    try {
      due = await transaction((client) =>
        repo.claimDueForBilling({ client, brand, limit }),
      );
    } catch (err) {
      logger.error(
        { err: err.message, brand },
        "subscription billing claim failed",
      );
      continue;
    }
    for (const sub of due) {
      const setPastDue = sub.failed_attempts_in_row + 1 >= FAIL_LIMIT;
      try {
        const plan = await repo.getPlan({ brand, id: sub.plan_id });
        if (!plan) continue;
        // Wig-maintenance add-on (§6.23.5): bill it on top for opted-in subs.
        let amount = money(plan.price_ngn);
        if (sub.maintenance_addon && money(plan.maintenance_fee_ngn || 0).gt(0)) {
          amount = amount.plus(money(plan.maintenance_fee_ngn));
        }
        const amountStr = toCurrencyString(amount);
        const cycleKey = new Date(sub.next_billing_at).getTime();
        const reference = `sub_${sub.subscription_id}_${cycleKey}`;

        if (!sub.paystack_authorization_code) {
          await repo.insertBillingAttempt({
            attempt: {
              subscription_id: sub.subscription_id,
              amount_ngn: amountStr,
              status: "failed_authorization_expired",
              failure_message: "no saved authorization",
            },
          });
          await repo.recordBillingFailure({
            id: sub.subscription_id,
            set_past_due: setPastDue,
          });
          continue;
        }

        const { rows } = await query(
          `SELECT email FROM shared.contacts WHERE contact_id = $1`,
          [sub.contact_id],
        );
        const email = rows[0] ? rows[0].email : null;
        const res = await paystack.chargeAuthorization({
          authorization_code: sub.paystack_authorization_code,
          email,
          amount_kobo: Number(amount.times(100).toFixed(0)),
          reference,
          metadata: { brand, subscription_id: sub.subscription_id },
        });
        const ok = res && res.data && res.data.status === "success";

        if (ok) {
          const order = await salesService.recordSubscriptionCharge({
            brand,
            contact_id: sub.contact_id,
            amount_ngn: amountStr,
            provider_reference: res.data.reference || reference,
            client_idempotency_key: `sub:${reference}`,
          });
          await repo.insertBillingAttempt({
            attempt: {
              subscription_id: sub.subscription_id,
              amount_ngn: amountStr,
              paystack_reference: res.data.reference || reference,
              status: "success",
              created_order_id: order.order_id,
            },
          });
          await repo.advanceAfterSuccess({
            id: sub.subscription_id,
            interval: CYCLE_INTERVAL[plan.billing_cycle],
            amount_ngn: amountStr,
          });
          charged += 1;
        } else {
          await repo.insertBillingAttempt({
            attempt: {
              subscription_id: sub.subscription_id,
              amount_ngn: amountStr,
              paystack_reference: reference,
              status: "failed_card_declined",
              failure_message: (res && res.message) || "charge failed",
            },
          });
          await repo.recordBillingFailure({
            id: sub.subscription_id,
            set_past_due: setPastDue,
          });
        }
      } catch (err) {
        logger.error(
          { err: err.message, subscription_id: sub.subscription_id },
          "subscription billing failed",
        );
        await repo
          .recordBillingFailure({
            id: sub.subscription_id,
            set_past_due: setPastDue,
          })
          .catch(() => {});
      }
    }
  }
  logger.info({ charged }, "subscription billing run done");
  return { charged };
}

module.exports = {
  createPlan,
  listPlans,
  getPlan,
  updatePlan,
  setPlanActive,
  enrol,
  runDueBilling,
  listSubscriptions,
  getSubscription,
  pause,
  resume,
  cancel,
};
