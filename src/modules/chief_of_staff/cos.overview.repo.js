/**
 * Chief of Staff (PR5) — cross-brand overview repository.
 *
 * Because shared.goals / goal_milestones / tasks are shared-schema and
 * business-tagged, "cross-brand" is a FILTER RELAXATION for the CEO — not new
 * isolation-breaking code. These reads aggregate over an explicit list of the
 * CEO's brands (business = ANY($1)); brand-context middleware is bypassed only
 * here, only for the CEO, and only for reads. Parameterised SQL only.
 */

"use strict";

const { query } = require("../../config/database");

/** Per-brand goal health + average progress for the active portfolio. */
async function goalHealthByBrand({ businesses }) {
  const { rows } = await query(
    `SELECT g.business,
            count(*) FILTER (WHERE g.status = 'active')                       AS active_goals,
            count(*) FILTER (WHERE g.status = 'active' AND g.health = 'on_track') AS on_track,
            count(*) FILTER (WHERE g.status = 'active' AND g.health = 'at_risk')  AS at_risk,
            count(*) FILTER (WHERE g.status = 'active' AND g.health = 'behind')   AS behind,
            count(*) FILTER (WHERE g.status = 'achieved')                     AS achieved,
            COALESCE(round(avg(g.progress_pct) FILTER (WHERE g.status = 'active')), 0) AS avg_progress
       FROM shared.goals g
      WHERE g.business = ANY($1::text[]) AND g.is_deleted = false
      GROUP BY g.business`,
    [businesses || []],
  );
  return rows;
}

/** Per-brand overdue counts (open milestones/tasks past their date). */
async function overdueByBrand({ businesses }) {
  const { rows } = await query(
    `SELECT g.business,
            count(DISTINCT m.milestone_id) FILTER (
              WHERE m.target_date < CURRENT_DATE AND m.status NOT IN ('done','skipped')
            ) AS overdue_milestones,
            count(DISTINCT t.task_id) FILTER (
              WHERE t.due_at < now() AND t.status NOT IN ('done','cancelled')
            ) AS overdue_tasks
       FROM shared.goals g
       LEFT JOIN shared.goal_milestones m ON m.goal_id = g.goal_id
       LEFT JOIN shared.tasks t ON t.goal_id = g.goal_id AND t.is_deleted = false
      WHERE g.business = ANY($1::text[]) AND g.is_deleted = false
      GROUP BY g.business`,
    [businesses || []],
  );
  return rows;
}

/** Display names for the brands (from business_config). */
async function brandNames({ businesses }) {
  const { rows } = await query(
    `SELECT business_key, display_name FROM shared.business_config
      WHERE business_key = ANY($1::text[])`,
    [businesses || []],
  );
  const map = {};
  for (const r of rows) map[r.business_key] = r.display_name;
  return map;
}

module.exports = { goalHealthByBrand, overdueByBrand, brandNames };
