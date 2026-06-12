/**
 * Low-stock alert sweep (J-1 / Tier-1 AI insight, PD §6.9).
 * Runs twice daily (08:00, 14:00 Africa/Lagos).
 *
 * Deterministic rules over stock_levels + product_variants.reorder_point: any
 * active variant whose on_hand has fallen to or below its reorder point raises
 * an idempotent stock insight (deduped on (business, suppression_key), so the
 * twice-daily tick never spams a duplicate while one alert is open).
 */

"use strict";

const { query } = require("../../config/database");
const { logger } = require("../../config/logger");
const insights = require("../../modules/ai_insights/insights.service");

const { BRANDS } = require("../../config/brands");

function severityFor(onHand, reorderPoint) {
  if (onHand <= 0) return "critical";
  if (onHand * 2 <= reorderPoint) return "high";
  return "medium";
}

async function runLowStockAlerts() {
  let raised = 0;
  for (const brand of BRANDS) {
    let rows = [];
    try {
      const res = await query(
        `SELECT sl.variant_id, sl.location_id, sl.on_hand,
                pv.reorder_point, pv.product_id
           FROM ${brand}.stock_levels sl
           JOIN ${brand}.product_variants pv ON pv.variant_id = sl.variant_id
          WHERE pv.is_active = true
            AND pv.reorder_point > 0
            AND sl.on_hand <= pv.reorder_point`,
      );
      rows = res.rows;
    } catch (err) {
      logger.error({ err: err.message, brand }, "low-stock query failed");
      continue;
    }

    for (const r of rows) {
      try {
        await insights.raise({
          category: "stock",
          row: {
            business: brand,
            product_id: r.product_id,
            variant_id: r.variant_id,
            stock_location_id: r.location_id,
            current_stock: r.on_hand,
            reorder_point: r.reorder_point,
            daily_velocity: null,
            projected_days_left: null,
            severity: severityFor(r.on_hand, r.reorder_point),
            suppression_key: `${r.variant_id}:${r.location_id}:low_stock`,
          },
        });
        raised += 1;
      } catch (err) {
        logger.error(
          { err: err.message, brand, variant_id: r.variant_id },
          "low-stock raise failed",
        );
      }
    }
  }
  logger.info({ raised }, "low-stock alerts swept");
  return { raised };
}

module.exports = { runLowStockAlerts };
