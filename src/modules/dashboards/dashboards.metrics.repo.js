/**
 * Dashboards (V2.2 §6.20) — metrics repository.
 *
 * Read-only aggregates for the domain dashboards (overview + 9 spec domains).
 * Parameterised SQL only; schema names go through the brand registry guard
 * (`t(brand, table)`), and the granularity/step strings are interpolated from
 * a fixed whitelist — never from user input.
 *
 * Conventions:
 *   - Money KPIs/table cells come back as strings (2dp) per API_CONVENTIONS;
 *     chart series points are numbers (the chart layer consumes numerics).
 *   - REVENUE_STATES mirrors sales.service PAID_STATES so every figure here
 *     reconciles with the Sales module's own tiles and report export.
 *   - Time series bucket in Africa/Lagos (business timezone; fixed offset)
 *     and zero-fill via generate_series so charts never have gaps.
 */

"use strict";

const { query } = require("../../config/database");
const { t } = require("../../config/brands");

// Mirrors sales.service PAID_STATES — realised revenue.
const REVENUE_STATES = `('paid','awaiting_dispatch','completed')`;
const ACTIVE_DELIVERY_STATES = `('queued','booked','picked_up','in_transit','arrived_destination_city','out_for_delivery')`;
const TZ = `'Africa/Lagos'`;

// Whitelisted series granularities (never user-interpolated).
const GRANULARITIES = {
  day: { trunc: "day", step: "1 day" },
  week: { trunc: "week", step: "1 week" },
  month: { trunc: "month", step: "1 month" },
};

function frame(granularity) {
  const g = GRANULARITIES[granularity];
  if (!g) throw new Error(`Invalid granularity: ${granularity}`);
  return g;
}

/**
 * Zero-filled series scaffold: buckets CTE from $1..$2 at the given
 * granularity. `aggSql` must expose a `bucket` column grouped at the same
 * granularity. Extra params beyond $1/$2 may be used inside aggSql.
 */
function seriesSql(granularity, aggSql, selectCols) {
  const { trunc, step } = frame(granularity);
  return `
    WITH buckets AS (
      SELECT generate_series(
        date_trunc('${trunc}', ($1::timestamptz) AT TIME ZONE ${TZ}),
        date_trunc('${trunc}', ($2::timestamptz) AT TIME ZONE ${TZ}),
        interval '${step}'
      ) AS bucket
    ), agg AS (${aggSql})
    SELECT to_char(b.bucket, 'YYYY-MM-DD') AS x, ${selectCols}
      FROM buckets b LEFT JOIN agg a USING (bucket)
     ORDER BY b.bucket`;
}

const bucketExpr = (granularity, col) =>
  `date_trunc('${frame(granularity).trunc}', (${col}) AT TIME ZONE ${TZ})`;

// For DATE columns (already timezone-free): plain truncation, cast to
// timestamp so the LEFT JOIN with the buckets CTE type-matches.
const bucketExprDate = (granularity, col) =>
  `date_trunc('${frame(granularity).trunc}', (${col})::timestamp)`;

// ── Sales ──────────────────────────────────────────────────

async function salesKpis({ brand, from, to }) {
  const { rows } = await query(
    `SELECT
        COALESCE(SUM(total_ngn) FILTER (WHERE status IN ${REVENUE_STATES}),0)::text AS revenue,
        count(*) FILTER (WHERE status IN ${REVENUE_STATES})::int AS orders,
        COALESCE(ROUND(SUM(total_ngn) FILTER (WHERE status IN ${REVENUE_STATES})
          / NULLIF(count(*) FILTER (WHERE status IN ${REVENUE_STATES}),0),2),0)::text AS aov,
        COALESCE(SUM(discount_amount_ngn) FILTER (WHERE status IN ${REVENUE_STATES}),0)::text AS discount_given,
        count(*) FILTER (WHERE status = 'pending_payment')::int AS pending_payment
       FROM ${t(brand, "sales_orders")}
      WHERE COALESCE(placed_at, created_at) BETWEEN $1 AND $2`,
    [from, to],
  );
  const { rows: q } = await query(
    `SELECT
        count(*) FILTER (WHERE sent_at BETWEEN $1 AND $2)::int AS quotes_sent,
        count(*) FILTER (WHERE accepted_at BETWEEN $1 AND $2
                           AND converted_sales_order_id IS NOT NULL)::int AS quotes_converted
       FROM ${t(brand, "quotations")}`,
    [from, to],
  );
  const sent = q[0].quotes_sent;
  return {
    ...rows[0],
    quotes_sent: sent,
    quote_conversion: sent ? Math.round((q[0].quotes_converted / sent) * 1000) / 10 : null,
  };
}

async function revenueSeries({ brand, from, to, granularity }) {
  const sql = seriesSql(
    granularity,
    `SELECT ${bucketExpr(granularity, "COALESCE(placed_at, created_at)")} AS bucket,
            SUM(total_ngn) AS revenue, count(*) AS orders
       FROM ${t(brand, "sales_orders")}
      WHERE status IN ${REVENUE_STATES}
        AND COALESCE(placed_at, created_at) BETWEEN $1 AND $2
      GROUP BY 1`,
    `COALESCE(a.revenue,0)::float8 AS revenue, COALESCE(a.orders,0)::int AS orders`,
  );
  const { rows } = await query(sql, [from, to]);
  return rows;
}

async function salesChannelBreakdown({ brand, from, to }) {
  const { rows } = await query(
    `SELECT COALESCE(sales_channel,'unknown') AS label,
            count(*)::int AS orders,
            COALESCE(SUM(total_ngn),0)::float8 AS value
       FROM ${t(brand, "sales_orders")}
      WHERE status IN ${REVENUE_STATES}
        AND COALESCE(placed_at, created_at) BETWEEN $1 AND $2
      GROUP BY 1 ORDER BY value DESC`,
    [from, to],
  );
  return rows;
}

