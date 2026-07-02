/**
 * Performance appraisal repository (V2.2 §6.11, F-8) — the scoring/review run
 * that sits on top of the KPI-definition + cycle config CRUD.
 *
 * Per-brand tables: performance_scores (one row per cycle×user×KPI; the
 * weighted_score is a generated column) and performance_reviews (one row per
 * cycle×user; the written review with computed overall + rating band).
 * Parameterised SQL only; per-brand schemas via the brand registry `t()`.
 */

"use strict";

const { query, ex } = require("../../config/database");
const { t } = require("../../config/brands");

// ── Lookups ────────────────────────────────────────────────
async function getCycle({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "performance_cycles")} WHERE cycle_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function getKpiDef({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "performance_kpi_definitions")} WHERE kpi_id = $1`,
    [id],
  );
  return rows[0] || null;
}

// ── Scores ─────────────────────────────────────────────────
async function upsertScore({ client, brand, s }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "performance_scores")}
       (cycle_id, user_id, kpi_id, raw_score, weight_pct_snapshot,
        score_source, evidence, scored_by, scored_at, comments)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,'manual'),$7::jsonb,$8, now(), $9)
     ON CONFLICT (cycle_id, user_id, kpi_id) DO UPDATE
       SET raw_score = EXCLUDED.raw_score,
           weight_pct_snapshot = EXCLUDED.weight_pct_snapshot,
           score_source = EXCLUDED.score_source,
           evidence = EXCLUDED.evidence,
           scored_by = EXCLUDED.scored_by,
           scored_at = now(),
           comments = EXCLUDED.comments
     RETURNING *`,
    [
      s.cycle_id,
      s.user_id,
      s.kpi_id,
      s.raw_score,
      s.weight_pct_snapshot,
      s.score_source || null,
      s.evidence ? JSON.stringify(s.evidence) : null,
      s.scored_by || null,
      s.comments || null,
    ],
  );
  return rows[0];
}

async function listScores({ brand, cycle_id, user_id }) {
  const where = ["s.cycle_id = $1"];
  const params = [cycle_id];
  let i = 2;
  if (user_id) {
    where.push(`s.user_id = $${i++}`);
    params.push(user_id);
  }
  const { rows } = await query(
    `SELECT s.*, k.display_name AS kpi_name, k.kpi_key
       FROM ${t(brand, "performance_scores")} s
       JOIN ${t(brand, "performance_kpi_definitions")} k ON k.kpi_id = s.kpi_id
      WHERE ${where.join(" AND ")}
      ORDER BY k.display_order, k.display_name`,
    params,
  );
  return rows;
}

// Overall = SUM(weighted_score) for a user in a cycle — computed exactly in
// Postgres numeric (no JS float). Returns { overall, kpi_count }.
async function overallForUser({ client, brand, cycle_id, user_id }) {
  const { rows } = await ex(client)(
    `SELECT COALESCE(SUM(weighted_score),0)::numeric(7,4) AS overall,
            count(*)::int AS kpi_count
       FROM ${t(brand, "performance_scores")}
      WHERE cycle_id = $1 AND user_id = $2`,
    [cycle_id, user_id],
  );
  return rows[0];
}

// ── Reviews ────────────────────────────────────────────────
async function upsertReview({ client, brand, r }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "performance_reviews")}
       (cycle_id, user_id, overall_weighted_score, overall_rating_band, status)
     VALUES ($1,$2,$3,$4,COALESCE($5,'draft'))
     ON CONFLICT (cycle_id, user_id) DO UPDATE
       SET overall_weighted_score = EXCLUDED.overall_weighted_score,
           overall_rating_band = EXCLUDED.overall_rating_band,
           updated_at = now()
     RETURNING *`,
    [
      r.cycle_id,
      r.user_id,
      r.overall_weighted_score,
      r.overall_rating_band,
      r.status || null,
    ],
  );
  return rows[0];
}

async function getReview({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "performance_reviews")} WHERE review_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function listReviews({ brand, cycle_id, user_id, status }) {
  const where = [];
  const params = [];
  let i = 1;
  if (cycle_id) {
    where.push(`cycle_id = $${i++}`);
    params.push(cycle_id);
  }
  if (user_id) {
    where.push(`user_id = $${i++}`);
    params.push(user_id);
  }
  if (status) {
    where.push(`status = $${i++}`);
    params.push(status);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "performance_reviews")} ${w}
      ORDER BY created_at DESC`,
    params,
  );
  return rows;
}

const REVIEW_WRITE_COLS = [
  "strengths",
  "improvement_areas",
  "development_goals",
  "manager_comments",
];
async function updateReview({ client, brand, id, patch }) {
  const sets = [];
  const params = [];
  let i = 1;
  for (const k of REVIEW_WRITE_COLS) {
    if (patch[k] === undefined) continue;
    sets.push(`${k} = $${i++}`);
    params.push(patch[k]);
  }
  if (!sets.length) return getReview({ client, brand, id });
  params.push(id);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "performance_reviews")} SET ${sets.join(", ")}, updated_at = now()
      WHERE review_id = $${i} RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function setReviewFields({ client, brand, id, fields }) {
  const sets = [];
  const params = [];
  let i = 1;
  for (const [col, val] of Object.entries(fields)) {
    sets.push(`${col} = $${i++}`);
    params.push(val);
  }
  if (!sets.length) return getReview({ client, brand, id });
  params.push(id);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "performance_reviews")} SET ${sets.join(", ")}, updated_at = now()
      WHERE review_id = $${i} RETURNING *`,
    params,
  );
  return rows[0] || null;
}

module.exports = {
  getCycle,
  getKpiDef,
  upsertScore,
  listScores,
  overallForUser,
  upsertReview,
  getReview,
  listReviews,
  updateReview,
  setReviewFields,
};
