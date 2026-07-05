/**
 * Stock insight sweep (J-1 / Tier-1, PD §6.9 + §6.30).
 * Runs twice daily (08:00, 14:00 Africa/Lagos).
 *
 * Two deterministic signals over stock_levels + product_variants:
 *   - reorder_point   — on_hand at/below the variant's reorder point
 *                       (medium; high at half the reorder point; critical at 0)
 *   - negative_stock  — on_hand below zero: a count-integrity red flag that
 *                       means oversell or a missed movement (always critical)
 *
 * Writes unified insights (idempotent on the open-suppression key, so the
 * twice-daily tick never duplicates an open alert), AUTO-RESOLVES the brand's
 * stale stock findings whose condition cleared (restocked / corrected) — the
 * sweep's auto-resolve deliberately skips 'stock' because this scheduler owns
 * it — pings the CEO's bell for genuinely-new critical findings, and nudges
 * the brand's realtime room so open screens refresh.
 */

"use strict";

const { query } = require("../../config/database");
const { logger } = require("../../config/logger");
const insights = require("../../modules/ai_insights/insights.service");
const insightsRepo = require("../../modules/ai_insights/insights.repo");
const events = require("../../modules/ai_insights/insights.events");

const { BRANDS } = require("../../config/brands");

function reorderSeverity(onHand, reorderPoint) {
  if (onHand <= 0) return "critical";
  if (onHand * 2 <= reorderPoint) return "high";
  return "medium";
}

function toInsight(brand, r) {
  const onHand = Number(r.on_hand) || 0;
  const negative = onHand < 0;
  const label = r.sku || r.variant_id;
  return {
    module: "stock",
    detector: negative ? "negative_stock" : "reorder_point",
    business: brand,
    severity: negative ? "critical" : reorderSeverity(onHand, r.reorder_point),
    title: negative
      ? `${label} has negative stock (${onHand}) — count needs correction`
      : onHand === 0
        ? `${label} is out of stock (reorder at ${r.reorder_point})`
        : `${label} low: ${onHand} left (reorder at ${r.reorder_point})`,
    body: null,
    context: {
      product_id: r.product_id,
      variant_id: r.variant_id,
      stock_location_id: r.location_id,
      current_stock: onHand,
      reorder_point: r.reorder_point,
    },
    amount_ngn: null,
    source_table: "stock_levels",
    source_id: r.variant_id,
    drill_route: "/stock",
    // reorder keeps the pre-existing key shape so alerts already open in
    // production are not duplicated by this version.
    suppression_key: negative
      ? `${r.variant_id}:${r.location_id}:negative`
      : `${r.variant_id}:${r.location_id}:low_stock`,
  };
}

async function runLowStockAlerts() {
  let raised = 0;
  let resolved = 0;
  const created = [];
  for (const brand of BRANDS) {
    let rows = [];
    try {
      const res = await query(
        `SELECT sl.variant_id, sl.location_id, sl.on_hand,
                pv.reorder_point, pv.product_id, pv.sku
           FROM ${brand}.stock_levels sl
           JOIN ${brand}.product_variants pv ON pv.variant_id = sl.variant_id
          WHERE pv.is_active = true
            AND (sl.on_hand < 0
                 OR (pv.reorder_point > 0 AND sl.on_hand <= pv.reorder_point))`,
      );
      rows = res.rows;
    } catch (err) {
      // Query failed → skip raise AND auto-resolve for this brand, so a
      // transient error never wipes the brand's live alerts.
      logger.error({ err: err.message, brand }, "stock insight query failed");
      continue;
    }

    const liveKeys = [];
    for (const r of rows) {
      const insight = toInsight(brand, r);
      liveKeys.push(insight.suppression_key);
      try {
        const row = await insights.raiseInsight(insight);
        if (row) {
          created.push(row);
          raised += 1;
        }
      } catch (err) {
        logger.error(
          { err: err.message, brand, variant_id: r.variant_id },
          "stock insight raise failed",
        );
      }
    }

    // Condition cleared (restocked / count corrected) → close the flag.
    try {
      resolved += await insightsRepo.autoResolveStale({
        module: "stock",
        business: brand,
        liveKeys,
      });
    } catch (err) {
      logger.error({ err: err.message, brand }, "stock auto-resolve failed");
    }

    // Nudge the brand's realtime room so the Stock card + Center refresh.
    events.emit("insight.updated", { business: brand, status: "swept" });
  }

  // New criticals (out-of-stock / negative counts) hit the CEO's bell.
  try {
    await insights.notifyUrgent(created);
  } catch (err) {
    logger.error({ err: err.message }, "stock insight notify failed");
  }

  logger.info({ raised, resolved }, "stock insight sweep done");
  return { raised, resolved };
}

module.exports = { runLowStockAlerts };
