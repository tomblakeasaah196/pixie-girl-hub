/**
 * Churn-risk scoring sweep (V2.2 §6.1 CRM + §6.23 Retention).
 * Runs nightly (02:45 Africa/Lagos).
 *
 * Fills {brand}.churn_risk_scores — the table the schema always promised a
 * cron would compute ("periodically computed by a cron job") but nothing did.
 * A deliberately SIMPLE, explainable recency rule, not a model:
 *
 *   expected gap = the customer's own average days-between-orders
 *                  (first-time buyers fall back to 45 days, floor 30)
 *   drift        = days_since_last_order / expected gap
 *   score        = drift × 35, clamped 0..100
 *                  → on-cycle ≈ 35 (low) · 2× overdue ≈ 70 (high)
 *                  → 2.4× overdue ≈ 85 (critical)
 *
 * Absolute floors keep slow-cadence shops honest: 90+ days silent is at
 * least HIGH, 180+ days is CRITICAL; a purchase in the last 14 days caps
 * the score at 30 so frequent buyers never false-alarm.
 *
 * Bands follow the schema's contract: >=85 critical, >=70 high, >=40 medium.
 *
 * Write policy: a new score row is inserted only when the band CHANGED, no
 * current score exists, or the current one is older than 7 days (weekly
 * numeric refresh). Prior rows get superseded_at; a high/critical row whose
 * customer came back to `low` is stamped recovered_at.
 */

"use strict";

const { query } = require("../../config/database");
const { logger } = require("../../config/logger");
const { BRANDS, t } = require("../../config/brands");
const { COUNTED_ORDER_STATUSES } = require("../../modules/retention/strategy.facts");

const FALLBACK_GAP_DAYS = 45; // single-purchase customers: assumed cycle
const MIN_GAP_DAYS = 30; // never expect faster than monthly
const DRIFT_SCALE = 35; // drift 1.0 → score 35
const FRESH_PURCHASE_DAYS = 14; // bought recently → cap at low
const HIGH_FLOOR_DAYS = 90; // schema reason code 'no_purchase_90d'
const CRITICAL_FLOOR_DAYS = 180;
const REFRESH_AGE_DAYS = 7; // re-write unchanged bands weekly

function bandOf(score) {
  if (score >= 85) return "critical";
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

/**
 * Pure recency rule — exported for unit tests.
 * @param {{days_since_last_order:number, avg_gap_days:number|null, total_orders:number}} f
 * @returns {{risk_score:number, risk_band:string, reasons:string[]}}
 */
function scoreRecency({ days_since_last_order, avg_gap_days, total_orders }) {
  const days = Math.max(0, Number(days_since_last_order) || 0);
  const gap = Math.max(Number(avg_gap_days) || FALLBACK_GAP_DAYS, MIN_GAP_DAYS);
  const drift = days / gap;

  let score = Math.round(drift * DRIFT_SCALE);
  if (days >= CRITICAL_FLOOR_DAYS) score = Math.max(score, 85);
  else if (days >= HIGH_FLOOR_DAYS) score = Math.max(score, 70);
  if (days <= FRESH_PURCHASE_DAYS) score = Math.min(score, 30);
  score = Math.min(Math.max(score, 0), 100);

  const reasons = [];
  if (days >= CRITICAL_FLOOR_DAYS) reasons.push("no_purchase_180d");
  else if (days >= HIGH_FLOOR_DAYS) reasons.push("no_purchase_90d");
  if (drift >= 2 && days > FRESH_PURCHASE_DAYS)
    reasons.push("ordering_gap_stretched");
  if (Number(total_orders) === 1 && days >= 60)
    reasons.push("single_purchase_lapsing");

  return { risk_score: score, risk_band: bandOf(score), reasons };
}

/** Per-contact order aggregates joined to the current (un-superseded) score. */
async function fetchCandidates(brand) {
  const { rows } = await query(
    `WITH agg AS (
       SELECT o.contact_id,
              COUNT(*)::int AS total_orders,
              COALESCE(SUM(o.total_ngn), 0)::numeric(14,2) AS lifetime_value_ngn,
              MAX(o.placed_at) AS last_order_at,
              CASE WHEN COUNT(*) > 1 THEN
                ROUND((EXTRACT(EPOCH FROM (MAX(o.placed_at) - MIN(o.placed_at)))
                       / 86400.0 / (COUNT(*) - 1))::numeric, 2)
              END AS avg_gap_days
         FROM ${t(brand, "sales_orders")} o
        WHERE o.contact_id IS NOT NULL
          AND o.placed_at IS NOT NULL
          AND o.status = ANY($1)
        GROUP BY o.contact_id
     ),
     cur AS (
       SELECT DISTINCT ON (contact_id)
              contact_id, score_id, risk_band, computed_at
         FROM ${t(brand, "churn_risk_scores")}
        WHERE superseded_at IS NULL
        ORDER BY contact_id, computed_at DESC
     )
     SELECT agg.contact_id, agg.total_orders, agg.lifetime_value_ngn,
            agg.avg_gap_days,
            GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - agg.last_order_at)) / 86400))::int
              AS days_since_last_order,
            cur.score_id AS current_score_id,
            cur.risk_band AS current_band,
            cur.computed_at AS current_computed_at
       FROM agg
       LEFT JOIN cur ON cur.contact_id = agg.contact_id`,
    [COUNTED_ORDER_STATUSES],
  );
  return rows;
}

async function writeScore(brand, c, computed) {
  // A customer who was high/critical and is now low has come back.
  const recovered =
    computed.risk_band === "low" &&
    (c.current_band === "high" || c.current_band === "critical");
  await query(
    `UPDATE ${t(brand, "churn_risk_scores")}
        SET superseded_at = now(),
            recovered_at = CASE WHEN score_id = $2 AND $3 THEN now() ELSE recovered_at END
      WHERE contact_id = $1 AND superseded_at IS NULL`,
    [c.contact_id, c.current_score_id, recovered],
  );
  await query(
    `INSERT INTO ${t(brand, "churn_risk_scores")}
       (contact_id, risk_score, risk_band, reasons, days_since_last_order,
        lifetime_value_ngn, total_orders, average_days_between_orders)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      c.contact_id,
      computed.risk_score,
      computed.risk_band,
      computed.reasons,
      c.days_since_last_order,
      c.lifetime_value_ngn,
      c.total_orders,
      c.avg_gap_days,
    ],
  );
}

async function runChurnRiskScoring() {
  const staleMs = REFRESH_AGE_DAYS * 86_400_000;
  let written = 0;
  let scanned = 0;
  for (const brand of BRANDS) {
    let candidates;
    try {
      candidates = await fetchCandidates(brand);
    } catch (err) {
      // Brand schema without sales/churn tables (partial bootstrap) — skip.
      logger.error({ err: err.message, brand }, "churn scoring query failed");
      continue;
    }
    scanned += candidates.length;
    for (const c of candidates) {
      const computed = scoreRecency(c);
      const fresh =
        c.current_computed_at &&
        Date.now() - new Date(c.current_computed_at).getTime() < staleMs;
      if (c.current_band === computed.risk_band && fresh) continue;
      try {
        await writeScore(brand, c, computed);
        written += 1;
      } catch (err) {
        logger.error(
          { err: err.message, brand, contact_id: c.contact_id },
          "churn score write failed",
        );
      }
    }
  }
  logger.info({ scanned, written }, "churn-risk scoring sweep done");
  return { scanned, written };
}

module.exports = { runChurnRiskScoring, scoreRecency };
