/**
 * Dashboards (V2.2 §6.20) — drill-down detail tables.
 *
 * Each dashboard chart/KPI drills into one of these paginated row sets (the
 * in-dashboard detail table, also the row source for the Excel export's data
 * sheets). Read-only, parameterised, filtered to the same period the tile
 * showed. Every function returns { rows, total } — rows are display-ready
 * (labels joined in, money as strings).
 *
 * The registry (dashboards.domains.js `details`) whitelists which keys exist
 * per domain; the service maps key → function here. Adding a detail table =
 * add the SQL here + the registry entry.
 */

"use strict";

const { query } = require("../../config/database");
const { t } = require("../../config/brands");
const metrics = require("./dashboards.metrics.repo");

const ACTIVE_DELIVERY_STATES = `('queued','booked','picked_up','in_transit','arrived_destination_city','out_for_delivery')`;

async function paged(sqlRows, sqlCount, params, { limit, offset, countParams }) {
  const { rows: c } = await query(sqlCount, countParams || params);
  const { rows } = await query(`${sqlRows} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [
    ...params,
    limit,
    offset,
  ]);
  return { rows, total: c[0].total };
}

// ── Sales ──────────────────────────────────────────────────

async function orders({ brand, from, to, filters = {}, limit, offset }) {
  const where = [`COALESCE(o.placed_at, o.created_at) BETWEEN $1 AND $2`];
  const params = [from, to];
  if (filters.status) {
    params.push(filters.status);
    where.push(`o.status = $${params.length}`);
  }
  if (filters.sales_channel) {
    params.push(filters.sales_channel);
    where.push(`o.sales_channel = $${params.length}`);
  }
  const w = `WHERE ${where.join(" AND ")}`;
  return paged(
    `SELECT o.order_number, COALESCE(o.placed_at, o.created_at) AS placed_at,
            c.display_name AS customer, o.sales_channel, o.status,
            o.total_ngn::text AS total_ngn, o.amount_paid_ngn::text AS amount_paid_ngn,
            o.balance_due_ngn::text AS balance_due_ngn
       FROM ${t(brand, "sales_orders")} o
       LEFT JOIN shared.contacts c ON c.contact_id = o.contact_id
      ${w} ORDER BY COALESCE(o.placed_at, o.created_at) DESC`,
    `SELECT count(*)::int AS total FROM ${t(brand, "sales_orders")} o ${w}`,
    params,
    { limit, offset },
  );
}

async function payments({ brand, from, to, limit, offset }) {
  const w = `WHERE p.captured_at BETWEEN $1 AND $2`;
  return paged(
    `SELECT p.payment_number, p.captured_at, o.order_number,
            p.method, p.provider, p.status,
            p.amount_ngn::text AS amount_ngn, p.fee_ngn::text AS fee_ngn,
            p.net_received_ngn::text AS net_received_ngn
       FROM ${t(brand, "sales_order_payments")} p
       LEFT JOIN ${t(brand, "sales_orders")} o ON o.order_id = p.order_id
      ${w} ORDER BY p.captured_at DESC`,
    `SELECT count(*)::int AS total FROM ${t(brand, "sales_order_payments")} p ${w}`,
    [from, to],
    { limit, offset },
  );
}

// ── Customers ──────────────────────────────────────────────

async function topCustomersDetail({ brand, from, to, limit, offset }) {
  const { rows, total } = await metrics.topCustomers({
    brand,
    from,
    to,
    limit,
    offset,
    withTotal: true,
  });
  return { rows, total };
}

async function deals({ brand, limit, offset }) {
  const w = `WHERE d.status = 'open' AND d.is_deleted = false`;
  return paged(
    `SELECT d.deal_number, d.title, c.display_name AS contact,
            s.display_name AS stage, d.expected_value_ngn::text AS expected_value_ngn,
            d.expected_close_date, d.last_activity_at
       FROM ${t(brand, "crm_deals")} d
       LEFT JOIN shared.contacts c ON c.contact_id = d.contact_id
       LEFT JOIN ${t(brand, "crm_pipeline_stages")} s ON s.stage_id = d.current_stage_id
      ${w} ORDER BY d.expected_value_ngn DESC NULLS LAST`,
    `SELECT count(*)::int AS total FROM ${t(brand, "crm_deals")} d ${w}`,
    [],
    { limit, offset },
  );
}

async function atRisk({ brand, limit, offset }) {
  const w = `WHERE r.superseded_at IS NULL AND r.recovered_at IS NULL
        AND r.risk_band IN ('high','critical')`;
  return paged(
    `SELECT c.display_name AS customer, r.risk_band, r.risk_score,
            r.days_since_last_order, r.total_orders,
            r.lifetime_value_ngn::text AS lifetime_value_ngn, r.computed_at
       FROM ${t(brand, "churn_risk_scores")} r
       JOIN shared.contacts c ON c.contact_id = r.contact_id
      ${w} ORDER BY r.risk_score DESC`,
    `SELECT count(*)::int AS total FROM ${t(brand, "churn_risk_scores")} r ${w}`,
    [],
    { limit, offset },
  );
}

// ── Finance ────────────────────────────────────────────────

async function receivables({ brand, limit, offset }) {
  const w = `WHERE i.status NOT IN ('paid','void','refunded') AND i.balance_due_ngn > 0`;
  return paged(
    `SELECT i.invoice_number, c.display_name AS customer, i.status,
            i.issue_date, i.due_date,
            GREATEST(CURRENT_DATE - i.due_date, 0)::int AS days_overdue,
            i.total_ngn::text AS total_ngn, i.balance_due_ngn::text AS balance_due_ngn
       FROM ${t(brand, "invoices")} i
       LEFT JOIN shared.contacts c ON c.contact_id = i.contact_id
      ${w} ORDER BY i.due_date ASC NULLS LAST`,
    `SELECT count(*)::int AS total FROM ${t(brand, "invoices")} i ${w}`,
    [],
    { limit, offset },
  );
}

async function expensesDetail({ brand, from, to, limit, offset }) {
  const w = `WHERE e.expense_date BETWEEN $1::timestamptz::date AND $2::timestamptz::date`;
  return paged(
    `SELECT e.expense_number, e.title, e.expense_date, e.expense_type,
            e.status, e.total_amount_ngn::text AS total_amount_ngn
       FROM ${t(brand, "expenses")} e
      ${w} ORDER BY e.expense_date DESC`,
    `SELECT count(*)::int AS total FROM ${t(brand, "expenses")} e ${w}`,
    [from, to],
    { limit, offset },
  );
}

// ── Stock ──────────────────────────────────────────────────

async function lowStock({ brand, limit, offset }) {
  const w = `WHERE a.status = 'open'`;
  return paged(
    `SELECT p.name AS product, v.variant_name, v.sku, l.display_name AS location,
            sl.on_hand, sl.available, a.reorder_point, a.daily_velocity,
            a.projected_days_left, a.severity, a.detected_at
       FROM ${t(brand, "stock_alerts")} a
       JOIN ${t(brand, "product_variants")} v ON v.variant_id = a.variant_id
       JOIN ${t(brand, "products")} p ON p.product_id = v.product_id
       LEFT JOIN ${t(brand, "stock_locations")} l ON l.location_id = a.location_id
       LEFT JOIN ${t(brand, "stock_levels")} sl
         ON sl.variant_id = a.variant_id AND sl.location_id = a.location_id
      ${w} ORDER BY a.severity DESC, a.projected_days_left ASC NULLS LAST`,
    `SELECT count(*)::int AS total FROM ${t(brand, "stock_alerts")} a ${w}`,
    [],
    { limit, offset },
  );
}

async function movements({ brand, from, to, limit, offset }) {
  const w = `WHERE m.performed_at BETWEEN $1 AND $2`;
  return paged(
    `SELECT m.movement_number, m.performed_at, p.name AS product, v.sku,
            m.movement_type, m.sales_channel, m.quantity,
            l.display_name AS location
       FROM ${t(brand, "stock_movements")} m
       JOIN ${t(brand, "product_variants")} v ON v.variant_id = m.variant_id
       JOIN ${t(brand, "products")} p ON p.product_id = v.product_id
       LEFT JOIN ${t(brand, "stock_locations")} l ON l.location_id = m.location_id
      ${w} ORDER BY m.performed_at DESC`,
    `SELECT count(*)::int AS total FROM ${t(brand, "stock_movements")} m ${w}`,
    [from, to],
    { limit, offset },
  );
}

// ── Logistics ──────────────────────────────────────────────

async function deliveries({ brand, from, to, filters = {}, limit, offset }) {
  const where = [
    `(COALESCE(d.booked_at, d.created_at) BETWEEN $1 AND $2
      OR d.status IN ${ACTIVE_DELIVERY_STATES})`,
  ];
  const params = [from, to];
  if (filters.status) {
    params.push(filters.status);
    where.push(`d.status = $${params.length}`);
  }
  const w = `WHERE ${where.join(" AND ")}`;
  return paged(
    `SELECT d.delivery_number, d.recipient_name_snapshot AS recipient,
            c.display_name AS courier, d.status, d.booked_at,
            d.expected_delivery_at, d.delivered_at, d.attempt_count,
            d.courier_fee_ngn::text AS courier_fee_ngn
       FROM ${t(brand, "deliveries")} d
       LEFT JOIN ${t(brand, "couriers")} c ON c.courier_id = d.courier_id
      ${w} ORDER BY COALESCE(d.booked_at, d.created_at) DESC`,
    `SELECT count(*)::int AS total FROM ${t(brand, "deliveries")} d ${w}`,
    params,
    { limit, offset },
  );
}

// ── Marketing ──────────────────────────────────────────────

async function emailCampaigns({ brand, from, to, limit, offset }) {
  const w = `WHERE ec.send_started_at BETWEEN $1 AND $2`;
  return paged(
    `SELECT ec.campaign_name, ec.campaign_type, ec.status, ec.send_started_at,
            ec.total_sent, ec.total_delivered, ec.total_opened, ec.total_clicked,
            ec.open_rate_pct, ec.click_rate_pct,
            ec.conversion_revenue_ngn::text AS conversion_revenue_ngn
       FROM ${t(brand, "email_campaigns")} ec
      ${w} ORDER BY ec.send_started_at DESC`,
    `SELECT count(*)::int AS total FROM ${t(brand, "email_campaigns")} ec ${w}`,
    [from, to],
    { limit, offset },
  );
}

async function adCampaigns({ brand, from, to, limit, offset }) {
  const w = `WHERE c.business = $1`;
  return paged(
    `SELECT c.name, c.platform, c.objective, c.status,
            COALESCE(SUM(s.spend_ngn) FILTER (
              WHERE s.metric_date BETWEEN $2::timestamptz::date AND $3::timestamptz::date),0)::text AS spend_ngn,
            COALESCE(SUM(s.clicks) FILTER (
              WHERE s.metric_date BETWEEN $2::timestamptz::date AND $3::timestamptz::date),0)::int AS clicks,
            COALESCE(SUM(s.conversions) FILTER (
              WHERE s.metric_date BETWEEN $2::timestamptz::date AND $3::timestamptz::date),0)::int AS conversions,
            COALESCE(SUM(s.conversion_value_ngn) FILTER (
              WHERE s.metric_date BETWEEN $2::timestamptz::date AND $3::timestamptz::date),0)::text AS conversion_value_ngn
       FROM shared.ad_campaigns c
       LEFT JOIN shared.ad_spend_daily s ON s.ad_campaign_id = c.ad_campaign_id
      ${w} GROUP BY c.ad_campaign_id, c.name, c.platform, c.objective, c.status
      ORDER BY COALESCE(SUM(s.spend_ngn) FILTER (
        WHERE s.metric_date BETWEEN $2::timestamptz::date AND $3::timestamptz::date),0) DESC`,
    `SELECT count(*)::int AS total FROM shared.ad_campaigns c ${w}`,
    [brand, from, to],
    { limit, offset, countParams: [brand] },
  );
}

// ── E-Commerce ─────────────────────────────────────────────

async function storefrontOrders({ brand, from, to, limit, offset }) {
  const w = `WHERE o.sales_channel = 'storefront'
        AND COALESCE(o.placed_at, o.created_at) BETWEEN $1 AND $2`;
  return paged(
    `SELECT o.order_number, COALESCE(o.placed_at, o.created_at) AS placed_at,
            c.display_name AS customer, o.status,
            o.display_currency, o.display_total::text AS display_total,
            o.total_ngn::text AS total_ngn, o.utm_source
       FROM ${t(brand, "sales_orders")} o
       LEFT JOIN shared.contacts c ON c.contact_id = o.contact_id
      ${w} ORDER BY COALESCE(o.placed_at, o.created_at) DESC`,
    `SELECT count(*)::int AS total FROM ${t(brand, "sales_orders")} o ${w}`,
    [from, to],
    { limit, offset },
  );
}

async function sessions({ brand, from, to, limit, offset }) {
  const w = `WHERE s.started_at BETWEEN $1 AND $2`;
  return paged(
    `SELECT s.started_at, s.utm_source, s.utm_campaign, s.referrer,
            s.device_type, s.region, s.detected_currency, s.page_count,
            s.duration_seconds,
            (s.converted_order_id IS NOT NULL) AS converted,
            s.conversion_value_ngn::text AS conversion_value_ngn
       FROM ${t(brand, "storefront_sessions")} s
      ${w} ORDER BY s.started_at DESC`,
    `SELECT count(*)::int AS total FROM ${t(brand, "storefront_sessions")} s ${w}`,
    [from, to],
    { limit, offset },
  );
}

// ── Retention ──────────────────────────────────────────────

async function referralRedemptions({ brand, from, to, limit, offset }) {
  const w = `WHERE rr.business = $1 AND rr.created_at BETWEEN $2 AND $3`;
  return paged(
    `SELECT rr.created_at, referrer.display_name AS referrer,
            referred.display_name AS referred, rr.status,
            rr.triggering_order_value::text AS order_value_ngn,
            rr.referrer_reward_points, rr.fraud_check_result
       FROM shared.referral_redemptions rr
       JOIN shared.referrals r ON r.referral_id = rr.referral_id
       LEFT JOIN shared.contacts referrer ON referrer.contact_id = r.contact_id
       LEFT JOIN shared.contacts referred ON referred.contact_id = rr.referred_contact_id
      ${w} ORDER BY rr.created_at DESC`,
    `SELECT count(*)::int AS total FROM shared.referral_redemptions rr ${w}`,
    [brand, from, to],
    { limit, offset },
  );
}

async function couponRedemptions({ brand, from, to, limit, offset }) {
  const w = `WHERE r.business = $1 AND r.redeemed_at BETWEEN $2 AND $3`;
  return paged(
    `SELECT r.redeemed_at, co.coupon_code, c.display_name AS customer,
            r.discount_applied::text AS discount_applied_ngn, r.reference_type
       FROM shared.coupon_redemptions r
       JOIN shared.coupons co ON co.coupon_id = r.coupon_id
       LEFT JOIN shared.contacts c ON c.contact_id = r.contact_id
      ${w} ORDER BY r.redeemed_at DESC`,
    `SELECT count(*)::int AS total FROM shared.coupon_redemptions r ${w}`,
    [brand, from, to],
    { limit, offset },
  );
}

async function subscriptionsDetail({ brand, limit, offset }) {
  const w = `WHERE s.business = $1`;
  return paged(
    `SELECT c.display_name AS customer, p.display_name AS plan, s.status,
            s.started_at, s.next_billing_at, s.total_cycles_billed,
            s.total_amount_billed_ngn::text AS total_billed_ngn
       FROM shared.subscriptions s
       LEFT JOIN shared.subscription_plans p ON p.plan_id = s.plan_id
       LEFT JOIN shared.contacts c ON c.contact_id = s.contact_id
      ${w} ORDER BY s.started_at DESC`,
    `SELECT count(*)::int AS total FROM shared.subscriptions s ${w}`,
    [brand],
    { limit, offset },
  );
}

// ── HR ─────────────────────────────────────────────────────

async function leaveRequests({ brand, limit, offset }) {
  const w = `WHERE sp.business = $1 AND lr.status = 'pending'`;
  return paged(
    `SELECT c.display_name AS staff, sp.job_title, lr.leave_type,
            lr.start_date, lr.end_date, lr.days_requested, lr.status, lr.reason
       FROM shared.leave_requests lr
       JOIN shared.staff_profiles sp ON sp.profile_id = lr.profile_id
       LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
      ${w} ORDER BY lr.start_date ASC`,
    `SELECT count(*)::int AS total
       FROM shared.leave_requests lr
       JOIN shared.staff_profiles sp ON sp.profile_id = lr.profile_id ${w}`,
    [brand],
    { limit, offset },
  );
}

async function payrollRuns({ brand, limit, offset }) {
  return paged(
    `SELECT run_number, pay_year, pay_month, pay_date, status, total_staff,
            total_gross_ngn::text AS total_gross_ngn,
            total_commission_ngn::text AS total_commission_ngn,
            total_net_ngn::text AS total_net_ngn
       FROM ${t(brand, "payroll_runs")}
      ORDER BY pay_year DESC, pay_month DESC`,
    `SELECT count(*)::int AS total FROM ${t(brand, "payroll_runs")}`,
    [],
    { limit, offset },
  );
}

async function commissionsDetail({ brand, from, to, limit, offset }) {
  const w = `WHERE ce.earned_at BETWEEN $1 AND $2
        AND ce.status IN ('accrued','approved','paid')`;
  return paged(
    `SELECT ce.earning_number, c.display_name AS staff, ce.sale_channel,
            ce.status, ce.earned_at,
            ce.basis_amount_ngn::text AS basis_amount_ngn,
            ce.commission_amount_ngn::text AS commission_amount_ngn
       FROM ${t(brand, "commission_earned")} ce
       LEFT JOIN shared.users u ON u.user_id = ce.user_id
       LEFT JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
       LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
      ${w} ORDER BY ce.earned_at DESC`,
    `SELECT count(*)::int AS total FROM ${t(brand, "commission_earned")} ce ${w}`,
    [from, to],
    { limit, offset },
  );
}

/** Registry: domain key → detail key → query fn. Whitelist for the routes. */
const DETAILS = {
  sales: { orders, payments },
  customers: { top_customers: topCustomersDetail, deals, at_risk: atRisk },
  finance: { receivables, expenses: expensesDetail },
  stock: { low_stock: lowStock, movements },
  logistics: { deliveries },
  marketing: { email_campaigns: emailCampaigns, ad_campaigns: adCampaigns },
  ecommerce: { storefront_orders: storefrontOrders, sessions },
  retention: {
    referral_redemptions: referralRedemptions,
    coupon_redemptions: couponRedemptions,
    subscriptions: subscriptionsDetail,
  },
  hr: {
    leave_requests: leaveRequests,
    payroll_runs: payrollRuns,
    commissions: commissionsDetail,
  },
};

module.exports = { DETAILS };
