/**
 * Dashboards (V2.2 §6.20) — metrics service.
 *
 * Composes the domain dashboard payloads: resolves the requested period
 * (presets handled client-side; this takes from/to), picks a chart
 * granularity, runs the domain's aggregate queries for the current AND the
 * previous equivalent window (KPI deltas), and assembles the stable payload
 * contract the frontend renders from:
 *
 *   {
 *     domain, label, period: {from,to,granularity}, previous_period,
 *     kpis:   [{key,label,format,value,previous,delta_pct}],
 *     charts: [{key,label,type, series|slices|steps}],
 *     tables: [{key,label,detail_key,columns,rows}]
 *   }
 *
 * Access truths: the routes guard entry (dashboards.access.js); this service
 * enforces the domain gates (Finance→accounting.view, HR→hr_payroll.view),
 * strips cost tiles for roles without cost visibility, and refuses the
 * cross-entity global view to non-CEOs. Snapshot KPIs (point-in-time values
 * like "open deals") carry no delta — a previous-window rerun would just
 * echo the same number.
 */

"use strict";

const { query } = require("../../config/database");
const { t, listBrands } = require("../../config/brands");
const identityCache = require("../../shared/cache/identity-cache");
const metrics = require("./dashboards.metrics.repo");
const details = require("./dashboards.details.repo");
const registry = require("./dashboards.domains");
const { DETAIL_COLUMNS, TABLE_COLUMNS } = require("./dashboards.columns");
const access = require("./dashboards.access");
const {
  NotFoundError,
  PermissionDeniedError,
  AppError,
} = require("../../utils/errors");

// ── Period handling ────────────────────────────────────────

const DAY_MS = 24 * 3600 * 1000;

function parseIso(value, fallback) {
  if (!value) return fallback;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new AppError("INVALID_PERIOD", `Invalid date: ${value}`, 400);
  }
  return d;
}

/**
 * from/to → normalised period + the previous equivalent window + a chart
 * granularity (≤45 days: daily · ≤200: weekly · beyond: monthly).
 */
function resolvePeriod({ from, to } = {}) {
  const toD = parseIso(to, new Date());
  const fromD = parseIso(from, new Date(toD.getTime() - 30 * DAY_MS));
  if (fromD >= toD) {
    throw new AppError("INVALID_PERIOD", "`from` must be before `to`", 400);
  }
  const spanMs = toD.getTime() - fromD.getTime();
  const spanDays = spanMs / DAY_MS;
  const granularity = spanDays <= 45 ? "day" : spanDays <= 200 ? "week" : "month";
  const prevTo = new Date(fromD.getTime() - 1);
  const prevFrom = new Date(fromD.getTime() - spanMs);
  return {
    from: fromD.toISOString(),
    to: toD.toISOString(),
    granularity,
    prev_from: prevFrom.toISOString(),
    prev_to: prevTo.toISOString(),
  };
}

function deltaPct(cur, prev) {
  const c = Number(cur);
  const p = Number(prev);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p === 0) return null;
  return Math.round(((c - p) / Math.abs(p)) * 1000) / 10;
}

/** Zip registry KPI manifest with current/previous value objects. */
function buildKpis(domainDef, caps, current, previous = {}) {
  return registry.permittedTiles(domainDef, caps).kpis.map((k) => {
    const value = current[k.key] ?? null;
    const prev = previous[k.key];
    return {
      key: k.key,
      label: k.label,
      format: k.format,
      value,
      previous: prev ?? null,
      delta_pct: prev === undefined ? null : deltaPct(value, prev),
    };
  });
}

/** Point-in-time KPI keys per domain — no previous-window delta. */
const SNAPSHOT_KEYS = {
  overview: [
    "pending_approvals",
    "low_stock_alerts",
    "active_deliveries",
    "overdue_invoices",
    "open_service_jobs",
  ],
  customers: ["open_deals", "pipeline_value", "at_risk"],
  finance: ["ar_outstanding", "overdue_total", "expenses_pending"],
  stock: [
    "skus_active",
    "units_on_hand",
    "value_at_cost",
    "value_at_retail",
    "low_stock",
    "out_of_stock",
  ],
  logistics: ["active", "cod_pending"],
  retention: ["loyalty_members", "active_subscriptions"],
  hr: ["headcount", "attendance_today", "leave_pending", "payroll_last_net"],
};