async function topProducts({ brand, from, to, limit = 10 }) {
  const { rows } = await query(
    `SELECT l.product_name_snapshot AS label,
            SUM(l.quantity)::int AS units,
            COALESCE(SUM(l.line_total_ngn),0)::float8 AS value
       FROM ${t(brand, "sales_order_lines")} l
       JOIN ${t(brand, "sales_orders")} o ON o.order_id = l.order_id
      WHERE o.status IN ${REVENUE_STATES}
        AND COALESCE(o.placed_at, o.created_at) BETWEEN $1 AND $2
      GROUP BY 1 ORDER BY value DESC LIMIT $3`,
    [from, to, limit],
  );
  return rows;
}

async function paymentMethodBreakdown({ brand, from, to }) {
  const { rows } = await query(
    `SELECT COALESCE(method,'unknown') AS label,
            count(*)::int AS payments,
            COALESCE(SUM(amount_ngn),0)::float8 AS value
       FROM ${t(brand, "sales_order_payments")}
      WHERE captured_at BETWEEN $1 AND $2
      GROUP BY 1 ORDER BY value DESC`,
    [from, to],
  );
  return rows;
}

async function cashCollected({ brand, from, to }) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(amount_ngn),0)::text AS cash_collected
       FROM ${t(brand, "sales_order_payments")}
      WHERE captured_at BETWEEN $1 AND $2`,
    [from, to],
  );
  return rows[0].cash_collected;
}

// ── Customers ──────────────────────────────────────────────

async function customerKpis({ brand, from, to }) {
  const { rows: buyers } = await query(
    `WITH period_customers AS (
       SELECT contact_id, count(*) AS period_orders
         FROM ${t(brand, "sales_orders")}
        WHERE status IN ${REVENUE_STATES} AND contact_id IS NOT NULL
          AND COALESCE(placed_at, created_at) BETWEEN $1 AND $2
        GROUP BY 1
     ), firsts AS (
       SELECT contact_id, MIN(COALESCE(placed_at, created_at)) AS first_at,
              count(*) AS lifetime_orders
         FROM ${t(brand, "sales_orders")}
        WHERE status IN ${REVENUE_STATES} AND contact_id IS NOT NULL
        GROUP BY 1
     )
     SELECT
        (SELECT count(*) FROM period_customers)::int AS active_customers,
        (SELECT count(*) FROM firsts WHERE first_at BETWEEN $1 AND $2)::int AS new_customers,
        COALESCE(ROUND(
          (SELECT count(*) FROM period_customers pc JOIN firsts f USING (contact_id)
            WHERE f.lifetime_orders > 1)::numeric
          / NULLIF((SELECT count(*) FROM period_customers),0) * 100, 1), 0)::float8 AS repeat_rate`,
    [from, to],
  );
  const { rows: deals } = await query(
    `SELECT count(*)::int AS open_deals,
            COALESCE(SUM(expected_value_ngn),0)::text AS pipeline_value
       FROM ${t(brand, "crm_deals")}
      WHERE status = 'open' AND is_deleted = false`,
  );
  const { rows: risk } = await query(
    `SELECT count(*)::int AS at_risk
       FROM ${t(brand, "churn_risk_scores")}
      WHERE superseded_at IS NULL AND recovered_at IS NULL
        AND risk_band IN ('high','critical')`,
  );
  return { ...buyers[0], ...deals[0], ...risk[0] };
}

async function newCustomersSeries({ brand, from, to, granularity }) {
  const sql = seriesSql(
    granularity,
    `SELECT ${bucketExpr(granularity, "first_at")} AS bucket, count(*) AS new_customers
       FROM (SELECT contact_id, MIN(COALESCE(placed_at, created_at)) AS first_at
               FROM ${t(brand, "sales_orders")}
              WHERE status IN ${REVENUE_STATES} AND contact_id IS NOT NULL
              GROUP BY 1) f
      WHERE first_at BETWEEN $1 AND $2
      GROUP BY 1`,
    `COALESCE(a.new_customers,0)::int AS new_customers`,
  );
  const { rows } = await query(sql, [from, to]);
  return rows;
}

async function pipelineByStage({ brand }) {
  const { rows } = await query(
    `SELECT s.display_name AS label, count(d.deal_id)::int AS deals,
            COALESCE(SUM(d.expected_value_ngn),0)::float8 AS value
       FROM ${t(brand, "crm_pipeline_stages")} s
       LEFT JOIN ${t(brand, "crm_deals")} d
         ON d.current_stage_id = s.stage_id AND d.status = 'open' AND d.is_deleted = false
      WHERE s.is_active = true AND s.is_terminal = false
      GROUP BY s.display_name, s.display_order
      ORDER BY s.display_order`,
  );
  return rows;
}

async function acquisitionBySource({ brand, from, to }) {
  const { rows } = await query(
    `WITH firsts AS (
       SELECT contact_id, MIN(COALESCE(placed_at, created_at)) AS first_at
         FROM ${t(brand, "sales_orders")}
        WHERE status IN ${REVENUE_STATES} AND contact_id IS NOT NULL
        GROUP BY 1
     )
     SELECT COALESCE(NULLIF(TRIM(c.source),''),'unknown') AS label, count(*)::int AS value
       FROM firsts f JOIN shared.contacts c ON c.contact_id = f.contact_id
      WHERE f.first_at BETWEEN $1 AND $2
      GROUP BY 1 ORDER BY value DESC LIMIT 10`,
    [from, to],
  );
  return rows;
}

async function churnBands({ brand }) {
  const { rows } = await query(
    `SELECT risk_band AS label, count(*)::int AS value
       FROM ${t(brand, "churn_risk_scores")}
      WHERE superseded_at IS NULL AND recovered_at IS NULL
      GROUP BY 1
      ORDER BY array_position(ARRAY['critical','high','medium','low'], risk_band)`,
  );
  return rows;
}

async function topCustomers({ brand, from, to, limit = 10, offset = 0, withTotal = false }) {
  const base = `
     FROM ${t(brand, "sales_orders")} o
     JOIN shared.contacts c ON c.contact_id = o.contact_id
    WHERE o.status IN ${REVENUE_STATES}
      AND COALESCE(o.placed_at, o.created_at) BETWEEN $1 AND $2`;
  const { rows } = await query(
    `SELECT c.contact_id, c.display_name,
            count(*)::int AS orders,
            COALESCE(SUM(o.total_ngn),0)::text AS revenue,
            MAX(COALESCE(o.placed_at, o.created_at)) AS last_order_at
       ${base}
      GROUP BY c.contact_id, c.display_name
      ORDER BY SUM(o.total_ngn) DESC LIMIT $3 OFFSET $4`,
    [from, to, limit, offset],
  );
  if (!withTotal) return { rows };
  const { rows: c } = await query(
    `SELECT count(DISTINCT o.contact_id)::int AS total ${base}`,
    [from, to],
  );
  return { rows, total: c[0].total };
}

// ── Finance ────────────────────────────────────────────────

async function financeKpis({ brand, from, to }) {
  const { rows: pnl } = await query(
    `SELECT
        COALESCE(SUM(CASE WHEN g.group_type IN ('revenue','contra_revenue')
                          THEN jl.credit_ngn - jl.debit_ngn ELSE 0 END),0)::text AS income,
        COALESCE(SUM(CASE WHEN g.group_type = 'expense'
                          THEN jl.debit_ngn - jl.credit_ngn ELSE 0 END),0)::text AS expenses
       FROM ${t(brand, "journal_lines")} jl
       JOIN ${t(brand, "journal_entries")} je ON je.entry_id = jl.entry_id
       JOIN ${t(brand, "chart_of_accounts")} a ON a.account_id = jl.account_id
       JOIN ${t(brand, "account_groups")} g ON g.group_id = a.group_id
      WHERE je.status = 'posted' AND je.posting_date BETWEEN $1 AND $2`,
    [from, to],
  );
  const { rows: ar } = await query(
    `SELECT COALESCE(SUM(balance_due_ngn),0)::text AS ar_outstanding,
            count(*)::int AS ar_count,
            COALESCE(SUM(balance_due_ngn) FILTER (WHERE due_date < CURRENT_DATE),0)::text AS overdue_total,
            count(*) FILTER (WHERE due_date < CURRENT_DATE)::int AS overdue_count
       FROM ${t(brand, "invoices")}
      WHERE status NOT IN ('paid','void','refunded') AND balance_due_ngn > 0`,
  );
  const { rows: exp } = await query(
    `SELECT count(*) FILTER (WHERE status = 'pending')::int AS expenses_pending
       FROM ${t(brand, "expenses")}`,
  );
  const cash = await cashCollected({ brand, from, to });
  const net = (Number(pnl[0].income) - Number(pnl[0].expenses)).toFixed(2);
  return { ...pnl[0], net, ...ar[0], ...exp[0], cash_collected: cash };
}

async function incomeExpenseSeries({ brand, from, to, granularity }) {
  const sql = seriesSql(
    granularity,
    `SELECT ${bucketExprDate(granularity, "je.posting_date")} AS bucket,
            SUM(CASE WHEN g.group_type IN ('revenue','contra_revenue')
                     THEN jl.credit_ngn - jl.debit_ngn ELSE 0 END) AS income,
            SUM(CASE WHEN g.group_type = 'expense'
                     THEN jl.debit_ngn - jl.credit_ngn ELSE 0 END) AS expenses
       FROM ${t(brand, "journal_lines")} jl
       JOIN ${t(brand, "journal_entries")} je ON je.entry_id = jl.entry_id
       JOIN ${t(brand, "chart_of_accounts")} a ON a.account_id = jl.account_id
       JOIN ${t(brand, "account_groups")} g ON g.group_id = a.group_id
      WHERE je.status = 'posted' AND je.posting_date BETWEEN $1 AND $2
      GROUP BY 1`,
    `COALESCE(a.income,0)::float8 AS income, COALESCE(a.expenses,0)::float8 AS expenses`,
  );
  const { rows } = await query(sql, [from, to]);
  return rows;
}

async function arAgeing({ brand }) {
  const { rows } = await query(
    `SELECT
        COALESCE(SUM(balance_due_ngn) FILTER (WHERE due_date >= CURRENT_DATE),0)::float8 AS current,
        COALESCE(SUM(balance_due_ngn) FILTER (WHERE CURRENT_DATE - due_date BETWEEN 1 AND 30),0)::float8 AS d1_30,
        COALESCE(SUM(balance_due_ngn) FILTER (WHERE CURRENT_DATE - due_date BETWEEN 31 AND 60),0)::float8 AS d31_60,
        COALESCE(SUM(balance_due_ngn) FILTER (WHERE CURRENT_DATE - due_date BETWEEN 61 AND 90),0)::float8 AS d61_90,
        COALESCE(SUM(balance_due_ngn) FILTER (WHERE CURRENT_DATE - due_date > 90),0)::float8 AS d90_plus
       FROM ${t(brand, "invoices")}
      WHERE status NOT IN ('paid','void','refunded') AND balance_due_ngn > 0`,
  );
  const r = rows[0];
  return [
    { label: "Current", value: r.current },
    { label: "1–30 days", value: r.d1_30 },
    { label: "31–60 days", value: r.d31_60 },
    { label: "61–90 days", value: r.d61_90 },
    { label: "90+ days", value: r.d90_plus },
  ];
}

async function expensesByCategory({ brand, from, to }) {
  const { rows } = await query(
    `SELECT COALESCE(c.display_name, e.expense_type, 'Uncategorised') AS label,
            COALESCE(SUM(el.amount_ngn),0)::float8 AS value
       FROM ${t(brand, "expense_lines")} el
       JOIN ${t(brand, "expenses")} e ON e.expense_id = el.expense_id
       LEFT JOIN ${t(brand, "expense_categories")} c ON c.category_id = el.category_id
      WHERE e.status IN ('approved','paid','reimbursed','partially_paid')
        AND e.expense_date BETWEEN $1::timestamptz::date AND $2::timestamptz::date
      GROUP BY 1 ORDER BY value DESC LIMIT 12`,
    [from, to],
  );
  return rows;
}

// ── Stock ──────────────────────────────────────────────────

async function stockKpis({ brand, includeCost }) {
  const costCol = includeCost
    ? `COALESCE(SUM(sl.on_hand * COALESCE(v.cost_price_ngn,0)),0)::text`
    : `NULL::text`;
  const { rows } = await query(
    `SELECT
        count(DISTINCT v.variant_id) FILTER (WHERE v.is_active)::int AS skus_active,
        COALESCE(SUM(sl.on_hand),0)::int AS units_on_hand,
        ${costCol} AS value_at_cost,
        COALESCE(SUM(sl.on_hand * COALESCE(v.price_storefront_ngn,0)),0)::text AS value_at_retail,
        (SELECT count(*) FROM (
           SELECT variant_id FROM ${t(brand, "stock_levels")}
            GROUP BY variant_id HAVING SUM(available) <= 0
         ) oos)::int AS out_of_stock
       FROM ${t(brand, "product_variants")} v
       LEFT JOIN ${t(brand, "stock_levels")} sl ON sl.variant_id = v.variant_id`,
  );
  const { rows: alerts } = await query(
    `SELECT count(*)::int AS low_stock
       FROM ${t(brand, "stock_alerts")} WHERE status = 'open'`,
  );
  return { ...rows[0], ...alerts[0] };
}

async function stockMovementSeries({ brand, from, to, granularity }) {
  const sql = seriesSql(
    granularity,
    `SELECT ${bucketExpr(granularity, "performed_at")} AS bucket,
            SUM(quantity) FILTER (WHERE quantity > 0) AS units_in,
            -SUM(quantity) FILTER (WHERE quantity < 0) AS units_out
       FROM ${t(brand, "stock_movements")}
      WHERE performed_at BETWEEN $1 AND $2
      GROUP BY 1`,
    `COALESCE(a.units_in,0)::int AS units_in, COALESCE(a.units_out,0)::int AS units_out`,
  );
  const { rows } = await query(sql, [from, to]);
  return rows;
}

async function sellThroughByChannel({ brand, from, to }) {
  const { rows } = await query(
    `SELECT COALESCE(sales_channel,'unknown') AS label,
            COALESCE(-SUM(quantity),0)::int AS value
       FROM ${t(brand, "stock_movements")}
      WHERE movement_type = 'sale' AND performed_at BETWEEN $1 AND $2
      GROUP BY 1 ORDER BY value DESC`,
    [from, to],
  );
  return rows;
}

async function topMovingVariants({ brand, from, to, limit = 10 }) {
  const { rows } = await query(
    `SELECT p.name || CASE WHEN v.variant_name IS NOT NULL AND v.variant_name <> ''
                           THEN ' · ' || v.variant_name ELSE '' END AS label,
            v.sku,
            COALESCE(-SUM(m.quantity),0)::int AS value
       FROM ${t(brand, "stock_movements")} m
       JOIN ${t(brand, "product_variants")} v ON v.variant_id = m.variant_id
       JOIN ${t(brand, "products")} p ON p.product_id = v.product_id
      WHERE m.movement_type = 'sale' AND m.performed_at BETWEEN $1 AND $2
      GROUP BY 1, v.sku ORDER BY value DESC LIMIT $3`,
    [from, to, limit],
  );
  return rows;
}

// ── Logistics ──────────────────────────────────────────────

async function logisticsKpis({ brand, from, to }) {
  const { rows } = await query(
    `SELECT
        count(*) FILTER (WHERE status IN ${ACTIVE_DELIVERY_STATES})::int AS active,
        count(*) FILTER (WHERE delivered_at BETWEEN $1 AND $2)::int AS delivered,
        count(*) FILTER (WHERE status = 'attempted_failed')::int AS failed,
        COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (delivered_at - booked_at)) / 3600.0)
          FILTER (WHERE delivered_at BETWEEN $1 AND $2 AND booked_at IS NOT NULL), 1), 0)::float8 AS avg_hours,
        COALESCE(SUM(courier_fee_ngn) FILTER (WHERE booked_at BETWEEN $1 AND $2),0)::text AS fees
       FROM ${t(brand, "deliveries")}`,
    [from, to],
  );
  const { rows: rate } = await query(
    `SELECT count(*) FILTER (WHERE delivered_at IS NOT NULL)::int AS ok,
            count(*) FILTER (WHERE status IN ('attempted_failed','returned_to_sender','lost','damaged'))::int AS bad
       FROM ${t(brand, "deliveries")}
      WHERE COALESCE(delivered_at, booked_at, created_at) BETWEEN $1 AND $2`,
    [from, to],
  );
  const { rows: cod } = await query(
    `SELECT COALESCE(SUM(COALESCE(collected_amount_ngn, expected_amount_ngn)),0)::text AS cod_pending
       FROM ${t(brand, "pay_on_delivery_collections")}
      WHERE status IN ('pending','collected_by_courier')`,
  );
  const { ok, bad } = rate[0];
  return {
    ...rows[0],
    success_rate: ok + bad ? Math.round((ok / (ok + bad)) * 1000) / 10 : null,
    ...cod[0],
  };
}

async function deliveriesSeries({ brand, from, to, granularity }) {
  const sql = seriesSql(
    granularity,
    `SELECT bucket, SUM(booked) AS booked, SUM(delivered) AS delivered FROM (
        SELECT ${bucketExpr(granularity, "booked_at")} AS bucket, 1 AS booked, 0 AS delivered
          FROM ${t(brand, "deliveries")} WHERE booked_at BETWEEN $1 AND $2
        UNION ALL
        SELECT ${bucketExpr(granularity, "delivered_at")} AS bucket, 0, 1
          FROM ${t(brand, "deliveries")} WHERE delivered_at BETWEEN $1 AND $2
      ) u GROUP BY 1`,
    `COALESCE(a.booked,0)::int AS booked, COALESCE(a.delivered,0)::int AS delivered`,
  );
  const { rows } = await query(sql, [from, to]);
  return rows;
}

async function deliveryStatusBreakdown({ brand }) {
  const { rows } = await query(
    `SELECT status AS label, count(*)::int AS value
       FROM ${t(brand, "deliveries")}
      WHERE status IN ${ACTIVE_DELIVERY_STATES} OR status = 'attempted_failed'
      GROUP BY 1 ORDER BY value DESC`,
  );
  return rows;
}

async function courierPerformance({ brand, from, to }) {
  const { rows } = await query(
    `SELECT COALESCE(c.display_name,'Unassigned') AS label,
            count(*)::int AS total,
            count(*) FILTER (WHERE d.delivered_at IS NOT NULL)::int AS delivered,
            count(*) FILTER (WHERE d.status IN ('attempted_failed','returned_to_sender','lost','damaged'))::int AS failed,
            COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (d.delivered_at - d.booked_at)) / 3600.0)
              FILTER (WHERE d.delivered_at IS NOT NULL AND d.booked_at IS NOT NULL), 1), 0)::float8 AS avg_hours,
            COALESCE(SUM(d.courier_fee_ngn),0)::float8 AS fees
       FROM ${t(brand, "deliveries")} d
       LEFT JOIN ${t(brand, "couriers")} c ON c.courier_id = d.courier_id
      WHERE COALESCE(d.booked_at, d.created_at) BETWEEN $1 AND $2
      GROUP BY 1 ORDER BY total DESC`,
    [from, to],
  );
  return rows.map((r) => ({
    ...r,
    success_rate:
      r.delivered + r.failed
        ? Math.round((r.delivered / (r.delivered + r.failed)) * 1000) / 10
        : null,
  }));
}

// ── Marketing ──────────────────────────────────────────────

async function marketingKpis({ brand, from, to }) {
  const { rows: email } = await query(
    `SELECT
        COALESCE(SUM(total_sent),0)::int AS emails_sent,
        COALESCE(ROUND(SUM(total_opened)::numeric / NULLIF(SUM(total_delivered),0) * 100, 1),0)::float8 AS open_rate,
        COALESCE(ROUND(SUM(total_clicked)::numeric / NULLIF(SUM(total_delivered),0) * 100, 1),0)::float8 AS click_rate,
        COALESCE(SUM(conversion_revenue_ngn),0)::text AS email_revenue
       FROM ${t(brand, "email_campaigns")}
      WHERE send_started_at BETWEEN $1 AND $2`,
    [from, to],
  );
  const { rows: ads } = await query(
    `SELECT COALESCE(SUM(s.spend_ngn),0)::text AS ad_spend,
            COALESCE(ROUND(SUM(s.conversion_value_ngn) / NULLIF(SUM(s.spend_ngn),0) * 100, 1),0)::float8 AS roas
       FROM shared.ad_spend_daily s
       JOIN shared.ad_campaigns c ON c.ad_campaign_id = s.ad_campaign_id
      WHERE c.business = $1 AND s.metric_date BETWEEN $2::timestamptz::date AND $3::timestamptz::date`,
    [brand, from, to],
  );
  const { rows: social } = await query(
    `SELECT count(DISTINCT p.post_id) FILTER (WHERE p.published_at BETWEEN $2 AND $3)::int AS posts_published,
            COALESCE(SUM(m.likes + m.comments + m.shares)
              FILTER (WHERE m.metric_date BETWEEN $2::timestamptz::date AND $3::timestamptz::date),0)::int AS social_engagement
       FROM shared.social_posts p
       LEFT JOIN shared.social_post_metrics m ON m.post_id = p.post_id
      WHERE p.business = $1`,
    [brand, from, to],
  );
  return { ...email[0], ...ads[0], ...social[0] };
}

async function emailFunnel({ brand, from, to }) {
  const { rows } = await query(
    `SELECT COALESCE(SUM(total_sent),0)::int AS sent,
            COALESCE(SUM(total_delivered),0)::int AS delivered,
            COALESCE(SUM(total_opened),0)::int AS opened,
            COALESCE(SUM(total_clicked),0)::int AS clicked
       FROM ${t(brand, "email_campaigns")}
      WHERE send_started_at BETWEEN $1 AND $2`,
    [from, to],
  );
  const r = rows[0];
  return [
    { label: "Sent", value: r.sent },
    { label: "Delivered", value: r.delivered },
    { label: "Opened", value: r.opened },
    { label: "Clicked", value: r.clicked },
  ];
}

async function adSpendSeries({ brand, from, to, granularity }) {
  const sql = seriesSql(
    granularity,
    `SELECT ${bucketExprDate(granularity, "s.metric_date")} AS bucket,
            SUM(s.spend_ngn) AS spend, SUM(s.conversion_value_ngn) AS ad_return
       FROM shared.ad_spend_daily s
       JOIN shared.ad_campaigns c ON c.ad_campaign_id = s.ad_campaign_id
      WHERE c.business = $3
        AND s.metric_date BETWEEN $1::timestamptz::date AND $2::timestamptz::date
      GROUP BY 1`,
    `COALESCE(a.spend,0)::float8 AS spend, COALESCE(a.ad_return,0)::float8 AS ad_return`,
  );
  const { rows } = await query(sql, [from, to, brand]);
  return rows;
}

async function engagementByPlatform({ brand, from, to }) {
  const { rows } = await query(
    `SELECT p.platform AS label,
            COALESCE(SUM(m.likes + m.comments + m.shares),0)::int AS value,
            COALESCE(SUM(m.reach),0)::int AS reach
       FROM shared.social_posts p
       JOIN shared.social_post_metrics m ON m.post_id = p.post_id
      WHERE p.business = $1
        AND m.metric_date BETWEEN $2::timestamptz::date AND $3::timestamptz::date
      GROUP BY 1 ORDER BY value DESC`,
    [brand, from, to],
  );
  return rows;
}

async function salesCampaignPerformance({ brand, from, to, limit = 10 }) {
  const { rows } = await query(
    `SELECT sc.name AS label,
            COALESCE(SUM(m.visitors),0)::int AS visitors,
            COALESCE(SUM(m.orders_count),0)::int AS orders,
            COALESCE(SUM(m.revenue_ngn),0)::float8 AS value
       FROM ${t(brand, "sales_campaigns")} sc
       JOIN ${t(brand, "sales_campaign_metrics")} m ON m.campaign_id = sc.campaign_id
      WHERE m.metric_date BETWEEN $1::timestamptz::date AND $2::timestamptz::date
      GROUP BY sc.campaign_id, sc.name ORDER BY value DESC LIMIT $3`,
    [from, to, limit],
  );
  return rows;
}

// ── E-Commerce ─────────────────────────────────────────────

async function ecommerceKpis({ brand, from, to }) {
  const { rows: s } = await query(
    `SELECT count(*)::int AS sessions,
            count(DISTINCT visitor_id)::int AS visitors,
            count(*) FILTER (WHERE converted_order_id IS NOT NULL)::int AS converted
       FROM ${t(brand, "storefront_sessions")}
      WHERE started_at BETWEEN $1 AND $2`,
    [from, to],
  );
  const { rows: o } = await query(
    `SELECT COALESCE(SUM(total_ngn),0)::text AS storefront_revenue,
            count(*)::int AS storefront_orders,
            COALESCE(ROUND(SUM(total_ngn) / NULLIF(count(*),0), 2),0)::text AS aov
       FROM ${t(brand, "sales_orders")}
      WHERE status IN ${REVENUE_STATES} AND sales_channel = 'storefront'
        AND COALESCE(placed_at, created_at) BETWEEN $1 AND $2`,
    [from, to],
  );
  const { sessions, visitors, converted } = s[0];
  return {
    sessions,
    visitors,
    conversion_rate: sessions ? Math.round((converted / sessions) * 1000) / 10 : null,
    ...o[0],
  };
}

async function sessionsSeries({ brand, from, to, granularity }) {
  const sql = seriesSql(
    granularity,
    `SELECT ${bucketExpr(granularity, "started_at")} AS bucket,
            count(*) AS sessions,
            count(*) FILTER (WHERE converted_order_id IS NOT NULL) AS orders
       FROM ${t(brand, "storefront_sessions")}
      WHERE started_at BETWEEN $1 AND $2
      GROUP BY 1`,
    `COALESCE(a.sessions,0)::int AS sessions, COALESCE(a.orders,0)::int AS orders`,
  );
  const { rows } = await query(sql, [from, to]);
  return rows;
}

async function checkoutFunnel({ brand, from, to }) {
  const { rows } = await query(
    `SELECT
        count(DISTINCT session_id) FILTER (WHERE event_type = 'view_product')::int AS viewed,
        count(DISTINCT session_id) FILTER (WHERE event_type = 'add_to_cart')::int AS carted,
        count(DISTINCT session_id) FILTER (WHERE event_type = 'start_checkout')::int AS checkout,
        count(DISTINCT session_id) FILTER (WHERE event_type = 'complete_order')::int AS completed
       FROM ${t(brand, "storefront_funnel_events")}
      WHERE occurred_at BETWEEN $1 AND $2`,
    [from, to],
  );
  const r = rows[0];
  return [
    { label: "Viewed Product", value: r.viewed },
    { label: "Added to Cart", value: r.carted },
    { label: "Started Checkout", value: r.checkout },
    { label: "Completed Order", value: r.completed },
  ];
}

async function currencyBreakdown({ brand, from, to }) {
  const { rows } = await query(
    `SELECT COALESCE(display_currency,'NGN') AS label,
            count(*)::int AS orders,
            COALESCE(SUM(total_ngn),0)::float8 AS value
       FROM ${t(brand, "sales_orders")}
      WHERE status IN ${REVENUE_STATES} AND sales_channel = 'storefront'
        AND COALESCE(placed_at, created_at) BETWEEN $1 AND $2
      GROUP BY 1 ORDER BY value DESC`,
    [from, to],
  );
  return rows;
}

async function deviceBreakdown({ brand, from, to }) {
  const { rows } = await query(
    `SELECT COALESCE(device_type,'unknown') AS label, count(*)::int AS value
       FROM ${t(brand, "storefront_sessions")}
      WHERE started_at BETWEEN $1 AND $2
      GROUP BY 1 ORDER BY value DESC`,
    [from, to],
  );
  return rows;
}

async function topTrafficSources({ brand, from, to, limit = 10 }) {
  const { rows } = await query(
    `SELECT COALESCE(NULLIF(TRIM(utm_source),''),
              CASE WHEN referrer IS NULL OR referrer = '' THEN 'direct' ELSE 'referral' END) AS label,
            count(*)::int AS sessions,
            count(*) FILTER (WHERE converted_order_id IS NOT NULL)::int AS conversions
       FROM ${t(brand, "storefront_sessions")}
      WHERE started_at BETWEEN $1 AND $2
      GROUP BY 1 ORDER BY sessions DESC LIMIT $3`,
    [from, to, limit],
  );
  return rows;
}

// ── Retention ──────────────────────────────────────────────

async function retentionKpis({ brand, from, to }) {
  const { rows: pts } = await query(
    `SELECT COALESCE(SUM(points) FILTER (WHERE points > 0),0)::int AS points_issued,
            COALESCE(-SUM(points) FILTER (WHERE transaction_type = 'redeemed'),0)::int AS points_redeemed
       FROM shared.loyalty_ledger
      WHERE business = $1 AND created_at BETWEEN $2 AND $3`,
    [brand, from, to],
  );
  const { rows: members } = await query(
    `SELECT count(*)::int AS loyalty_members
       FROM shared.customer_loyalty_state
      WHERE business = $1 AND current_balance > 0`,
    [brand],
  );
  const { rows: refs } = await query(
    `SELECT count(*)::int AS referral_conversions,
            COALESCE(SUM(triggering_order_value),0)::text AS referral_revenue
       FROM shared.referral_redemptions
      WHERE business = $1 AND status IN ('pending','rewarded')
        AND created_at BETWEEN $2 AND $3`,
    [brand, from, to],
  );
  const { rows: subs } = await query(
    `SELECT
        (SELECT count(*) FROM shared.subscriptions
          WHERE business = $1 AND status = 'active')::int
      + (SELECT count(*) FROM ${t(brand, "maintenance_subscriptions")}
          WHERE status = 'active')::int AS active_subscriptions`,
    [brand],
  );
  const { rows: subRev } = await query(
    `SELECT COALESCE(SUM(total_ngn),0)::text AS subscription_revenue
       FROM ${t(brand, "sales_orders")}
      WHERE status IN ${REVENUE_STATES} AND subscription_id IS NOT NULL
        AND COALESCE(placed_at, created_at) BETWEEN $1 AND $2`,
    [from, to],
  );
  const { rows: coup } = await query(
    `SELECT count(*)::int AS coupons_redeemed
       FROM shared.coupon_redemptions
      WHERE business = $1 AND redeemed_at BETWEEN $2 AND $3`,
    [brand, from, to],
  );
  return {
    ...pts[0],
    ...members[0],
    ...refs[0],
    ...subs[0],
    ...subRev[0],
    ...coup[0],
  };
}

async function pointsSeries({ brand, from, to, granularity }) {
  const sql = seriesSql(
    granularity,
    `SELECT ${bucketExpr(granularity, "created_at")} AS bucket,
            SUM(points) FILTER (WHERE points > 0) AS earned,
            -SUM(points) FILTER (WHERE transaction_type = 'redeemed') AS redeemed
       FROM shared.loyalty_ledger
      WHERE business = $3 AND created_at BETWEEN $1 AND $2
      GROUP BY 1`,
    `COALESCE(a.earned,0)::int AS earned, COALESCE(a.redeemed,0)::int AS redeemed`,
  );
  const { rows } = await query(sql, [from, to, brand]);
  return rows;
}

async function tierDistribution({ brand }) {
  const { rows } = await query(
    `SELECT COALESCE(t.tier_name,'No tier') AS label, count(*)::int AS value
       FROM shared.customer_loyalty_state s
       LEFT JOIN shared.loyalty_tiers t ON t.tier_id = s.current_tier_id
      WHERE s.business = $1
      GROUP BY t.tier_name, t.display_order
      ORDER BY t.display_order NULLS LAST`,
    [brand],
  );
  return rows;
}

async function topCoupons({ brand, from, to, limit = 10 }) {
  const { rows } = await query(
    `SELECT c.coupon_code AS label, count(*)::int AS uses,
            COALESCE(SUM(r.discount_applied),0)::float8 AS value
       FROM shared.coupon_redemptions r
       JOIN shared.coupons c ON c.coupon_id = r.coupon_id
      WHERE r.business = $1 AND r.redeemed_at BETWEEN $2 AND $3
      GROUP BY c.coupon_code ORDER BY uses DESC LIMIT $4`,
    [brand, from, to, limit],
  );
  return rows;
}

async function topReferrers({ brand, from, to, limit = 10 }) {
  const { rows } = await query(
    `SELECT c.display_name AS label, count(rr.redemption_id)::int AS conversions,
            COALESCE(SUM(rr.triggering_order_value),0)::text AS revenue
       FROM shared.referral_redemptions rr
       JOIN shared.referrals r ON r.referral_id = rr.referral_id
       JOIN shared.contacts c ON c.contact_id = r.contact_id
      WHERE rr.business = $1 AND rr.status IN ('pending','rewarded')
        AND rr.created_at BETWEEN $2 AND $3
      GROUP BY c.display_name ORDER BY conversions DESC LIMIT $4`,
    [brand, from, to, limit],
  );
  return rows;
}

// ── HR ─────────────────────────────────────────────────────

async function hrKpis({ brand, from, to }) {
  const { rows: hc } = await query(
    `SELECT count(*)::int AS headcount
       FROM shared.staff_profiles
      WHERE business = $1 AND is_deleted = false
        AND (end_date IS NULL OR end_date >= CURRENT_DATE)`,
    [brand],
  );
  const { rows: today } = await query(
    `SELECT count(DISTINCT e.profile_id)::int AS attendance_today
       FROM shared.staff_clock_events e
       JOIN shared.staff_profiles sp ON sp.profile_id = e.profile_id AND sp.business = $1
      WHERE e.event_type = 'clock_in' AND e.accepted = true
        AND (e.occurred_at AT TIME ZONE ${TZ})::date = (now() AT TIME ZONE ${TZ})::date`,
    [brand],
  );
  const { rows: att } = await query(
    `SELECT COALESCE(ROUND(AVG(cnt), 1), 0)::float8 AS avg_daily_present
       FROM (
         SELECT (e.occurred_at AT TIME ZONE ${TZ})::date AS d,
                count(DISTINCT e.profile_id)::numeric AS cnt
           FROM shared.staff_clock_events e
           JOIN shared.staff_profiles sp ON sp.profile_id = e.profile_id AND sp.business = $1
          WHERE e.event_type = 'clock_in' AND e.accepted = true
            AND e.occurred_at BETWEEN $2 AND $3
          GROUP BY 1
       ) daily`,
    [brand, from, to],
  );
  const { rows: leave } = await query(
    `SELECT count(*)::int AS leave_pending
       FROM shared.leave_requests lr
       JOIN shared.staff_profiles sp ON sp.profile_id = lr.profile_id AND sp.business = $1
      WHERE lr.status = 'pending'`,
    [brand],
  );
  const { rows: pr } = await query(
    `SELECT total_net_ngn::text AS payroll_last_net, run_number, status, pay_month, pay_year
       FROM ${t(brand, "payroll_runs")}
      ORDER BY pay_year DESC, pay_month DESC LIMIT 1`,
  );
  const { rows: comm } = await query(
    `SELECT COALESCE(SUM(commission_amount_ngn),0)::text AS commissions
       FROM ${t(brand, "commission_earned")}
      WHERE status IN ('accrued','approved','paid') AND earned_at BETWEEN $1 AND $2`,
    [from, to],
  );
  const headcount = hc[0].headcount;
  const avgPresent = att[0] ? Number(att[0].avg_daily_present) : 0;
  return {
    headcount,
    attendance_today: today[0].attendance_today,
    avg_attendance: headcount
      ? Math.round((avgPresent / headcount) * 1000) / 10
      : null,
    ...leave[0],
    payroll_last_net: pr[0] ? pr[0].payroll_last_net : null,
    payroll_last_label: pr[0] ? `${pr[0].pay_year}-${String(pr[0].pay_month).padStart(2, "0")} (${pr[0].status})` : null,
    ...comm[0],
  };
}

async function attendanceSeries({ brand, from, to, granularity }) {
  const sql = seriesSql(
    granularity,
    `SELECT ${bucketExpr(granularity, "e.occurred_at")} AS bucket,
            count(DISTINCT e.profile_id) AS present
       FROM shared.staff_clock_events e
       JOIN shared.staff_profiles sp ON sp.profile_id = e.profile_id AND sp.business = $3
      WHERE e.event_type = 'clock_in' AND e.accepted = true
        AND e.occurred_at BETWEEN $1 AND $2
      GROUP BY 1`,
    `COALESCE(a.present,0)::int AS present`,
  );
  const { rows } = await query(sql, [from, to, brand]);
  return rows;
}

async function payrollTrend({ brand, limit = 6 }) {
  const { rows } = await query(
    `SELECT run_number, pay_year, pay_month, status,
            total_gross_ngn::float8 AS gross, total_net_ngn::float8 AS net
       FROM ${t(brand, "payroll_runs")}
      ORDER BY pay_year DESC, pay_month DESC LIMIT $1`,
    [limit],
  );
  return rows
    .reverse()
    .map((r) => ({
      label: `${r.pay_year}-${String(r.pay_month).padStart(2, "0")}`,
      gross: r.gross,
      net: r.net,
      status: r.status,
    }));
}

async function commissionsByStaff({ brand, from, to, limit = 10 }) {
  const { rows } = await query(
    `SELECT COALESCE(c.display_name, 'Unknown') AS label,
            COALESCE(SUM(ce.commission_amount_ngn),0)::float8 AS value
       FROM ${t(brand, "commission_earned")} ce
       LEFT JOIN shared.users u ON u.user_id = ce.user_id
       LEFT JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
       LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
      WHERE ce.status IN ('accrued','approved','paid')
        AND ce.earned_at BETWEEN $1 AND $2
      GROUP BY 1 ORDER BY value DESC LIMIT $3`,
    [from, to, limit],
  );
  return rows;
}

// ── Overview extras ────────────────────────────────────────

async function overviewCounters({ brand }) {
  const { rows: wf } = await query(
    `SELECT count(*)::int AS pending_approvals
       FROM shared.workflow_instances
      WHERE business = $1 AND status = 'pending'`,
    [brand],
  );
  const { rows: inv } = await query(
    `SELECT count(*)::int AS overdue_invoices
       FROM ${t(brand, "invoices")}
      WHERE status NOT IN ('paid','void','refunded')
        AND balance_due_ngn > 0 AND due_date < CURRENT_DATE`,
  );
  const { rows: st } = await query(
    `SELECT count(*)::int AS low_stock_alerts
       FROM ${t(brand, "stock_alerts")} WHERE status = 'open'`,
  );
  const { rows: dl } = await query(
    `SELECT count(*)::int AS active_deliveries
       FROM ${t(brand, "deliveries")} WHERE status IN ${ACTIVE_DELIVERY_STATES}`,
  );
  const { rows: sj } = await query(
    `SELECT count(*)::int AS open_service_jobs
       FROM ${t(brand, "service_jobs")}
      WHERE status IN ('pending','in_progress')`,
  );
  return { ...wf[0], ...inv[0], ...st[0], ...dl[0], ...sj[0] };
}

async function pendingApprovalsList({ brand, limit = 10 }) {
  const { rows } = await query(
    `SELECT wi.instance_id, wd.name AS workflow, wi.reference_table,
            wi.current_stage, wi.initiated_at,
            c.display_name AS initiated_by
       FROM shared.workflow_instances wi
       JOIN shared.workflow_definitions wd ON wd.workflow_id = wi.workflow_id
       LEFT JOIN shared.users u ON u.user_id = wi.initiated_by
       LEFT JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
       LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
      WHERE wi.business = $1 AND wi.status = 'pending'
      ORDER BY wi.initiated_at DESC LIMIT $2`,
    [brand, limit],
  );
  return rows;
}

module.exports = {
  REVENUE_STATES,
  GRANULARITIES,
  // sales
  salesKpis,
  revenueSeries,
  salesChannelBreakdown,
  topProducts,
  paymentMethodBreakdown,
  cashCollected,
  // customers
  customerKpis,
  newCustomersSeries,
  pipelineByStage,
  acquisitionBySource,
  churnBands,
  topCustomers,
  // finance
  financeKpis,
  incomeExpenseSeries,
  arAgeing,
  expensesByCategory,
  // stock
  stockKpis,
  stockMovementSeries,
  sellThroughByChannel,
  topMovingVariants,
  // logistics
  logisticsKpis,
  deliveriesSeries,
  deliveryStatusBreakdown,
  courierPerformance,
  // marketing
  marketingKpis,
  emailFunnel,
  adSpendSeries,
  engagementByPlatform,
  salesCampaignPerformance,
  // ecommerce
  ecommerceKpis,
  sessionsSeries,
  checkoutFunnel,
  currencyBreakdown,
  deviceBreakdown,
  topTrafficSources,
  // retention
  retentionKpis,
  pointsSeries,
  tierDistribution,
  topCoupons,
  topReferrers,
  // hr
  hrKpis,
  attendanceSeries,
  payrollTrend,
  commissionsByStaff,
  // overview
  overviewCounters,
  pendingApprovalsList,
};
