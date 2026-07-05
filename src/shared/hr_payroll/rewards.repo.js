/**
 * Rewards repository (meeting §3 reward system). Parameterised SQL only.
 *
 * - reward_rules / reward_grants live in `shared.*` with a `business` column
 *   (same pattern as performance_targets).
 * - Metric queries compute each employee's monthly standing for the behaviour
 *   the boss wants to reward: first-in / last-out days (ranked from
 *   attendance_days), punctual days, prompt data entry (audit_log), completed
 *   jobs, sales, and job quality. All keyed by profile_id.
 */

"use strict";

const { ex: exec } = require("../../config/database");
const { t } = require("../../config/brands");

// ── Rules CRUD ─────────────────────────────────────────────
async function listRules({ client, brand, include_inactive }) {
  const where = ["business = $1"];
  if (!include_inactive) where.push("is_active = true");
  const { rows } = await exec(client)(
    `SELECT * FROM shared.reward_rules WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC`,
    [brand],
  );
  return rows;
}

async function findRule({ client, brand, id }) {
  const { rows } = await exec(client)(
    `SELECT * FROM shared.reward_rules WHERE reward_rule_id = $2 AND business = $1`,
    [brand, id],
  );
  return rows[0] || null;
}

async function createRule({ client, brand, input, createdBy }) {
  const { rows } = await exec(client)(
    `INSERT INTO shared.reward_rules
       (business, name, description, metric, comparator, threshold,
        period_type, reward_type, reward_value, is_active, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,true),$11)
     RETURNING *`,
    [
      brand, input.name, input.description ?? null, input.metric,
      input.comparator || "gte", input.threshold, input.period_type || "month",
      input.reward_type, input.reward_value,
      input.is_active === undefined ? null : input.is_active, createdBy || null,
    ],
  );
  return rows[0];
}