function stripSnapshots(domainKey, previous) {
  const clone = { ...previous };
  for (const key of SNAPSHOT_KEYS[domainKey] || []) delete clone[key];
  return clone;
}

const chart = (key, label, type, data) => ({ key, label, type, ...data });
const series = (key, label, points) => ({ key, label, points });
const pts = (rows, xKey, yKey) =>
  rows.map((r) => ({ x: r[xKey] ?? r.x, y: Number(r[yKey]) || 0 }));

function table(domainKey, tableKey, rows, detailKey = null) {
  return {
    key: tableKey,
    label:
      (registry.getDomain(domainKey).tables || []).find(
        (tb) => tb.key === tableKey,
      )?.label || tableKey,
    detail_key: detailKey,
    columns: TABLE_COLUMNS[`${domainKey}.${tableKey}`] || [],
    rows,
  };
}

// ── Domain builders ────────────────────────────────────────
// Each returns { kpis: {current, previous}, charts: [], tables: [] } raw;
// assembleDomain() zips with the registry manifest.

async function buildOverview({ brand, p }) {
  const [cur, prev, counters, revSeries, prevSeries, channels, approvals, custCur, custPrev, cashCur, cashPrev] =
    await Promise.all([
      metrics.salesKpis({ brand, from: p.from, to: p.to }),
      metrics.salesKpis({ brand, from: p.prev_from, to: p.prev_to }),
      metrics.overviewCounters({ brand }),
      metrics.revenueSeries({ brand, from: p.from, to: p.to, granularity: p.granularity }),
      metrics.revenueSeries({ brand, from: p.prev_from, to: p.prev_to, granularity: p.granularity }),
      metrics.salesChannelBreakdown({ brand, from: p.from, to: p.to }),
      metrics.pendingApprovalsList({ brand }),
      metrics.customerKpis({ brand, from: p.from, to: p.to }),
      metrics.customerKpis({ brand, from: p.prev_from, to: p.prev_to }),
      metrics.cashCollected({ brand, from: p.from, to: p.to }),
      metrics.cashCollected({ brand, from: p.prev_from, to: p.prev_to }),
    ]);
  return {
    current: {
      revenue: cur.revenue,
      orders: cur.orders,
      aov: cur.aov,
      new_customers: custCur.new_customers,
      cash_collected: cashCur,
      ...counters,
    },
    previous: {
      revenue: prev.revenue,
      orders: prev.orders,
      aov: prev.aov,
      new_customers: custPrev.new_customers,
      cash_collected: cashPrev,
    },
    charts: [
      chart("revenue_trend", "Revenue Trend", "line", {
        series: [
          series("current", "This period", pts(revSeries, "x", "revenue")),
          series("previous", "Previous period", pts(prevSeries, "x", "revenue")),
        ],
      }),
      chart("orders_by_channel", "Orders by Channel", "donut", {
        slices: channels.map((c) => ({ label: c.label, value: c.orders })),
      }),
    ],
    tables: [table("overview", "pending_approvals", approvals)],
  };
}

async function buildSales({ brand, p }) {
  const [cur, prev, revSeries, prevSeries, channels, top, methods] =
    await Promise.all([
      metrics.salesKpis({ brand, from: p.from, to: p.to }),
      metrics.salesKpis({ brand, from: p.prev_from, to: p.prev_to }),
      metrics.revenueSeries({ brand, from: p.from, to: p.to, granularity: p.granularity }),
      metrics.revenueSeries({ brand, from: p.prev_from, to: p.prev_to, granularity: p.granularity }),
      metrics.salesChannelBreakdown({ brand, from: p.from, to: p.to }),
      metrics.topProducts({ brand, from: p.from, to: p.to }),
      metrics.paymentMethodBreakdown({ brand, from: p.from, to: p.to }),
    ]);
  return {
    current: cur,
    previous: prev,
    charts: [
      chart("revenue_trend", "Revenue Trend", "line", {
        series: [
          series("current", "This period", pts(revSeries, "x", "revenue")),
          series("previous", "Previous period", pts(prevSeries, "x", "revenue")),
        ],
      }),
      chart("channel_breakdown", "Revenue by Channel", "donut", {
        slices: channels,
      }),
      chart("top_products", "Top Products", "bar", { slices: top }),
      chart("payment_methods", "Payment Methods", "donut", { slices: methods }),
    ],
    tables: [table("sales", "top_products", top, "orders")],
  };
}

