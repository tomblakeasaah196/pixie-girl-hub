/**
 * Performance appraisal service (V2.2 §6.11, F-8).
 *
 * The scoring/review *run* that sits on the KPI-definition + cycle config:
 *   - scoreStaff(): record per-KPI raw scores for a staff member in a cycle,
 *     snapshotting each KPI's weight at scoring time (the DB derives the
 *     weighted_score). Validates the cycle is in a scoring state and each raw
 *     score is within the KPI's min/max scale.
 *   - generateReview(): roll the weighted scores into one overall figure
 *     (summed exactly in Postgres) and a rating band, upserting the review.
 *   - the review lifecycle: written content, manager submit/review/approve/
 *     finalise, and the employee's acknowledgement (two-sided per §6.11).
 */

"use strict";

const repo = require("./appraisal.repo");
const events = require("./hr.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError, AppError } = require("../../utils/errors");

const SCORABLE_CYCLE_STATUSES = new Set(["open", "scoring", "calibration"]);
const REVIEW_STATUSES = [
  "draft",
  "submitted",
  "reviewed",
  "approved",
  "finalised",
  "disputed",
];

const A = (
  brand,
  user,
  action_key,
  target_type,
  target_id,
  after,
  request_id,
) =>
  audit({
    business: brand,
    user_id: user ? user.user_id : null,
    action_key,
    target_type,
    target_id,
    after,
    request_id,
  });

/** 1–5 weighted overall → the §6.11 rating band. */
function ratingBand(overall) {
  const s = Number(overall);
  if (s >= 4.5) return "exceptional";
  if (s >= 3.5) return "exceeds";
  if (s >= 2.5) return "meets";
  if (s >= 1.5) return "needs_improvement";
  return "unsatisfactory";
}

// ── Scoring ────────────────────────────────────────────────
/**
 * Record (upsert) a staff member's KPI scores for a cycle. `scores` is an array
 * of { kpi_id, raw_score, comments?, score_source?, evidence? }.
 */
async function scoreStaff({
  brand,
  user,
  request_id,
  cycle_id,
  user_id,
  scores,
}) {
  if (!Array.isArray(scores) || scores.length === 0)
    throw new AppError("NO_SCORES", "At least one KPI score is required", 422);

  return transaction(async (client) => {
    const cycle = await repo.getCycle({ client, brand, id: cycle_id });
    if (!cycle) throw new NotFoundError("Performance cycle");
    if (!SCORABLE_CYCLE_STATUSES.has(cycle.status))
      throw new AppError(
        "CYCLE_NOT_SCORING",
        `Cycle is '${cycle.status}' — scoring is only allowed while open, scoring, or calibration`,
        409,
      );

    const saved = [];
    for (const sc of scores) {
      const kpi = await repo.getKpiDef({ client, brand, id: sc.kpi_id });
      if (!kpi)
        throw new AppError("KPI_NOT_FOUND", `Unknown KPI ${sc.kpi_id}`, 422);
      const raw = Number(sc.raw_score);
      if (raw < Number(kpi.min_score) || raw > Number(kpi.max_score))
        throw new AppError(
          "SCORE_OUT_OF_RANGE",
          `${kpi.display_name} score ${raw} is outside ${kpi.min_score}–${kpi.max_score}`,
          422,
        );
      const row = await repo.upsertScore({
        client,
        brand,
        s: {
          cycle_id,
          user_id,
          kpi_id: sc.kpi_id,
          raw_score: raw,
          weight_pct_snapshot: kpi.weight_pct,
          score_source: sc.score_source || kpi.score_source || "manual",
          evidence: sc.evidence,
          scored_by: user ? user.user_id : null,
          comments: sc.comments,
        },
      });
      saved.push(row);
    }

    await A(
      brand,
      user,
      "hr_payroll.appraisal.score",
      "performance_cycle",
      cycle_id,
      { user_id, kpis: saved.length },
      request_id,
    );
    events.emit("appraisal_scored", { brand, cycle_id, user_id });
    return saved;
  });
}

function listScores({ brand, cycle_id, user_id }) {
  return repo.listScores({ brand, cycle_id, user_id });
}

// ── Reviews ────────────────────────────────────────────────
/**
 * Compute the overall weighted score + band for a staff member in a cycle and
 * upsert the review. Preserves any written content already captured (the upsert
 * only refreshes the numeric figure + band).
 */
async function generateReview({ brand, user, request_id, cycle_id, user_id }) {
  return transaction(async (client) => {
    const cycle = await repo.getCycle({ client, brand, id: cycle_id });
    if (!cycle) throw new NotFoundError("Performance cycle");
    const agg = await repo.overallForUser({ client, brand, cycle_id, user_id });
    if (!agg || agg.kpi_count === 0)
      throw new AppError(
        "NO_SCORES",
        "No KPI scores recorded for this staff member in this cycle",
        422,
      );
    const overall = agg.overall;
    const review = await repo.upsertReview({
      client,
      brand,
      r: {
        cycle_id,
        user_id,
        overall_weighted_score: overall,
        overall_rating_band: ratingBand(overall),
      },
    });
    await A(
      brand,
      user,
      "hr_payroll.appraisal.review_generate",
      "performance_review",
      review.review_id,
      { cycle_id, user_id, overall, band: review.overall_rating_band },
      request_id,
    );
    events.emit("appraisal_review_generated", {
      brand,
      review_id: review.review_id,
      cycle_id,
      user_id,
    });
    return review;
  });
}

function listReviews({ brand, cycle_id, user_id, status }) {
  return repo.listReviews({ brand, cycle_id, user_id, status });
}
async function getReview({ brand, id }) {
  const r = await repo.getReview({ brand, id });
  if (!r) throw new NotFoundError("Performance review");
  return r;
}

async function updateReviewContent({ brand, user, request_id, id, patch }) {
  const before = await repo.getReview({ brand, id });
  if (!before) throw new NotFoundError("Performance review");
  if (["approved", "finalised"].includes(before.status))
    throw new AppError(
      "REVIEW_LOCKED",
      `Cannot edit a ${before.status} review`,
      409,
    );
  const r = await repo.updateReview({ brand, id, patch });
  await A(
    brand,
    user,
    "hr_payroll.appraisal.review_update",
    "performance_review",
    id,
    patch,
    request_id,
  );
  return r;
}

/** Manager-side lifecycle: submitted → reviewed → approved → finalised. */
async function advanceReview({ brand, user, request_id, id, status }) {
  if (!REVIEW_STATUSES.includes(status))
    throw new AppError("BAD_STATUS", `Unknown review status ${status}`, 422);
  const before = await repo.getReview({ brand, id });
  if (!before) throw new NotFoundError("Performance review");
  const fields = { status };
  const nowIso = new Date().toISOString();
  if (status === "reviewed") {
    fields.reviewed_by_manager_id = user ? user.user_id : null;
    fields.reviewed_at = nowIso;
  }
  if (status === "approved") {
    fields.approved_by_user_id = user ? user.user_id : null;
    fields.approved_at = nowIso;
  }
  const r = await repo.setReviewFields({ brand, id, fields });
  await A(
    brand,
    user,
    "hr_payroll.appraisal.review_advance",
    "performance_review",
    id,
    { from: before.status, to: status },
    request_id,
  );
  events.emit("appraisal_review_advanced", { brand, review_id: id, status });
  return r;
}

/** Employee-side acknowledgement (two-sided review per §6.11). */
async function acknowledgeReview({ brand, user, request_id, id, input }) {
  const before = await repo.getReview({ brand, id });
  if (!before) throw new NotFoundError("Performance review");
  const agreed = input.agreed !== false; // default to agreed unless explicitly false
  const fields = {
    acknowledged_by_employee: true,
    acknowledged_at: new Date().toISOString(),
    employee_response: input.employee_response || null,
    employee_disagreement: agreed ? null : input.employee_disagreement || null,
  };
  if (!agreed) fields.status = "disputed";
  const r = await repo.setReviewFields({ brand, id, fields });
  await A(
    brand,
    user,
    "hr_payroll.appraisal.review_acknowledge",
    "performance_review",
    id,
    { agreed },
    request_id,
  );
  events.emit("appraisal_review_acknowledged", {
    brand,
    review_id: id,
    agreed,
  });
  return r;
}

// ── Auto-scoring ───────────────────────────────────────────
const { autoScoreCycle } = require("./appraisal.autoscore");

/**
 * Manager calibration of a (usually auto-derived) score. Records the override
 * with an audit trail; is_calibrated then shields the score from auto-refresh.
 */
async function calibrateScore({ brand, user, request_id, cycle_id, score_id, raw_score, reason }) {
  const row = await repo.calibrateScore({
    brand,
    score_id,
    raw_score,
    reason,
    scored_by: user ? user.user_id : null,
  });
  if (!row) throw new NotFoundError("Performance score");
  await A(
    brand,
    user,
    "hr_payroll.appraisal.calibrate",
    "performance_score",
    score_id,
    { cycle_id, raw_score },
    request_id,
  );
  events.emit("appraisal_score_calibrated", { brand, cycle_id, score_id });
  return row;
}

module.exports = {
  ratingBand,
  scoreStaff,
  listScores,
  generateReview,
  listReviews,
  getReview,
  updateReviewContent,
  advanceReview,
  acknowledgeReview,
  autoScoreCycle,
  calibrateScore,
};
