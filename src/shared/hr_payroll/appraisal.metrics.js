/**
 * Appraisal auto-score metric providers (V2.2 §6.11, PR-B).
 *
 * Each provider computes one KPI signal for every staff member over a cycle
 * window [from, to) (upper-exclusive), keyed by profile_id. They read the same
 * sources the rewards engine uses, so appraisal scores and reward grants stay
 * consistent:
 *   - clock_in_data       → shared.attendance_days (on-time %)
 *   - sales_data          → shared.performance_targets (target attainment %)
 *   - service_job_ratings → <brand>.service_jobs.quality_rating (avg 1–5)
 *   - customer_ratings    → <brand>.service_jobs.customer_rating (avg 1–5)
 *
 * Parameterised SQL only. Returns Maps keyed by profile_id so the engine can
 * fan the values out to each staff member in one pass.
 */

"use strict";

const { query, ex } = require("../../config/database");
const { t } = require("../../config/brands");

const run = (client) => (client ? ex(client) : query);

/**
 * On-time attendance: present days and punctual (present, not late) days.
 * on_time_pct = punctual / present * 100. no_data when there were no present
 * days in the window.
 * @returns {Promise<Map<string,{present_days:number,punctual_days:number}>>}
 */
async function onTimeByProfile({ client, brand, from, to }) {
  const { rows } = await run(client)(
    `SELECT profile_id,
            count(*) FILTER (WHERE status IN ('present','late'))::int AS present_days,
            count(*) FILTER (WHERE status = 'present' AND is_late = false)::int AS punctual_days
       FROM shared.attendance_days
      WHERE business = $1 AND work_date >= $2 AND work_date < $3
      GROUP BY profile_id`,
    [brand, from, to],
  );
  const m = new Map();
  for (const r of rows)
    m.set(r.profile_id, {
      present_days: r.present_days,
      punctual_days: r.punctual_days,
    });
  return m;
}

/**
 * Sales target attainment: average of current_value/target_value across the
 * staff member's monthly SALES targets whose period falls in the window
 * (capped at 200% per target so one blow-out month can't dominate).
 * @returns {Promise<Map<string,{attainment_pct:number,target_count:number}>>}
 */
async function salesAttainmentByProfile({ client, brand, from, to }) {
  const { rows } = await run(client)(
    `SELECT profile_id,
            avg(LEAST(current_value / NULLIF(target_value, 0), 2.0)) AS attainment,
            count(*)::int AS target_count
       FROM shared.performance_targets
      WHERE business = $1 AND source = 'sales'
        AND make_date(period_year, period_month, 1) >= $2
        AND make_date(period_year, period_month, 1) < $3
      GROUP BY profile_id`,
    [brand, from, to],
  );
  const m = new Map();
  for (const r of rows)
    m.set(r.profile_id, {
      attainment_pct:
        r.attainment === null || r.attainment === undefined
          ? null
          : Math.round(Number(r.attainment) * 100),
      target_count: r.target_count,
    });
  return m;
}

/** Average service-job rating (1–5) over the window, keyed by profile. */
async function ratingByProfile({ client, brand, from, to, column }) {
  // column is a fixed identifier (quality_rating | customer_rating) — never user input.
  const col = column === "customer_rating" ? "customer_rating" : "quality_rating";
  const { rows } = await run(client)(
    `SELECT sp.profile_id,
            round(avg(j.${col})::numeric, 2) AS avg,
            count(*)::int AS n
       FROM ${t(brand, "service_jobs")} j
       JOIN shared.users u ON u.user_id = j.assigned_staff_user_id
       JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
      WHERE j.${col} IS NOT NULL
        AND j.completed_at >= $2 AND j.completed_at < $3
      GROUP BY sp.profile_id`,
    [brand, from, to],
  ).catch(() => ({ rows: [] }));
  const m = new Map();
  for (const r of rows)
    m.set(r.profile_id, {
      avg: r.avg === null || r.avg === undefined ? null : Number(r.avg),
      n: r.n,
    });
  return m;
}

const qualityByProfile = (args) =>
  ratingByProfile({ ...args, column: "quality_rating" });
const customerRatingByProfile = (args) =>
  ratingByProfile({ ...args, column: "customer_rating" });

module.exports = {
  onTimeByProfile,
  salesAttainmentByProfile,
  qualityByProfile,
  customerRatingByProfile,
};