async function buildCustomers({ brand, p }) {
  const [cur, prev, trend, pipeline, sources, bands, top] = await Promise.all([
    metrics.customerKpis({ brand, from: p.from, to: p.to }),
    metrics.customerKpis({ brand, from: p.prev_from, to: p.prev_to }),
    metrics.newCustomersSeries({ brand, from: p.from, to: p.to, granularity: p.granularity }),
    metrics.pipelineByStage({ brand }),
    metrics.acquisitionBySource({ brand, from: p.from, to: p.to }),
    metrics.churnBands({ brand }),
    metrics.topCustomers({ brand, from: p.from, to: p.to }),
  ]);
  return {
    current: cur,
    previous: prev,
    charts: [
      chart("new_customers_trend", "New Customers", "line", {
        series: [series("current", "New customers", pts(trend, "x", "new_customers"))],
      }),
      chart("pipeline_by_stage", "Pipeline by Stage", "funnel", {
        steps: pipeline.map((s) => ({ label: s.label, value: s.deals, amount: s.value })),
      }),
      chart("acquisition_by_source", "Acquisition", "donut", { slices: sources }),
      chart("churn_bands", "Churn Risk", "donut", { slices: bands }),
    ],
    tables: [table("customers", "top_customers", top.rows, "top_customers")],
  };
}

async function buildFinance({ brand, p }) {
  const [cur, prev, ieSeries, ageing, cats, overdue] = await Promise.all([
    metrics.financeKpis({ brand, from: p.from, to: p.to }),
    metrics.financeKpis({ brand, from: p.prev_from, to: p.prev_to }),
    metrics.incomeExpenseSeries({ brand, from: p.from, to: p.to, granularity: p.granularity }),
    metrics.arAgeing({ brand }),
    metrics.expensesByCategory({ brand, from: p.from, to: p.to }),
    details.DETAILS.finance.receivables({ brand, limit: 10, offset: 0 }),
  ]);
  return {
    current: cur,
    previous: prev,
    charts: [
      chart("income_vs_expenses", "Income vs Expenses", "bar_line", {
        series: [
          series("income", "Income", pts(ieSeries, "x", "income")),
          series("expenses", "Expenses", pts(ieSeries, "x", "expenses")),
        ],
      }),
      chart("ar_ageing", "Receivables Ageing", "bar", { slices: ageing }),
      chart("expenses_by_category", "Expenses by Category", "donut", {
        slices: cats,
      }),
    ],
    tables: [table("finance", "overdue_invoices", overdue.rows, "receivables")],
  };
}

async function buildStock({ brand, p, caps }) {
  const [cur, moveSeries, sellThrough, top, low] = await Promise.all([
    metrics.stockKpis({ brand, includeCost: caps.can_cost }),
    metrics.stockMovementSeries({ brand, from: p.from, to: p.to, granularity: p.granularity }),
    metrics.sellThroughByChannel({ brand, from: p.from, to: p.to }),
    metrics.topMovingVariants({ brand, from: p.from, to: p.to }),
    details.DETAILS.stock.low_stock({ brand, limit: 10, offset: 0 }),
  ]);
  return {
    current: cur,
    previous: {},
    charts: [
      chart("movements_trend", "Units In vs Out", "bar_line", {
        series: [
          series("units_in", "Units in", pts(moveSeries, "x", "units_in")),
          series("units_out", "Units out", pts(moveSeries, "x", "units_out")),
        ],
      }),
      chart("sell_through_by_channel", "Sell-through by Channel", "donut", {
        slices: sellThrough,
      }),
      chart("top_moving", "Top Moving", "bar", { slices: top }),
    ],
    tables: [table("stock", "low_stock", low.rows, "low_stock")],
  };
}

