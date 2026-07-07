/**
 * Appraisal auto-scoring engine (V2.2 §6.11, PR-B).
 *
 * Fills a cycle's KPI scores from real HR data for every active staff member,
 * so managers start from evidence instead of a blank grid:
 *   clock_in_data → on-time %      → banded 1–5
 *   sales_data    → target attainment %  → banded 1–5
 *   service_job_ratings → avg QC rating  → 1–5 (already on scale)
 *   customer_ratings    → avg customer rating → 1–5
 *
 * Design choices (confirmed with the product owner):
 *   - Sensible default bands per source, overridable per KPI via
 *     `auto_score_config.bands`; rating sources pass the average straight
 *     through (clamped to the KPI scale).
 *   - Auto fills a *starting point*: a score a manager has calibrated
 *     (is_calibrated) is never overwritten by a refresh.
 *   - No data (new hire, no sales) → the score is left for manual entry; the
 *     attempt is recorded on any existing row for staleness visibility.
 */

"use strict";

const repo = require("./appraisal.repo");
const rewardsRepo = require("./rewards.repo");
const metrics = require("./appraisal.metrics");
const events = require("./hr.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError, AppError } = require("../../utils/errors");

const AUTO_SOURCES = [
  "clock_in_data",
  "sales_data",
  "service_job_ratings",
  "customer_ratings",
];
const SCORABLE_CYCLE_STATUSES = new Set(["open", "scoring", "calibration"]);
const PASSTHROUGH_SOURCES = new Set(["service_job_ratings", "customer_ratings"]);

// Default metric→score bands. Evaluated top-down; the first `gte` match wins.
// Percentage metrics are on a 0–100(+) scale.
const DEFAULT_BANDS = {
  clock_in_data: [
    { gte: 95, score: 5 },
    { gte: 90, score: 4 },
    { gte: 80, score: 3 },
    { gte: 70, score: 2 },
    { gte: 0, score: 1 },
  ],
  sales_data: [
    { gte: 100, score: 5 },
    { gte: 90, score: 4 },
    { gte: 75, score: 3 },
    { gte: 50, score: 2 },
    { gte: 0, score: 1 },
  ],
};

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

/**
 * Map a computed metric value to a 1–5 KPI score.
 * @returns {{score:number, mode:'bands'|'passthrough', band:object|null}|null}
 *          null when no mapping is available for the source.
 */
function mapMetricToScore({ source, value, kpi }) {
  const min = Number(kpi?.min_score ?? 1);
  const max = Number(kpi?.max_score ?? 5);
  const cfg = (kpi && kpi.auto_score_config) || {};
  const bands = Array.isArray(cfg.bands) ? cfg.bands : DEFAULT_BANDS[source];

  if (cfg.mode === "passthrough" || (!bands && PASSTHROUGH_SOURCES.has(source))) {
    return {
      score: round2(clamp(Number(value), min, max)),
      mode: "passthrough",
      band: null,
    };
  }
  if (!bands || bands.length === 0) return null;
  const sorted = [...bands].sort((a, b) => Number(b.gte) - Number(a.gte));
  const hit =
    sorted.find((b) => Number(value) >= Number(b.gte)) ||
    sorted[sorted.length - 1];
  return {
    score: round2(clamp(Number(hit.score), min, max)),
    mode: "bands",
    band: hit,
  };
}

// ── Metric extraction ──────────────────────────────────────
/** Pull a source's value + evidence for one profile from the precomputed maps. */
function extractMetric(source, maps, profileId) {
  const e = maps[source] && maps[source].get(profileId);
  switch (source) {
    case "clock_in_data": {
      if (!e || !e.present_days) return { status: "no_data" };
      const pct = round2((e.punctual_days / e.present_days) * 100);
      return {
        status: "ok",
        value: pct,
        evidence: {
          metric: "on_time_pct",
          on_time_pct: pct,
          present_days: e.present_days,
          punctual_days: e.punctual_days,
        },
      };
    }
    case "sales_data": {
      if (!e || !e.target_count || e.attainment_pct === null || e.attainment_pct === undefined)
        return { status: "no_data" };
      return {
        status: "ok",
        value: e.attainment_pct,
        evidence: {
          metric: "attainment_pct",
          attainment_pct: e.attainment_pct,
          targets: e.target_count,
        },
      };
    }
    case "service_job_ratings":
    case "customer_ratings": {
      if (!e || !e.n || e.avg === null || e.avg === undefined)
        return { status: "no_data" };
      return {
        status: "ok",
        value: e.avg,
        evidence: {
          metric: source === "customer_ratings" ? "customer_rating_avg" : "quality_rating_avg",
          average: e.avg,
          sample_size: e.n,
        },
      };
    }
    default:
      return { status: "no_data" };
  }
}

// ── Date helpers (cycle window) ────────────────────────────
function ymd(d) {
  const x = d instanceof Date ? d : new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(d, n) {
  const x = d instanceof Date ? new Date(d) : new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// ── Engine ─────────────────────────────────────────────────
/**
 * Auto-score every auto KPI for every active staff member in a cycle.
 * @param {object} p
 * @param {string} p.brand
 * @param {object} [p.user]  the manager triggering it (for audit); null for the cron
 * @param {string} p.cycle_id
 * @param {string} [p.only_user_id]  restrict to one staff member
 * @param {string} [p.trigger]  'manual' | 'scheduled' (audit context)
 * @returns {Promise<{scored:number,no_data:number,skipped:number,kpis:number,staff:number}>}
 */
async function autoScoreCycle({
  brand,
  user,
  request_id,
  cycle_id,
  only_user_id,
  trigger = "manual",
}) {
  const cycle = await repo.getCycle({ brand, id: cycle_id });
  if (!cycle) throw new NotFoundError("Performance cycle");
  if (!SCORABLE_CYCLE_STATUSES.has(cycle.status))
    throw new AppError(
      "CYCLE_NOT_SCORING",
      `Cycle is '${cycle.status}' — auto-scoring is only allowed while open, scoring, or calibration`,
      409,
    );

  const from = ymd(cycle.starts_on);
  const to = ymd(addDays(cycle.ends_on, 1)); // upper-exclusive (include ends_on)

  const autoKpis = (await repo.listAutoKpis({ brand })).filter((k) =>
    AUTO_SOURCES.includes(k.score_source),
  );
  const summary = {
    scored: 0,
    no_data: 0,
    skipped: 0,
    kpis: autoKpis.length,
    staff: 0,
  };
  if (autoKpis.length === 0) return summary;

  const staff = await rewardsRepo.activeStaffForRewards({ brand });
  summary.staff = staff.length;

  // Precompute only the maps the active auto-KPIs need.
  const need = new Set(autoKpis.map((k) => k.score_source));
  const maps = {};
  if (need.has("clock_in_data"))
    maps.clock_in_data = await metrics.onTimeByProfile({ brand, from, to });
  if (need.has("sales_data"))
    maps.sales_data = await metrics.salesAttainmentByProfile({ brand, from, to });
  if (need.has("service_job_ratings"))
    maps.service_job_ratings = await metrics.qualityByProfile({ brand, from, to });
  if (need.has("customer_ratings"))
    maps.customer_ratings = await metrics.customerRatingByProfile({ brand, from, to });

  await transaction(async (client) => {
    for (const s of staff) {
      if (!s.user_id) continue;
      if (only_user_id && s.user_id !== only_user_id) continue;
      for (const kpi of autoKpis) {
        const ex = extractMetric(kpi.score_source, maps, s.profile_id);
        if (ex.status === "no_data") {
          await repo.markAutoAttempt({
            client,
            brand,
            cycle_id,
            user_id: s.user_id,
            kpi_id: kpi.kpi_id,
            status: "no_data",
          });
          summary.no_data += 1;
          continue;
        }
        const mapped = mapMetricToScore({
          source: kpi.score_source,
          value: ex.value,
          kpi,
        });
        if (!mapped) {
          summary.no_data += 1;
          continue;
        }
        const row = await repo.upsertAutoScore({
          client,
          brand,
          s: {
            cycle_id,
            user_id: s.user_id,
            kpi_id: kpi.kpi_id,
            raw_score: mapped.score,
            weight_pct_snapshot: kpi.weight_pct,
            score_source: kpi.score_source,
            evidence: {
              ...ex.evidence,
              mapping: mapped.mode,
              band: mapped.band,
              window: { from, to },
              computed_at: new Date().toISOString(),
            },
          },
        });
        if (row) summary.scored += 1;
        else summary.skipped += 1; // preserved a manager-calibrated score
      }
    }
  });

  await audit({
    business: brand,
    user_id: user ? user.user_id : null,
    request_id,
    action_key: "hr_payroll.appraisal.auto_score",
    target_type: "performance_cycle",
    target_id: cycle_id,
    after: { ...summary, trigger },
  });
  events.emit("appraisal_auto_scored", { brand, cycle_id, ...summary });
  return summary;
}

module.exports = { autoScoreCycle, mapMetricToScore, AUTO_SOURCES };