async function updateRule({ client, brand, id, patch }) {
  const cols = [
    "name", "description", "metric", "comparator", "threshold",
    "period_type", "reward_type", "reward_value", "is_active",
  ];
  const sets = [];
  const params = [brand, id];
  let i = 3;
  for (const c of cols) {
    if (patch[c] === undefined) continue;
    sets.push(`${c} = $${i++}`);
    params.push(patch[c]);
  }
  if (!sets.length) return findRule({ client, brand, id });
  sets.push("updated_at = now()");
  const { rows } = await exec(client)(
    `UPDATE shared.reward_rules SET ${sets.join(", ")}
      WHERE reward_rule_id = $2 AND business = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function deleteRule({ client, brand, id }) {
  await exec(client)(
    `DELETE FROM shared.reward_rules WHERE reward_rule_id = $2 AND business = $1`,
    [brand, id],
  );
}

// ── Grants ─────────────────────────────────────────────────
async function listGrants({ client, brand, filters = {} }) {
  const where = ["g.business = $1"];
  const params = [brand];
  let i = 2;
  if (filters.status) { where.push(`g.status = $${i++}`); params.push(filters.status); }
  if (filters.profile_id) { where.push(`g.profile_id = $${i++}`); params.push(filters.profile_id); }
  if (filters.period_year) { where.push(`g.period_year = $${i++}`); params.push(filters.period_year); }
  if (filters.period_month) { where.push(`g.period_month = $${i++}`); params.push(filters.period_month); }
  const { rows } = await exec(client)(
    `SELECT g.*, c.display_name AS staff_name, r.name AS rule_name, r.metric AS rule_metric
       FROM shared.reward_grants g
       JOIN shared.staff_profiles sp ON sp.profile_id = g.profile_id
       LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
       LEFT JOIN shared.reward_rules r ON r.reward_rule_id = g.reward_rule_id
      WHERE ${where.join(" AND ")}
      ORDER BY g.created_at DESC LIMIT 500`,
    params,
  );
  return rows;
}

async function findGrant({ client, brand, id }) {
  const { rows } = await exec(client)(
    `SELECT * FROM shared.reward_grants WHERE reward_grant_id = $2 AND business = $1`,
    [brand, id],
  );
  return rows[0] || null;
}

/**
 * Insert a grant for (rule, profile, period). ON CONFLICT DO NOTHING makes the
 * evaluator idempotent — a rule can be re-evaluated any number of times a
 * month and each employee is granted at most once. Returns the row only when
 * it was newly created (so the caller triggers the side effect exactly once).
 */
async function insertGrantIfAbsent({ client, brand, g }) {
  const { rows } = await exec(client)(
    `INSERT INTO shared.reward_grants
       (business, reward_rule_id, profile_id, user_id, period_year, period_month,
        metric, metric_value, reward_type, reward_value, amount_ngn,
        proposed_salary_ngn, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (reward_rule_id, profile_id, period_year, period_month) DO NOTHING
     RETURNING *`,
    [
      brand, g.reward_rule_id, g.profile_id, g.user_id ?? null,
      g.period_year, g.period_month, g.metric, g.metric_value,
      g.reward_type, g.reward_value, g.amount_ngn ?? null,
      g.proposed_salary_ngn ?? null, g.status,
    ],
  );
  return rows[0] || null;
}

async function setGrantBonus({ client, brand, id, bonus_id }) {
  await exec(client)(
    `UPDATE shared.reward_grants SET bonus_id = $3 WHERE reward_grant_id = $2 AND business = $1`,
    [brand, id, bonus_id],
  );
}

async function setGrantStatus({ client, brand, id, status, decidedBy }) {
  const { rows } = await exec(client)(
    `UPDATE shared.reward_grants
        SET status = $3, decided_by = $4, decided_at = now()
      WHERE reward_grant_id = $2 AND business = $1 RETURNING *`,
    [brand, id, status, decidedBy || null],
  );
  return rows[0] || null;
}

// ── Metric queries (profile_id → value over a month) ───────
/** Active staff whose PRIMARY brand is this one, with user + base salary. */
async function activeStaffForRewards({ client, brand }) {
  const { rows } = await exec(client)(
    `SELECT sp.profile_id, sp.base_salary, c.display_name,
            (SELECT u.user_id FROM shared.users u
               WHERE u.staff_profile_id = sp.profile_id
               ORDER BY u.is_active DESC, u.created_at ASC LIMIT 1) AS user_id
       FROM shared.staff_profiles sp
       LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
      WHERE sp.business = $1 AND sp.is_deleted = false
        AND (sp.end_date IS NULL OR sp.end_date >= CURRENT_DATE)`,
    [brand],
  );
  return rows;
}

function monthBounds(year, month) {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return { from, to };
}

/**
 * first_in_days / last_out_days: rank staff each day by earliest clock-in /
 * latest clock-out, then count the days each profile ranked first.
 */
async function firstInDays({ client, brand, year, month }) {
  const { from, to } = monthBounds(year, month);
  const { rows } = await exec(client)(
    `WITH ranked AS (
       SELECT profile_id, work_date,
              rank() OVER (PARTITION BY work_date ORDER BY first_clock_in_at ASC) AS r
         FROM shared.attendance_days
        WHERE business = $1 AND work_date >= $2 AND work_date < $3
          AND first_clock_in_at IS NOT NULL AND status IN ('present','late'))
     SELECT profile_id, count(*)::int AS value FROM ranked WHERE r = 1 GROUP BY profile_id`,
    [brand, from, to],
  );
  return toMap(rows);
}

async function lastOutDays({ client, brand, year, month }) {
  const { from, to } = monthBounds(year, month);
  const { rows } = await exec(client)(
    `WITH ranked AS (
       SELECT profile_id, work_date,
              rank() OVER (PARTITION BY work_date ORDER BY last_clock_out_at DESC) AS r
         FROM shared.attendance_days
        WHERE business = $1 AND work_date >= $2 AND work_date < $3
          AND last_clock_out_at IS NOT NULL AND status IN ('present','late'))
     SELECT profile_id, count(*)::int AS value FROM ranked WHERE r = 1 GROUP BY profile_id`,
    [brand, from, to],
  );
  return toMap(rows);
}

async function punctualDays({ client, brand, year, month }) {
  const { from, to } = monthBounds(year, month);
  const { rows } = await exec(client)(
    `SELECT profile_id, count(*)::int AS value
       FROM shared.attendance_days
      WHERE business = $1 AND work_date >= $2 AND work_date < $3
        AND status = 'present' AND is_late = false
      GROUP BY profile_id`,
    [brand, from, to],
  );
  return toMap(rows);
}

/** Prompt data entry: count of this user's audited create/update actions. */
async function dataEntries({ client, brand, year, month }) {
  const { from, to } = monthBounds(year, month);
  const { rows } = await exec(client)(
    `SELECT sp.profile_id, count(*)::int AS value
       FROM shared.audit_log a
       JOIN shared.users u ON u.user_id = a.user_id
       JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
      WHERE a.business = $1 AND a.created_at >= $2 AND a.created_at < $3
        AND sp.business = $1
        AND (a.action ILIKE '%create%' OR a.action ILIKE '%update%'
             OR a.action ILIKE '%add%' OR a.action ILIKE '%record%')
      GROUP BY sp.profile_id`,
    [brand, from, to],
  );
  return toMap(rows);
}

/** Completed service jobs credited to the staff member (brand table). */
async function stylesCompleted({ client, brand, year, month }) {
  const { from, to } = monthBounds(year, month);
  const { rows } = await exec(client)(
    `SELECT sp.profile_id, count(*)::int AS value
       FROM ${t(brand, "service_jobs")} j
       JOIN shared.users u ON u.user_id = j.assigned_staff_user_id
       JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
      WHERE j.status IN ('completed','qc_passed')
        AND j.completed_at >= $2 AND j.completed_at < $3
      GROUP BY sp.profile_id`,
    [brand, from, to],
  ).catch(() => ({ rows: [] }));
  return toMap(rows);
}

/** Average QC rating (1–5) on the staff member's jobs (brand table). */
async function qualityAvg({ client, brand, year, month }) {
  const { from, to } = monthBounds(year, month);
  const { rows } = await exec(client)(
    `SELECT sp.profile_id, round(avg(j.quality_rating)::numeric, 2) AS value
       FROM ${t(brand, "service_jobs")} j
       JOIN shared.users u ON u.user_id = j.assigned_staff_user_id
       JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
      WHERE j.quality_rating IS NOT NULL
        AND j.completed_at >= $2 AND j.completed_at < $3
      GROUP BY sp.profile_id`,
    [brand, from, to],
  ).catch(() => ({ rows: [] }));
  return toMap(rows);
}

/** Paid orders attributed to the staff member's sales (commission ledger). */
async function salesCount({ client, brand, year, month }) {
  const { from, to } = monthBounds(year, month);
  const { rows } = await exec(client)(
    `SELECT sp.profile_id, count(*)::int AS value
       FROM ${t(brand, "commission_earned")} ce
       JOIN shared.users u ON u.user_id = ce.user_id
       JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
      WHERE ce.earned_at >= $2 AND ce.earned_at < $3
      GROUP BY sp.profile_id`,
    [brand, from, to],
  ).catch(() => ({ rows: [] }));
  return toMap(rows);
}

/** Average quality for a single profile (Employee 360 insight). */
async function qualityAvgForProfile({ client, brand, profileId, from, to }) {
  const { rows } = await exec(client)(
    `SELECT round(avg(j.quality_rating)::numeric, 2) AS value
       FROM ${t(brand, "service_jobs")} j
       JOIN shared.users u ON u.user_id = j.assigned_staff_user_id
      WHERE u.staff_profile_id = $2 AND j.quality_rating IS NOT NULL
        AND ($3::date IS NULL OR j.completed_at >= $3)
        AND ($4::date IS NULL OR j.completed_at < $4)`,
    [brand, profileId, from || null, to || null],
  ).catch(() => ({ rows: [] }));
  return rows[0] && rows[0].value !== null ? Number(rows[0].value) : null;
}

function toMap(rows) {
  const m = {};
  for (const r of rows) m[r.profile_id] = Number(r.value);
  return m;
}

const METRIC_QUERIES = {
  first_in_days: firstInDays,
  last_out_days: lastOutDays,
  punctual_days: punctualDays,
  data_entries: dataEntries,
  styles_completed: stylesCompleted,
  quality_avg: qualityAvg,
  sales_count: salesCount,
};

module.exports = {
  listRules, findRule, createRule, updateRule, deleteRule,
  listGrants, findGrant, insertGrantIfAbsent, setGrantBonus, setGrantStatus,
  activeStaffForRewards, qualityAvgForProfile,
  METRIC_QUERIES, monthBounds,
};
