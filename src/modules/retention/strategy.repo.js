/**
 * Retention strategy engine repository (Module 6.23). Parameterised SQL only,
 * over the per-brand tables retention_strategies, retention_strategy_steps,
 * retention_enrollments, retention_strategy_step_runs (template/000066).
 */

"use strict";

const { query, ex } = require("../../config/database");
const { t } = require("../../config/brands");
const STRATEGY_COLS = [
  "strategy_key",
  "display_name",
  "description",
  "template_key",
  "trigger_type",
  "trigger_conditions",
  "audience_segment_id",
  "goal_event",
  "goal_window_days",
  "status",
  "max_enrollments_per_customer",
  "reenroll_cooldown_days",
  "summary",
];
const STRATEGY_JSON = new Set(["trigger_conditions"]);

function buildInsert(cols, jsonCols, src) {
  const f = [];
  const ph = [];
  const p = [];
  let i = 1;
  for (const c of cols) {
    if (src[c] === undefined) continue;
    f.push(c);
    ph.push(jsonCols.has(c) ? `$${i++}::jsonb` : `$${i++}`);
    p.push(jsonCols.has(c) ? JSON.stringify(src[c]) : src[c]);
  }
  return { f, ph, p, next: i };
}

// ── Strategies ────────────────────────────────────────────
async function createStrategy({ client, brand, input, user_id }) {
  const { f, ph, p, next } = buildInsert(STRATEGY_COLS, STRATEGY_JSON, input);
  f.push("created_by");
  ph.push(`$${next}`);
  p.push(user_id || null);
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "retention_strategies")} (${f.join(",")})
     VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}

async function listStrategies({ brand, status }) {
  const params = [];
  let where = "";
  if (status) {
    where = "WHERE status = $1";
    params.push(status);
  }
  const { rows } = await query(
    `SELECT s.*,
            (SELECT count(*)::int FROM ${t(brand, "retention_strategy_steps")} st
              WHERE st.strategy_id = s.strategy_id) AS step_count
       FROM ${t(brand, "retention_strategies")} s
       ${where}
      ORDER BY s.created_at DESC`,
    params,
  );
  return rows;
}

async function getStrategy({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "retention_strategies")} WHERE strategy_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function getStrategyByKey({ brand, strategy_key }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "retention_strategies")} WHERE strategy_key = $1`,
    [strategy_key],
  );
  return rows[0] || null;
}

async function updateStrategy({ brand, id, patch }) {
  const keys = Object.keys(patch).filter((k) => STRATEGY_COLS.includes(k));
  if (keys.length === 0) return getStrategy({ brand, id });
  const sets = keys.map((k, i) =>
    STRATEGY_JSON.has(k) ? `${k} = $${i + 2}::jsonb` : `${k} = $${i + 2}`,
  );
  const vals = keys.map((k) =>
    STRATEGY_JSON.has(k) ? JSON.stringify(patch[k]) : patch[k],
  );
  const { rows } = await query(
    `UPDATE ${t(brand, "retention_strategies")} SET ${sets.join(", ")}, updated_at = now()
      WHERE strategy_id = $1 RETURNING *`,
    [id, ...vals],
  );
  return rows[0] || null;
}

async function setStatus({ brand, id, status }) {
  const { rows } = await query(
    `UPDATE ${t(brand, "retention_strategies")} SET status = $2, updated_at = now()
      WHERE strategy_id = $1 RETURNING *`,
    [id, status],
  );
  return rows[0] || null;
}

async function findActiveByTrigger({ client, brand, trigger_type }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "retention_strategies")}
      WHERE status = 'active' AND trigger_type = $1`,
    [trigger_type],
  );
  return rows;
}

// ── Steps ─────────────────────────────────────────────────
async function listSteps({ client, brand, strategy_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "retention_strategy_steps")}
      WHERE strategy_id = $1 ORDER BY step_order`,
    [strategy_id],
  );
  return rows;
}

async function getStepByOrder({ client, brand, strategy_id, step_order }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "retention_strategy_steps")}
      WHERE strategy_id = $1 AND step_order = $2`,
    [strategy_id, step_order],
  );
  return rows[0] || null;
}

async function replaceSteps({ client, brand, strategy_id, steps }) {
  const run = ex(client);
  await run(
    `DELETE FROM ${t(brand, "retention_strategy_steps")} WHERE strategy_id = $1`,
    [strategy_id],
  );
  const out = [];
  let order = 1;
  for (const s of steps || []) {
    const { rows } = await run(
      `INSERT INTO ${t(brand, "retention_strategy_steps")}
         (strategy_id, step_order, wait_minutes, step_conditions, action_type,
          action_config, email_template_id, coupon_template, description)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7,$8::jsonb,$9) RETURNING *`,
      [
        strategy_id,
        s.step_order || order,
        s.wait_minutes || 0,
        JSON.stringify(s.step_conditions || {}),
        s.action_type,
        JSON.stringify(s.action_config || {}),
        s.email_template_id || null,
        s.coupon_template ? JSON.stringify(s.coupon_template) : null,
        s.description || null,
      ],
    );
    out.push(rows[0]);
    order += 1;
  }
  return out;
}

// ── Enrollments ───────────────────────────────────────────
async function countEnrollmentsForCustomer({ client, brand, strategy_id, contact_id }) {
  if (!contact_id) return 0;
  const { rows } = await ex(client)(
    `SELECT count(*)::int AS c FROM ${t(brand, "retention_enrollments")}
      WHERE strategy_id = $1 AND contact_id = $2`,
    [strategy_id, contact_id],
  );
  return rows[0].c;
}