async function buildLogistics({ brand, p }) {
  const [cur, prev, trend, statuses, couriers] = await Promise.all([
    metrics.logisticsKpis({ brand, from: p.from, to: p.to }),
    metrics.logisticsKpis({ brand, from: p.prev_from, to: p.prev_to }),
    metrics.deliveriesSeries({ brand, from: p.from, to: p.to, granularity: p.granularity }),
    metrics.deliveryStatusBreakdown({ brand }),
    metrics.courierPerformance({ brand, from: p.from, to: p.to }),
  ]);
  return {
    current: cur,
    previous: prev,
    charts: [
      chart("deliveries_trend", "Booked vs Delivered", "line", {
        series: [
          series("booked", "Booked", pts(trend, "x", "booked")),
          series("delivered", "Delivered", pts(trend, "x", "delivered")),
        ],
      }),
      chart("status_breakdown", "By Status", "donut", { slices: statuses }),
      chart("courier_performance", "Courier Performance", "bar", {
        slices: couriers.map((c) => ({ label: c.label, value: c.delivered, failed: c.failed })),
      }),
    ],
    tables: [table("logistics", "courier_scorecard", couriers, "deliveries")],
  };
}

async function buildMarketing({ brand, p }) {
  const [cur, prev, funnel, spend, platforms, campaigns] = await Promise.all([
    metrics.marketingKpis({ brand, from: p.from, to: p.to }),
    metrics.marketingKpis({ brand, from: p.prev_from, to: p.prev_to }),
    metrics.emailFunnel({ brand, from: p.from, to: p.to }),
    metrics.adSpendSeries({ brand, from: p.from, to: p.to, granularity: p.granularity }),
    metrics.engagementByPlatform({ brand, from: p.from, to: p.to }),
    metrics.salesCampaignPerformance({ brand, from: p.from, to: p.to }),
  ]);
  return {
    current: cur,
    previous: prev,
    charts: [
      chart("email_funnel", "Email Funnel", "funnel", { steps: funnel }),
      chart("ad_spend_trend", "Ad Spend vs Return", "bar_line", {
        series: [
          series("spend", "Spend", pts(spend, "x", "spend")),
          series("return", "Return", pts(spend, "x", "ad_return")),
        ],
      }),
      chart("engagement_by_platform", "Engagement by Platform", "bar", {
        slices: platforms,
      }),
      chart("campaign_performance", "Campaign Conversion", "bar", {
        slices: campaigns,
      }),
    ],
    tables: [table("marketing", "campaigns", campaigns, "email_campaigns")],
  };
}

async function buildEcommerce({ brand, p }) {
  const [cur, prev, trend, funnel, currencies, devices, sources] =
    await Promise.all([
      metrics.ecommerceKpis({ brand, from: p.from, to: p.to }),
      metrics.ecommerceKpis({ brand, from: p.prev_from, to: p.prev_to }),
      metrics.sessionsSeries({ brand, from: p.from, to: p.to, granularity: p.granularity }),
      metrics.checkoutFunnel({ brand, from: p.from, to: p.to }),
      metrics.currencyBreakdown({ brand, from: p.from, to: p.to }),
      metrics.deviceBreakdown({ brand, from: p.from, to: p.to }),
      metrics.topTrafficSources({ brand, from: p.from, to: p.to }),
    ]);
  return {
    current: cur,
    previous: prev,
    charts: [
      chart("sessions_trend", "Sessions & Orders", "line", {
        series: [
          series("sessions", "Sessions", pts(trend, "x", "sessions")),
          series("orders", "Orders", pts(trend, "x", "orders")),
        ],
      }),
      chart("checkout_funnel", "Checkout Funnel", "funnel", { steps: funnel }),
      chart("currency_breakdown", "Orders by Currency", "donut", {
        slices: currencies.map((c) => ({ label: c.label, value: c.orders, amount: c.value })),
      }),
      chart("device_breakdown", "Devices", "donut", { slices: devices }),
      chart("top_sources", "Top Sources", "bar", {
        slices: sources.map((s) => ({ label: s.label, value: s.sessions, conversions: s.conversions })),
      }),
    ],
    tables: [table("ecommerce", "top_sources", sources, "sessions")],
  };
}

