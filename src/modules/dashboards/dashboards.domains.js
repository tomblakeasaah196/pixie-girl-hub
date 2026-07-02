/**
 * Dashboards (V2.2 §6.20) — domain registry.
 *
 * The single source of truth for the dashboard's structure: which domains
 * (tabs) exist, which permission gates each one carries, and the manifest of
 * tiles (KPIs / charts / tables) each domain serves. The metrics service
 * composes data by these keys; the Excel exporter names its sheets from them;
 * the /domains endpoint hands the visible structure to the frontend. Tile
 * keys are a stable API contract — renaming one is a breaking change.
 *
 * Gates:
 *   gate: 'accounting' | 'hr_payroll'  — module.view required (CEO bypasses).
 *   requires: 'cost'                   — tile only for cost-visible roles
 *                                        (accounting.view; field privacy).
 *
 * Formats: 'money' (NGN string, 2dp) · 'int' · 'pct' (number, 1dp) ·
 *          'hours' (number, 1dp) · 'text'.
 */

"use strict";

const DOMAINS = [
  {
    key: "overview",
    label: "Overview",
    description: "Both lungs of the business at a glance",
    gate: null,
    kpis: [
      { key: "revenue", label: "Revenue", format: "money" },
      { key: "orders", label: "Orders", format: "int" },
      { key: "aov", label: "Avg Order Value", format: "money" },
      { key: "new_customers", label: "New Customers", format: "int" },
      { key: "cash_collected", label: "Cash Collected", format: "money" },
      { key: "pending_approvals", label: "Pending Approvals", format: "int" },
      { key: "low_stock_alerts", label: "Low-stock Alerts", format: "int" },
      { key: "active_deliveries", label: "Active Deliveries", format: "int" },
      { key: "overdue_invoices", label: "Overdue Invoices", format: "int" },
      { key: "open_service_jobs", label: "Open Service Jobs", format: "int" },
    ],
    charts: [
      { key: "revenue_trend", label: "Revenue Trend", type: "line" },
      { key: "orders_by_channel", label: "Orders by Channel", type: "donut" },
    ],
    tables: [
      {
        key: "pending_approvals",
        label: "Pending Approvals",
        detail_key: null,
      },
    ],
  },
  {
    key: "sales",
    label: "Sales",
    description: "Revenue by channel, top products, trends",
    gate: null,
    kpis: [
      { key: "revenue", label: "Revenue", format: "money" },
      { key: "orders", label: "Orders", format: "int" },
      { key: "aov", label: "Avg Order Value", format: "money" },
      { key: "discount_given", label: "Discounts Given", format: "money" },
      { key: "pending_payment", label: "Pending Payment", format: "int" },
      { key: "quotes_sent", label: "Quotes Sent", format: "int" },
      { key: "quote_conversion", label: "Quote Conversion", format: "pct" },
    ],
    charts: [
      { key: "revenue_trend", label: "Revenue Trend", type: "line" },
      { key: "channel_breakdown", label: "Revenue by Channel", type: "donut" },
      { key: "top_products", label: "Top Products", type: "bar" },
      { key: "payment_methods", label: "Payment Methods", type: "donut" },
    ],
    tables: [
      { key: "top_products", label: "Top Products", detail_key: "orders" },
    ],
    details: {
      orders: { label: "Orders" },
      payments: { label: "Payments" },
    },
  },
  {
    key: "customers",
    label: "Customers",
    description: "Pipeline health, acquisition, retention, churn risk",
    gate: null,
    kpis: [
      { key: "active_customers", label: "Buying Customers", format: "int" },
      { key: "new_customers", label: "New Customers", format: "int" },
      { key: "repeat_rate", label: "Repeat Rate", format: "pct" },
      { key: "open_deals", label: "Open Deals", format: "int" },
      { key: "pipeline_value", label: "Pipeline Value", format: "money" },
      { key: "at_risk", label: "At-risk Customers", format: "int" },
    ],
    charts: [
      { key: "new_customers_trend", label: "New Customers", type: "line" },
      { key: "pipeline_by_stage", label: "Pipeline by Stage", type: "funnel" },
      { key: "acquisition_by_source", label: "Acquisition", type: "donut" },
      { key: "churn_bands", label: "Churn Risk", type: "donut" },
    ],
    tables: [
      {
        key: "top_customers",
        label: "Top Customers",
        detail_key: "top_customers",
      },
    ],
    details: {
      top_customers: { label: "Top Customers" },
      deals: { label: "Open Deals" },
      at_risk: { label: "At-risk Customers" },
    },
  },
  {
    key: "finance",
    label: "Finance",
    description: "Income vs expenses, receivables, cash flow",
    gate: "accounting",
    kpis: [
      { key: "income", label: "Income", format: "money" },
      { key: "expenses", label: "Expenses", format: "money" },
      { key: "net", label: "Net", format: "money" },
      { key: "cash_collected", label: "Cash Collected", format: "money" },
      { key: "ar_outstanding", label: "Receivables", format: "money" },
      { key: "overdue_total", label: "Overdue", format: "money" },
      {
        key: "expenses_pending",
        label: "Expenses Awaiting Approval",
        format: "int",
      },
    ],
    charts: [
      {
        key: "income_vs_expenses",
        label: "Income vs Expenses",
        type: "bar_line",
      },
      { key: "ar_ageing", label: "Receivables Ageing", type: "bar" },
      {
        key: "expenses_by_category",
        label: "Expenses by Category",
        type: "donut",
      },
    ],
    tables: [
      {
        key: "overdue_invoices",
        label: "Overdue Invoices",
        detail_key: "receivables",
      },
    ],
    details: {
      receivables: { label: "Open Receivables" },
      expenses: { label: "Expenses" },
    },
  },
  {
    key: "stock",
    label: "Stock",
    description: "Value, low-stock alerts, sell-through per channel",
    gate: null,
    kpis: [
      { key: "skus_active", label: "Active SKUs", format: "int" },
      { key: "units_on_hand", label: "Units On Hand", format: "int" },
      {
        key: "value_at_cost",
        label: "Stock Value (Cost)",
        format: "money",
        requires: "cost",
      },
      { key: "value_at_retail", label: "Stock Value (Retail)", format: "money" },
      { key: "low_stock", label: "Low-stock Alerts", format: "int" },
      { key: "out_of_stock", label: "Out of Stock", format: "int" },
    ],
    charts: [
      { key: "movements_trend", label: "Units In vs Out", type: "bar_line" },
      {
        key: "sell_through_by_channel",
        label: "Sell-through by Channel",
        type: "donut",
      },
      { key: "top_moving", label: "Top Moving", type: "bar" },
    ],
    tables: [
      { key: "low_stock", label: "Low Stock", detail_key: "low_stock" },
    ],
    details: {
      low_stock: { label: "Low Stock" },
      movements: { label: "Stock Movements" },
    },
  },
  {
    key: "logistics",
    label: "Logistics",
    description: "Active deliveries, courier performance",
    gate: null,
    kpis: [
      { key: "active", label: "Active Deliveries", format: "int" },
      { key: "delivered", label: "Delivered", format: "int" },
      { key: "failed", label: "Failed Attempts", format: "int" },
      { key: "success_rate", label: "Success Rate", format: "pct" },
      { key: "avg_hours", label: "Avg Delivery Time", format: "hours" },
      { key: "fees", label: "Courier Fees", format: "money" },
      { key: "cod_pending", label: "COD Outstanding", format: "money" },
    ],
    charts: [
      { key: "deliveries_trend", label: "Booked vs Delivered", type: "line" },
      { key: "status_breakdown", label: "By Status", type: "donut" },
      {
        key: "courier_performance",
        label: "Courier Performance",
        type: "bar",
      },
    ],
    tables: [
      {
        key: "courier_scorecard",
        label: "Courier Scorecard",
        detail_key: "deliveries",
      },
    ],
    details: {
      deliveries: { label: "Deliveries" },
    },
  },
  {
    key: "marketing",
    label: "Marketing",
    description: "Organic reach, paid ads, attribution",
    gate: null,
    kpis: [
      { key: "emails_sent", label: "Emails Sent", format: "int" },
      { key: "open_rate", label: "Open Rate", format: "pct" },
      { key: "click_rate", label: "Click Rate", format: "pct" },
      { key: "email_revenue", label: "Email Revenue", format: "money" },
      { key: "ad_spend", label: "Ad Spend", format: "money" },
      { key: "roas", label: "ROAS", format: "pct" },
      { key: "posts_published", label: "Posts Published", format: "int" },
      { key: "social_engagement", label: "Engagement", format: "int" },
    ],
    charts: [
      { key: "email_funnel", label: "Email Funnel", type: "funnel" },
      { key: "ad_spend_trend", label: "Ad Spend vs Return", type: "bar_line" },
      {
        key: "engagement_by_platform",
        label: "Engagement by Platform",
        type: "bar",
      },
      {
        key: "campaign_performance",
        label: "Campaign Conversion",
        type: "bar",
      },
    ],
    tables: [
      {
        key: "campaigns",
        label: "Campaign Performance",
        detail_key: "email_campaigns",
      },
    ],
    details: {
      email_campaigns: { label: "Email Campaigns" },
      ad_campaigns: { label: "Ad Campaigns" },
    },
  },
  {
    key: "ecommerce",
    label: "E-Commerce",
    description: "Storefront visitors, conversion, currency breakdown",
    gate: null,
    kpis: [
      { key: "sessions", label: "Sessions", format: "int" },
      { key: "visitors", label: "Unique Visitors", format: "int" },
      { key: "conversion_rate", label: "Conversion Rate", format: "pct" },
      { key: "storefront_revenue", label: "Storefront Revenue", format: "money" },
      { key: "storefront_orders", label: "Storefront Orders", format: "int" },
      { key: "aov", label: "Avg Order Value", format: "money" },
    ],
    charts: [
      { key: "sessions_trend", label: "Sessions & Orders", type: "line" },
      { key: "checkout_funnel", label: "Checkout Funnel", type: "funnel" },
      {
        key: "currency_breakdown",
        label: "Orders by Currency",
        type: "donut",
      },
      { key: "device_breakdown", label: "Devices", type: "donut" },
      { key: "top_sources", label: "Top Sources", type: "bar" },
    ],
    tables: [
      {
        key: "top_sources",
        label: "Traffic Sources",
        detail_key: "sessions",
      },
    ],
    details: {
      storefront_orders: { label: "Storefront Orders" },
      sessions: { label: "Recent Sessions" },
    },
  },
  {
    key: "retention",
    label: "Retention",
    description: "Loyalty, referrals, subscriptions",
    gate: null,
    kpis: [
      { key: "points_issued", label: "Points Issued", format: "int" },
      { key: "points_redeemed", label: "Points Redeemed", format: "int" },
      { key: "loyalty_members", label: "Loyalty Members", format: "int" },
      {
        key: "referral_conversions",
        label: "Referral Conversions",
        format: "int",
      },
      { key: "referral_revenue", label: "Referral Revenue", format: "money" },
      {
        key: "active_subscriptions",
        label: "Active Subscriptions",
        format: "int",
      },
      {
        key: "subscription_revenue",
        label: "Subscription Revenue",
        format: "money",
      },
      { key: "coupons_redeemed", label: "Coupons Redeemed", format: "int" },
    ],
    charts: [
      {
        key: "points_trend",
        label: "Points Earned vs Redeemed",
        type: "bar_line",
      },
      { key: "tier_distribution", label: "Loyalty Tiers", type: "donut" },
      { key: "top_coupons", label: "Top Coupons", type: "bar" },
    ],
    tables: [
      {
        key: "top_referrers",
        label: "Top Referrers",
        detail_key: "referral_redemptions",
      },
    ],
    details: {
      referral_redemptions: { label: "Referral Redemptions" },
      coupon_redemptions: { label: "Coupon Redemptions" },
      subscriptions: { label: "Subscriptions" },
    },
  },
  {
    key: "hr",
    label: "HR",
    description: "Attendance, commissions, payroll",
    gate: "hr_payroll",
    kpis: [
      { key: "headcount", label: "Headcount", format: "int" },
      { key: "attendance_today", label: "Clocked In Today", format: "int" },
      { key: "avg_attendance", label: "Avg Daily Attendance", format: "pct" },
      { key: "leave_pending", label: "Leave Requests Pending", format: "int" },
      {
        key: "payroll_last_net",
        label: "Last Payroll (Net)",
        format: "money",
      },
      { key: "commissions", label: "Commissions Earned", format: "money" },
    ],
    charts: [
      { key: "attendance_trend", label: "Daily Attendance", type: "line" },
      { key: "payroll_trend", label: "Payroll Cost", type: "bar" },
      { key: "commissions_by_staff", label: "Top Commissions", type: "bar" },
    ],
    tables: [
      {
        key: "pending_leave",
        label: "Pending Leave",
        detail_key: "leave_requests",
      },
    ],
    details: {
      leave_requests: { label: "Leave Requests" },
      payroll_runs: { label: "Payroll Runs" },
      commissions: { label: "Commissions" },
    },
  },
];

const DOMAIN_KEYS = DOMAINS.map((d) => d.key);
const byKey = new Map(DOMAINS.map((d) => [d.key, d]));

function getDomain(key) {
  return byKey.get(key) || null;
}

/** Domains this capability set may open (gate check; CEO handled upstream). */
function visibleDomains(caps) {
  return DOMAINS.filter((d) => {
    if (d.gate === "accounting") return caps.can_finance;
    if (d.gate === "hr_payroll") return caps.can_hr;
    return true;
  });
}

/** Strip tiles the capability set must not see (e.g. cost tiles). */
function permittedTiles(domain, caps) {
  const allow = (t) => !t.requires || (t.requires === "cost" && caps.can_cost);
  return {
    kpis: domain.kpis.filter(allow),
    charts: domain.charts.filter(allow),
    tables: (domain.tables || []).filter(allow),
  };
}

module.exports = { DOMAINS, DOMAIN_KEYS, getDomain, visibleDomains, permittedTiles };
