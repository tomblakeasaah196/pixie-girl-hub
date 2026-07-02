/**
 * Retention analytics repository (Module 6.23.7). Parameterised, read-only
 * aggregates over the shared loyalty/referral/coupon/subscription tables and
 * the brand sales_orders. CLV + churn are transparent simple estimates (see
 * analytics.service), not a predictive model.
 */

"use strict";

const { query } = require("../../config/database");
const { t: tbl } = require("../../config/brands");
const COUNTED = `('pending_payment','paid','awaiting_dispatch','in_production','with_stylist',
  'ready_for_dispatch','dispatched','in_transit','out_for_delivery','delivered','completed')`;

async function pointsEconomy({ brand }) {
  const { rows } = await query(
    `SELECT
        COALESCE(SUM(points) FILTER (WHERE points > 0), 0)::bigint AS earned,
        COALESCE(-SUM(points) FILTER (WHERE points < 0), 0)::bigint AS spent,
        COALESCE(SUM(points), 0)::bigint AS outstanding
       FROM shared.loyalty_ledger WHERE business = $1`,
    [brand],
  );
  return rows[0];
}

async function tierDistribution({ brand }) {
  const { rows } = await query(
    `SELECT COALESCE(ti.tier_name, 'No tier') AS tier, count(*)::int AS customers
       FROM shared.customer_loyalty_state s
       LEFT JOIN shared.loyalty_tiers ti ON ti.tier_id = s.current_tier_id
      WHERE s.business = $1
      GROUP BY COALESCE(ti.tier_name, 'No tier')
      ORDER BY customers DESC`,
    [brand],
  );
  return rows;
}

/** Order-based metrics within a rolling window (days). */
async function orderMetrics({ brand, windowDays = 90 }) {
  const { rows } = await query(
    `WITH counted AS (
        SELECT contact_id, total_ngn, placed_at
          FROM ${tbl(brand, "sales_orders")}
         WHERE placed_at IS NOT NULL AND status IN ${COUNTED}
     ),
     per_customer AS (
        SELECT contact_id,
               count(*) AS orders,
               SUM(total_ngn) AS spend,
               MAX(placed_at) AS last_order
          FROM counted GROUP BY contact_id
     )
     SELECT
        (SELECT count(*) FROM counted) AS total_orders,
        (SELECT COALESCE(SUM(total_ngn),0) FROM counted) AS total_revenue,
        (SELECT count(*) FROM per_customer) AS total_customers,
        (SELECT count(*) FROM per_customer WHERE orders >= 2) AS repeat_customers,
        (SELECT count(*) FROM per_customer
          WHERE last_order >= now() - ($1 || ' days')::interval) AS active_window,
        (SELECT count(*) FROM per_customer
          WHERE last_order < now() - ($1 || ' days')::interval) AS lapsed_window`,
    [String(windowDays)],
  );
  return rows[0];
}

async function couponRoi({ brand }) {
  const { rows } = await query(
    `SELECT count(*)::int AS redemptions,
            COALESCE(SUM(discount_applied),0)::numeric AS total_discount
       FROM shared.coupon_redemptions WHERE business = $1`,
    [brand],
  );
  return rows[0];
}

async function referralPerformance({ brand }) {
  const { rows } = await query(
    `SELECT
        (SELECT count(*)::int FROM shared.referrals WHERE business = $1) AS referrers,
        (SELECT COALESCE(SUM(successful_count),0)::int FROM shared.referrals WHERE business = $1) AS conversions,
        (SELECT count(*)::int FROM shared.referral_redemptions WHERE business = $1 AND status = 'rewarded') AS rewarded`,
    [brand],
  );
  return rows[0];
}

/** Active subscription MRR, normalising each plan price to a monthly figure. */
async function subscriptionMrr({ brand }) {
  const { rows } = await query(
    `SELECT
        count(*)::int AS active_subscriptions,
        COALESCE(SUM(
          CASE p.billing_cycle
            WHEN 'monthly' THEN p.price_ngn
            WHEN 'quarterly' THEN p.price_ngn / 3.0
            WHEN 'annually' THEN p.price_ngn / 12.0
            ELSE p.price_ngn END
        ), 0)::numeric AS mrr_ngn
       FROM shared.subscriptions s
       JOIN shared.subscription_plans p ON p.plan_id = s.plan_id
      WHERE s.business = $1 AND s.status = 'active'`,
    [brand],
  );
  return rows[0];
}

module.exports = {
  pointsEconomy,
  tierDistribution,
  orderMetrics,
  couponRoi,
  referralPerformance,
  subscriptionMrr,
};
