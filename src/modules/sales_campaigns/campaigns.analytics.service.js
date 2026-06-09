/**
 * Sales Campaigns — ANALYTICS (V2.2 §6.22 real-time dashboard + §6.30).
 *
 * Rolls the storefront funnel (storefront_sessions + storefront_funnel_events,
 * tagged by utm_campaign = slug) and order revenue (sales_orders by
 * sales_campaign_id) into:
 *   - the denormalised rollups on sales_campaigns (the live ticker)
 *   - an hourly snapshot row in sales_campaign_metrics
 * then emits `metrics_updated` so the realtime relay can broadcast on
 * brand:{brand}:campaign:{id}.
 */

"use strict";

const { query, transaction } = require("../../config/database");
const events = require("./campaigns.events");
const { logger } = require("../../config/logger");

const { VALID_BRANDS } = require("../../config/brands");
function t(brand, table) {
  if (!VALID_BRANDS.has(brand)) throw new Error(`Invalid brand: ${brand}`);
  return `${brand}.${table}`;
}

// Order statuses that count as recognised campaign revenue.
const SOLD_STATUSES = [
  "paid",
  "awaiting_dispatch",
  "in_production",
  "with_stylist",
  "ready_for_dispatch",
  "dispatched",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "completed",
];

async function computeMetrics({ client, brand, campaign }) {
  const run = client ? client.query.bind(client) : query;
  const slug = campaign.slug;
  const id = campaign.campaign_id;

  // Visitors & engagement from the storefront funnel (by utm_campaign).
  const { rows: vis } = await run(
    `SELECT
        COUNT(DISTINCT s.session_id)::int                          AS visitors,
        COUNT(DISTINCT s.visitor_id)::int                          AS unique_visitors,
        COALESCE(SUM(CASE WHEN e.event_type = 'add_to_cart' THEN 1 ELSE 0 END),0)::int    AS add_to_cart,
        COALESCE(SUM(CASE WHEN e.event_type = 'start_checkout' THEN 1 ELSE 0 END),0)::int AS checkout_started
       FROM ${t(brand, "storefront_sessions")} s
       LEFT JOIN ${t(brand, "storefront_funnel_events")} e ON e.session_id = s.session_id
      WHERE s.utm_campaign = $1`,
    [slug],
  );

  // Orders & revenue from the canonical order record (by campaign id).
  const { rows: ord } = await run(
    `SELECT
        COUNT(*)::int                          AS orders_count,
        COALESCE(SUM(total_ngn),0)             AS revenue_ngn,
        COALESCE(SUM(discount_amount_ngn),0)   AS discount_given_ngn
       FROM ${t(brand, "sales_orders")}
      WHERE sales_campaign_id = $1 AND status = ANY($2::text[])`,
    [id, SOLD_STATUSES],
  );

  const v = vis[0];
  const o = ord[0];
  const unique = v.unique_visitors || 0;
  const orders = o.orders_count || 0;
  const revenue = Number(o.revenue_ngn) || 0;
  return {
    visitors: v.visitors || 0,
    unique_visitors: unique,
    add_to_cart: v.add_to_cart || 0,
    checkout_started: v.checkout_started || 0,
    orders_count: orders,
    revenue_ngn: revenue,
    discount_given_ngn: Number(o.discount_given_ngn) || 0,
    average_order_value_ngn:
      orders > 0 ? Number((revenue / orders).toFixed(2)) : 0,
    conversion_rate_pct: unique > 0 ? Number((orders / unique).toFixed(4)) : 0,
    add_to_cart_rate_pct:
      unique > 0 ? Number(((v.add_to_cart || 0) / unique).toFixed(4)) : 0,
  };
}

/**
 * Recompute one campaign's metrics, persist rollups + an hourly snapshot,
 * and emit `metrics_updated`. Safe to call repeatedly (idempotent upsert).
 */
async function rollupCampaign({ brand, campaign_id }) {
  return transaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM ${t(brand, "sales_campaigns")} WHERE campaign_id = $1`,
      [campaign_id],
    );
    const campaign = rows[0];
    if (!campaign) return null;

    const m = await computeMetrics({ client, brand, campaign });

    // Update the denormalised rollups (powers the live ticker).
    await client.query(
      `UPDATE ${t(brand, "sales_campaigns")}
          SET total_visitors = $2,
              total_unique_visitors = $3,
              total_add_to_cart = $4,
              total_orders = $5,
              total_revenue_ngn = $6,
              total_discount_given_ngn = $7
        WHERE campaign_id = $1`,
      [
        campaign_id,
        m.visitors,
        m.unique_visitors,
        m.add_to_cart,
        m.orders_count,
        m.revenue_ngn,
        m.discount_given_ngn,
      ],
    );

    // Hourly snapshot (schema: hourly while live, daily once ended).
    const hour = new Date().getHours();
    await client.query(
      `INSERT INTO ${t(brand, "sales_campaign_metrics")}
         (campaign_id, metric_date, metric_hour, visitors, unique_visitors,
          add_to_cart, checkout_started, orders_count, units_sold, revenue_ngn,
          discount_given_ngn, average_order_value_ngn, conversion_rate_pct,
          add_to_cart_rate_pct, refreshed_at)
       VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11, $12, now())
       ON CONFLICT (campaign_id, metric_date, metric_hour) DO UPDATE SET
         visitors = EXCLUDED.visitors,
         unique_visitors = EXCLUDED.unique_visitors,
         add_to_cart = EXCLUDED.add_to_cart,
         checkout_started = EXCLUDED.checkout_started,
         orders_count = EXCLUDED.orders_count,
         revenue_ngn = EXCLUDED.revenue_ngn,
         discount_given_ngn = EXCLUDED.discount_given_ngn,
         average_order_value_ngn = EXCLUDED.average_order_value_ngn,
         conversion_rate_pct = EXCLUDED.conversion_rate_pct,
         add_to_cart_rate_pct = EXCLUDED.add_to_cart_rate_pct,
         refreshed_at = now()`,
      [
        campaign_id,
        hour,
        m.visitors,
        m.unique_visitors,
        m.add_to_cart,
        m.checkout_started,
        m.orders_count,
        m.revenue_ngn,
        m.discount_given_ngn,
        m.average_order_value_ngn,
        m.conversion_rate_pct,
        m.add_to_cart_rate_pct,
      ],
    );

    events.emit("metrics_updated", { brand, id: campaign_id, metrics: m });
    return m;
  });
}

/** Roll up every currently-live campaign across both brands. */
async function rollupAllLive() {
  let count = 0;
  for (const brand of VALID_BRANDS) {
    const { rows } = await query(
      `SELECT campaign_id FROM ${t(brand, "sales_campaigns")} WHERE status = 'live'`,
    );
    for (const r of rows) {
      try {
        await rollupCampaign({ brand, campaign_id: r.campaign_id });
        count++;
      } catch (err) {
        logger.error(
          { err, brand, campaign_id: r.campaign_id },
          "campaign rollup failed",
        );
      }
    }
  }
  return count;
}

module.exports = { rollupCampaign, rollupAllLive, computeMetrics };
