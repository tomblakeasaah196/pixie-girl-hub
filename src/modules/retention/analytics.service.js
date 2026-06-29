/**
 * Retention analytics service (Module 6.23.7). Assembles the dashboard from
 * analytics.repo. Repeat-rate, points economy, coupon ROI, referral
 * performance and subscription MRR are computed directly; CLV and churn are
 * transparent *estimates* (clearly labelled) derived from order behaviour, not
 * a predictive model.
 */

"use strict";

const repo = require("./analytics.repo");

function pct(n, d) {
  if (!d) return 0;
  return Math.round((n / d) * 1000) / 10; // 1dp
}

async function overview({ brand, windowDays = 90 }) {
  const [points, tiers, orders, coupon, referral, subs] = await Promise.all([
    repo.pointsEconomy({ brand }),
    repo.tierDistribution({ brand }),
    repo.orderMetrics({ brand, windowDays }),
    repo.couponRoi({ brand }),
    repo.referralPerformance({ brand }),
    repo.subscriptionMrr({ brand }),
  ]);

  const totalOrders = Number(orders.total_orders || 0);
  const totalRevenue = Number(orders.total_revenue || 0);
  const totalCustomers = Number(orders.total_customers || 0);
  const repeatCustomers = Number(orders.repeat_customers || 0);
  const lapsed = Number(orders.lapsed_window || 0);

  const avgOrderValue = totalOrders ? Math.round(totalRevenue / totalOrders) : 0;
  const avgOrdersPerCustomer = totalCustomers
    ? Math.round((totalOrders / totalCustomers) * 100) / 100
    : 0;

  return {
    window_days: windowDays,
    points_economy: {
      earned: Number(points.earned || 0),
      spent: Number(points.spent || 0),
      outstanding_liability: Number(points.outstanding || 0),
    },
    tier_distribution: tiers,
    repeat_purchase: {
      total_customers: totalCustomers,
      repeat_customers: repeatCustomers,
      repeat_rate_pct: pct(repeatCustomers, totalCustomers),
    },
    revenue: { total_ngn: totalRevenue, total_orders: totalOrders, avg_order_value_ngn: avgOrderValue },
    coupon_roi: {
      redemptions: Number(coupon.redemptions || 0),
      total_discount_ngn: Number(coupon.total_discount || 0),
    },
    referral_performance: referral,
    subscriptions: {
      active: Number(subs.active_subscriptions || 0),
      mrr_ngn: Math.round(Number(subs.mrr_ngn || 0)),
    },
    // Transparent estimates (not a predictive model).
    estimates: {
      clv_ngn: Math.round(avgOrderValue * avgOrdersPerCustomer),
      avg_orders_per_customer: avgOrdersPerCustomer,
      churn_rate_pct: pct(lapsed, totalCustomers),
      churn_basis: `no order in ${windowDays} days`,
    },
  };
}

module.exports = { overview };