async function hasRecentEnrollment({ client, brand, strategy_id, contact_id, days }) {
  if (!contact_id || !days) return false;
  const { rows } = await ex(client)(
    `SELECT 1 FROM ${t(brand, "retention_enrollments")}
      WHERE strategy_id = $1 AND contact_id = $2
        AND enrolled_at >= now() - ($3 || ' days')::interval
      LIMIT 1`,
    [strategy_id, contact_id, String(days)],
  );
  return rows.length > 0;
}

async function hasActiveEnrollment({ client, brand, strategy_id, contact_id }) {
  if (!contact_id) return false;
  const { rows } = await ex(client)(
    `SELECT 1 FROM ${t(brand, "retention_enrollments")}
      WHERE strategy_id = $1 AND contact_id = $2 AND status = 'active' LIMIT 1`,
    [strategy_id, contact_id],
  );
  return rows.length > 0;
}

async function insertEnrollment({ client, brand, enrollment }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "retention_enrollments")}
       (strategy_id, contact_id, status, current_step_order, next_run_at,
        trigger_event_type, trigger_source_table, trigger_source_id, context)
     VALUES ($1,$2,'active',0,$3,$4,$5,$6,$7::jsonb) RETURNING *`,
    [
      enrollment.strategy_id,
      enrollment.contact_id || null,
      enrollment.next_run_at || new Date().toISOString(),
      enrollment.trigger_event_type,
      enrollment.trigger_source_table || null,
      enrollment.trigger_source_id || null,
      JSON.stringify(enrollment.context || {}),
    ],
  );
  return rows[0];
}

async function bumpEnrolled({ client, brand, strategy_id }) {
  await ex(client)(
    `UPDATE ${t(brand, "retention_strategies")}
        SET total_enrolled = total_enrolled + 1 WHERE strategy_id = $1`,
    [strategy_id],
  );
}

async function claimDueEnrollments({ client, brand, limit }) {
  const { rows } = await ex(client)(
    `WITH due AS (
       SELECT enrollment_id FROM ${t(brand, "retention_enrollments")}
        WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at <= now()
        ORDER BY next_run_at
        FOR UPDATE SKIP LOCKED
        LIMIT $1
     )
     UPDATE ${t(brand, "retention_enrollments")} e
        SET updated_at = now()
       FROM due WHERE e.enrollment_id = due.enrollment_id
     RETURNING e.*`,
    [limit],
  );
  return rows;
}

async function advanceEnrollment({ brand, enrollment_id, current_step_order, next_run_at }) {
  await query(
    `UPDATE ${t(brand, "retention_enrollments")}
        SET current_step_order = $2, next_run_at = $3, updated_at = now()
      WHERE enrollment_id = $1`,
    [enrollment_id, current_step_order, next_run_at],
  );
}

async function deferEnrollment({ brand, enrollment_id, next_run_at }) {
  await query(
    `UPDATE ${t(brand, "retention_enrollments")}
        SET next_run_at = $2, updated_at = now() WHERE enrollment_id = $1`,
    [enrollment_id, next_run_at],
  );
}

async function completeEnrollment({ brand, enrollment_id, status, exit_reason }) {
  await query(
    `UPDATE ${t(brand, "retention_enrollments")}
        SET status = $2, next_run_at = NULL,
            completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE completed_at END,
            exit_reason = $3, updated_at = now()
      WHERE enrollment_id = $1`,
    [enrollment_id, status, exit_reason || null],
  );
  if (status === "completed") {
    const e = await query(
      `SELECT strategy_id FROM ${t(brand, "retention_enrollments")} WHERE enrollment_id = $1`,
      [enrollment_id],
    );
    if (e.rows[0])
      await query(
        `UPDATE ${t(brand, "retention_strategies")}
            SET total_completed = total_completed + 1 WHERE strategy_id = $1`,
        [e.rows[0].strategy_id],
      );
  }
}

async function insertStepRun({ brand, run }) {
  await query(
    `INSERT INTO ${t(brand, "retention_strategy_step_runs")}
       (enrollment_id, step_id, step_order, status, result_summary, generated_records, failure_reason)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
    [
      run.enrollment_id,
      run.step_id || null,
      run.step_order ?? null,
      run.status,
      run.result_summary ? JSON.stringify(run.result_summary) : null,
      run.generated_records ? JSON.stringify(run.generated_records) : null,
      run.failure_reason || null,
    ],
  );
}

async function listEnrollments({ brand, strategy_id, limit = 100 }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "retention_enrollments")}
      WHERE strategy_id = $1 ORDER BY enrolled_at DESC LIMIT $2`,
    [strategy_id, limit],
  );
  return rows;
}

module.exports = {
  createStrategy,
  listStrategies,
  getStrategy,
  getStrategyByKey,
  updateStrategy,
  setStatus,
  findActiveByTrigger,
  listSteps,
  getStepByOrder,
  replaceSteps,
  countEnrollmentsForCustomer,
  hasRecentEnrollment,
  hasActiveEnrollment,
  insertEnrollment,
  bumpEnrolled,
  claimDueEnrollments,
  advanceEnrollment,
  deferEnrollment,
  completeEnrollment,
  insertStepRun,
  listEnrollments,
};