async function buildRetention({ brand, p }) {
  const [cur, prev, points, tiers, coupons, referrers] = await Promise.all([
    metrics.retentionKpis({ brand, from: p.from, to: p.to }),
    metrics.retentionKpis({ brand, from: p.prev_from, to: p.prev_to }),
    metrics.pointsSeries({ brand, from: p.from, to: p.to, granularity: p.granularity }),
    metrics.tierDistribution({ brand }),
    metrics.topCoupons({ brand, from: p.from, to: p.to }),
    metrics.topReferrers({ brand, from: p.from, to: p.to }),
  ]);
  return {
    current: cur,
    previous: prev,
    charts: [
      chart("points_trend", "Points Earned vs Redeemed", "bar_line", {
        series: [
          series("earned", "Earned", pts(points, "x", "earned")),
          series("redeemed", "Redeemed", pts(points, "x", "redeemed")),
        ],
      }),
      chart("tier_distribution", "Loyalty Tiers", "donut", { slices: tiers }),
      chart("top_coupons", "Top Coupons", "bar", {
        slices: coupons.map((c) => ({ label: c.label, value: c.uses, amount: c.value })),
      }),
    ],
    tables: [table("retention", "top_referrers", referrers, "referral_redemptions")],
  };
}

async function buildHr({ brand, p }) {
  const [cur, prev, attendance, payroll, commissions, leave] =
    await Promise.all([
      metrics.hrKpis({ brand, from: p.from, to: p.to }),
      metrics.hrKpis({ brand, from: p.prev_from, to: p.prev_to }),
      metrics.attendanceSeries({ brand, from: p.from, to: p.to, granularity: p.granularity }),
      metrics.payrollTrend({ brand }),
      metrics.commissionsByStaff({ brand, from: p.from, to: p.to }),
      details.DETAILS.hr.leave_requests({ brand, limit: 10, offset: 0 }),
    ]);
  return {
    current: cur,
    previous: prev,
    charts: [
      chart("attendance_trend", "Daily Attendance", "line", {
        series: [series("present", "Clocked in", pts(attendance, "x", "present"))],
      }),
      chart("payroll_trend", "Payroll Cost", "bar", {
        series: [
          series("gross", "Gross", pts(payroll, "label", "gross")),
          series("net", "Net", pts(payroll, "label", "net")),
        ],
      }),
      chart("commissions_by_staff", "Top Commissions", "bar", {
        slices: commissions,
      }),
    ],
    tables: [table("hr", "pending_leave", leave.rows, "leave_requests")],
  };
}

const BUILDERS = {
  overview: buildOverview,
  sales: buildSales,
  customers: buildCustomers,
  finance: buildFinance,
  stock: buildStock,
  logistics: buildLogistics,
  marketing: buildMarketing,
  ecommerce: buildEcommerce,
  retention: buildRetention,
  hr: buildHr,
};

// ── Gates ──────────────────────────────────────────────────

function assertDomainAllowed(domainDef, caps) {
  if (domainDef.gate === "accounting" && !caps.can_finance) {
    throw new PermissionDeniedError("Finance dashboard requires accounting access");
  }
  if (domainDef.gate === "hr_payroll" && !caps.can_hr) {
    throw new PermissionDeniedError("HR dashboard requires HR & payroll access");
  }
}

// ── Public API ─────────────────────────────────────────────

/** GET /dashboards/domains — the structure the user may see. */
async function listDomains({ brand, user }) {
  const caps = await access.capabilities(user);
  const domains = registry.visibleDomains(caps).map((d) => {
    const tiles = registry.permittedTiles(d, caps);
    return {
      key: d.key,
      label: d.label,
      description: d.description,
      kpis: tiles.kpis,
      charts: tiles.charts,
      tables: tiles.tables,
      details: Object.entries(d.details || {}).map(([key, v]) => ({
        key,
        label: v.label,
      })),
    };
  });
  const prefs = await getPreferences({ brand, user });
  return {
    domains,
    capabilities: caps,
    hidden_tiles: prefs.hidden_tiles,
  };
}

/** GET /dashboards/domains/:key — one domain's dashboard payload. */
async function domainData({ brand, user, key, from, to }) {
  const domainDef = registry.getDomain(key);
  if (!domainDef) throw new NotFoundError("Dashboard domain");
  const caps = await access.capabilities(user);
  assertDomainAllowed(domainDef, caps);

  const p = resolvePeriod({ from, to });
  const raw = await BUILDERS[key]({ brand, p, caps });
  const permitted = registry.permittedTiles(domainDef, caps);
  const chartKeys = new Set(permitted.charts.map((c) => c.key));
  const tableKeys = new Set(permitted.tables.map((tb) => tb.key));

  return {
    domain: key,
    label: domainDef.label,
    period: { from: p.from, to: p.to, granularity: p.granularity },
    previous_period: { from: p.prev_from, to: p.prev_to },
    kpis: buildKpis(domainDef, caps, raw.current, stripSnapshots(key, raw.previous)),
    charts: raw.charts.filter((c) => chartKeys.has(c.key)),
    tables: raw.tables.filter((tb) => tableKeys.has(tb.key)),
  };
}

/** GET /dashboards/domains/:key/detail/:table — paginated drill-down. */
async function domainDetail({ brand, user, key, tableKey, from, to, filters, page = 1, page_size = 25 }) {
  const domainDef = registry.getDomain(key);
  if (!domainDef) throw new NotFoundError("Dashboard domain");
  const caps = await access.capabilities(user);
  assertDomainAllowed(domainDef, caps);

  const fn = details.DETAILS[key] && details.DETAILS[key][tableKey];
  if (!fn) throw new NotFoundError("Dashboard detail table");

  const p = resolvePeriod({ from, to });
  const limit = Math.min(Math.max(page_size, 1), 100);
  const offset = (Math.max(page, 1) - 1) * limit;
  const { rows, total } = await fn({
    brand,
    from: p.from,
    to: p.to,
    filters: filters || {},
    limit,
    offset,
  });
  return {
    data: rows,
    columns: (DETAIL_COLUMNS[key] && DETAIL_COLUMNS[key][tableKey]) || [],
    label:
      (domainDef.details && domainDef.details[tableKey] && domainDef.details[tableKey].label) ||
      tableKey,
    period: { from: p.from, to: p.to },
    meta: {
      page: Math.max(page, 1),
      page_size: limit,
      total,
      has_more: offset + rows.length < total,
    },
  };
}

/**
 * GET /dashboards/global — CEO-only cross-entity rollup (the ONE place the
 * canon allows aggregation across businesses).
 */
async function globalOverview({ user, from, to }) {
  if (!user.is_ceo) {
    throw new PermissionDeniedError("The all-businesses view is CEO-only");
  }
  const p = resolvePeriod({ from, to });
  const brands = listBrands();

  const perBrand = await Promise.all(
    brands.map(async (brand) => {
      const [cur, prev, cash, cust, custPrev, rev] = await Promise.all([
        metrics.salesKpis({ brand, from: p.from, to: p.to }),
        metrics.salesKpis({ brand, from: p.prev_from, to: p.prev_to }),
        metrics.cashCollected({ brand, from: p.from, to: p.to }),
        metrics.customerKpis({ brand, from: p.from, to: p.to }),
        metrics.customerKpis({ brand, from: p.prev_from, to: p.prev_to }),
        metrics.revenueSeries({ brand, from: p.from, to: p.to, granularity: p.granularity }),
      ]);
      let display_name = brand;
      try {
        const cfg = await identityCache.getBrandConfig(brand);
        if (cfg && cfg.display_name) display_name = cfg.display_name;
      } catch {
        /* brand label fallback is the key itself */
      }
      return { brand, display_name, cur, prev, cash, cust, custPrev, rev };
    }),
  );

  const sum = (sel) =>
    perBrand.reduce((acc, b) => acc + (Number(sel(b)) || 0), 0);
  const combinedRevenue = sum((b) => b.cur.revenue);
  const combinedOrders = sum((b) => b.cur.orders);
  const prevRevenue = sum((b) => b.prev.revenue);
  const prevOrders = sum((b) => b.prev.orders);

  return {
    period: { from: p.from, to: p.to, granularity: p.granularity },
    previous_period: { from: p.prev_from, to: p.prev_to },
    combined: {
      revenue: combinedRevenue.toFixed(2),
      revenue_delta_pct: deltaPct(combinedRevenue, prevRevenue),
      orders: combinedOrders,
      orders_delta_pct: deltaPct(combinedOrders, prevOrders),
      aov: combinedOrders ? (combinedRevenue / combinedOrders).toFixed(2) : "0.00",
      cash_collected: sum((b) => b.cash).toFixed(2),
      new_customers: sum((b) => b.cust.new_customers),
    },
    businesses: perBrand.map((b) => ({
      brand: b.brand,
      display_name: b.display_name,
      revenue: b.cur.revenue,
      revenue_delta_pct: deltaPct(b.cur.revenue, b.prev.revenue),
      orders: b.cur.orders,
      orders_delta_pct: deltaPct(b.cur.orders, b.prev.orders),
      aov: b.cur.aov,
      cash_collected: b.cash,
      new_customers: b.cust.new_customers,
      new_customers_delta_pct: deltaPct(b.cust.new_customers, b.custPrev.new_customers),
    })),
    revenue_trend: {
      series: perBrand.map((b) =>
        series(b.brand, b.display_name, pts(b.rev, "x", "revenue")),
      ),
    },
  };
}

// ── Tile preferences (show/hide, persisted per user) ───────
// Stored as this user's "Dashboard preferences" row in {brand}.dashboard_configs
// (layout = [{key:"sales:chart:top_products", hidden:true}, ...]) so the fixed
// layout stays personal without a grid editor. Keys are namespaced
// `${domain}:${kpi|chart|table}:${tileKey}` and validated against the registry.

const PREFS_NAME = "Dashboard preferences";

function validTileKeys() {
  const valid = new Set();
  for (const d of registry.DOMAINS) {
    for (const k of d.kpis) valid.add(`${d.key}:kpi:${k.key}`);
    for (const c of d.charts) valid.add(`${d.key}:chart:${c.key}`);
    for (const tb of d.tables || []) valid.add(`${d.key}:table:${tb.key}`);
  }
  return valid;
}

async function getPreferences({ brand, user }) {
  const { rows } = await query(
    `SELECT layout FROM ${t(brand, "dashboard_configs")}
      WHERE user_id = $1 AND display_name = $2
      ORDER BY created_at LIMIT 1`,
    [user.user_id, PREFS_NAME],
  );
  const layout = rows[0] ? rows[0].layout : null;
  const hidden_tiles = Array.isArray(layout)
    ? layout
        .filter((e) => e && e.hidden === true && typeof e.key === "string")
        .map((e) => e.key)
    : [];
  return { hidden_tiles };
}

async function putPreferences({ brand, user, hidden_tiles }) {
  const valid = validTileKeys();
  const clean = [...new Set(hidden_tiles || [])]
    .filter((k) => typeof k === "string" && valid.has(k))
    .slice(0, 500);
  const layout = JSON.stringify(clean.map((key) => ({ key, hidden: true })));
  const { rows } = await query(
    `UPDATE ${t(brand, "dashboard_configs")}
        SET layout = $3::jsonb
      WHERE user_id = $1 AND display_name = $2
      RETURNING dashboard_id`,
    [user.user_id, PREFS_NAME, layout],
  );
  if (!rows[0]) {
    await query(
      `INSERT INTO ${t(brand, "dashboard_configs")}
         (user_id, display_name, description, layout)
       VALUES ($1, $2, 'Per-user dashboard tile visibility', $3::jsonb)`,
      [user.user_id, PREFS_NAME, layout],
    );
  }
  return { hidden_tiles: clean };
}

module.exports = {
  resolvePeriod,
  deltaPct,
  listDomains,
  domainData,
  domainDetail,
  globalOverview,
  getPreferences,
  putPreferences,
  SNAPSHOT_KEYS,
};
