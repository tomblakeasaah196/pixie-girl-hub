/**
 * Goals (Chief of Staff, PR1) — repository.
 *
 * SHARED tables (business-scoped): goals, goal_milestones, goal_stakeholders.
 * Tasks/calendar_events carry nullable goal_id/milestone_id back-references.
 * Parameterised SQL only; brand isolation enforced on every read/write.
 */

"use strict";

const { query, ex } = require("../../config/database");

// DATE columns take 'YYYY-MM-DD'; tolerate a full ISO string by keeping the
// date prefix (the validator already guarantees a leading YYYY-MM-DD).
const d = (v) => (v === null || v === undefined ? null : String(v).slice(0, 10));

// ── Goals ──────────────────────────────────────────────────
async function createGoal({ client, goal }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.goals
       (business, title, description, status, priority, owner_user_id,
        target_date, source, template_id, created_by)
     VALUES ($1,$2,$3,COALESCE($4,'active'),COALESCE($5,'normal'),$6,$7,
             COALESCE($8,'manual'),$9,$10)
     RETURNING *`,
    [
      goal.business,
      goal.title,
      goal.description || null,
      goal.status || null,
      goal.priority || null,
      goal.owner_user_id || null,
      d(goal.target_date),
      goal.source || null,
      goal.template_id || null,
      goal.created_by,
    ],
  );
  return rows[0];
}

async function listGoals({
  brand,
  status,
  owner_user_id,
  priority,
  target_before,
  target_after,
  search,
  page = 1,
  page_size = 50,
}) {
  const where = ["g.business = $1", "g.is_deleted = false"];
  const params = [brand];
  let i = 2;
  if (status) {
    where.push(`g.status = $${i++}`);
    params.push(status);
  }
  if (owner_user_id) {
    where.push(`g.owner_user_id = $${i++}`);
    params.push(owner_user_id);
  }
  if (priority) {
    where.push(`g.priority = $${i++}`);
    params.push(priority);
  }
  if (target_before) {
    where.push(`g.target_date <= $${i++}`);
    params.push(d(target_before));
  }
  if (target_after) {
    where.push(`g.target_date >= $${i++}`);
    params.push(d(target_after));
  }
  if (search) {
    where.push(`g.title ILIKE $${i++}`);
    params.push(`%${search}%`);
  }
  const w = `WHERE ${where.join(" AND ")}`;
  const { rows: c } = await query(
    `SELECT count(*)::int AS total FROM shared.goals g ${w}`,
    params,
  );
  const offset = (page - 1) * page_size;
  const { rows } = await query(
    `SELECT g.*,
            uo.display_name AS owner_name,
            (SELECT count(*)::int FROM shared.goal_milestones m
              WHERE m.goal_id = g.goal_id AND m.status <> 'skipped')        AS milestone_total,
            (SELECT count(*)::int FROM shared.goal_milestones m
              WHERE m.goal_id = g.goal_id AND m.status = 'done')            AS milestone_done,
            (SELECT count(*)::int FROM shared.tasks t
              WHERE t.goal_id = g.goal_id AND t.is_deleted = false
                AND t.status <> 'cancelled')                               AS task_total,
            (SELECT count(*)::int FROM shared.tasks t
              WHERE t.goal_id = g.goal_id AND t.is_deleted = false
                AND t.status = 'done')                                     AS task_done
       FROM shared.goals g
       LEFT JOIN shared.users uo ON uo.user_id = g.owner_user_id
       ${w}
       ORDER BY
         CASE g.status WHEN 'active' THEN 0 WHEN 'on_hold' THEN 1 ELSE 2 END,
         (g.target_date IS NULL), g.target_date ASC, g.created_at DESC
       LIMIT $${i++} OFFSET $${i}`,
    [...params, page_size, offset],
  );
  return { data: rows, page, page_size, total: c[0].total };
}

async function findGoal({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT g.*, uo.display_name AS owner_name
       FROM shared.goals g
       LEFT JOIN shared.users uo ON uo.user_id = g.owner_user_id
      WHERE g.goal_id = $1 AND g.business = $2 AND g.is_deleted = false`,
    [id, brand],
  );
  return rows[0] || null;
}

async function updateGoal({ brand, id, patch }) {
  const allowed = [
    "title",
    "description",
    "status",
    "priority",
    "owner_user_id",
    "target_date",
  ];
  const sets = [];
  const params = [];
  let i = 1;
  for (const k of allowed) {
    if (patch[k] !== undefined) {
      sets.push(`${k} = $${i++}`);
      params.push(k === "target_date" ? d(patch[k]) : patch[k]);
    }
  }
  if (!sets.length) return findGoal({ brand, id });
  params.push(id, brand);
  const { rows } = await query(
    `UPDATE shared.goals SET ${sets.join(", ")}, updated_at = now()
      WHERE goal_id = $${i++} AND business = $${i} AND is_deleted = false
      RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function softDeleteGoal({ brand, id }) {
  const { rows } = await query(
    `UPDATE shared.goals SET is_deleted = true, updated_at = now()
      WHERE goal_id = $1 AND business = $2 AND is_deleted = false
      RETURNING goal_id`,
    [id, brand],
  );
  return rows[0] || null;
}

/**
 * Pure progress formula (single source of truth, unit-tested).
 * Equal weight per item: milestones (excluding `skipped`) + directly-linked
 * tasks (excluding `cancelled`). Returns an integer 0–100.
 */
function progressPct({ m_total = 0, m_done = 0, t_total = 0, t_done = 0 }) {
  const total = Number(m_total) + Number(t_total);
  const done = Number(m_done) + Number(t_done);
  if (total <= 0) return 0;
  return Math.round((100 * done) / total);
}

/**
 * Recompute + persist the cached progress_pct from milestones + linked tasks.
 * Computes the four counts, applies the pure formula, and writes it back.
 * Returns the new percentage, or null when the goal no longer exists.
 */
async function recomputeProgress({ client, goal_id }) {
  const run = ex(client);
  const { rows: counts } = await run(
    `SELECT
       (SELECT count(*)::int FROM shared.goal_milestones
         WHERE goal_id = $1 AND status <> 'skipped')                AS m_total,
       (SELECT count(*)::int FROM shared.goal_milestones
         WHERE goal_id = $1 AND status = 'done')                    AS m_done,
       (SELECT count(*)::int FROM shared.tasks
         WHERE goal_id = $1 AND is_deleted = false
           AND status <> 'cancelled')                              AS t_total,
       (SELECT count(*)::int FROM shared.tasks
         WHERE goal_id = $1 AND is_deleted = false
           AND status = 'done')                                    AS t_done`,
    [goal_id],
  );
  const pct = progressPct(counts[0]);
  const { rows } = await run(
    `UPDATE shared.goals SET progress_pct = $2, updated_at = now()
      WHERE goal_id = $1 AND is_deleted = false
      RETURNING progress_pct`,
    [goal_id, pct],
  );
  return rows[0] ? rows[0].progress_pct : null;
}

/**
 * Persist the risk-engine's computed health for a goal (PR4). Only writes when
 * the value actually changes, and returns the row when it did (so the caller
 * can emit a health-changed event) or null when unchanged / gone.
 */
async function setHealth({ brand, goal_id, health }) {
  const { rows } = await query(
    `UPDATE shared.goals SET health = $3, updated_at = now()
      WHERE goal_id = $1 AND business = $2 AND is_deleted = false
        AND health IS DISTINCT FROM $3
      RETURNING goal_id, health`,
    [goal_id, brand, health],
  );
  return rows[0] || null;
}

/** Which goal (if any) a task belongs to — used by the progress subscriber. */
async function goalIdForTask({ task_id }) {
  const { rows } = await query(
    `SELECT goal_id FROM shared.tasks WHERE task_id = $1`,
    [task_id],
  );
  return rows[0] ? rows[0].goal_id : null;
}

// ── Milestones ─────────────────────────────────────────────
async function listMilestones({ goal_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.goal_milestones
      WHERE goal_id = $1 ORDER BY display_order, created_at`,
    [goal_id],
  );
  return rows;
}
async function addMilestone({ client, m }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.goal_milestones
       (goal_id, title, description, target_date, display_order, depends_on_milestone_id)
     VALUES ($1,$2,$3,$4,COALESCE($5,0),$6)
     RETURNING *`,
    [
      m.goal_id,
      m.title,
      m.description || null,
      d(m.target_date),
      m.display_order === undefined ? null : m.display_order,
      m.depends_on_milestone_id || null,
    ],
  );
  return rows[0];
}
async function findMilestone({ milestone_id, goal_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.goal_milestones WHERE milestone_id = $1 AND goal_id = $2`,
    [milestone_id, goal_id],
  );
  return rows[0] || null;
}
async function updateMilestone({ milestone_id, goal_id, patch }) {
  const allowed = [
    "title",
    "description",
    "status",
    "target_date",
    "display_order",
    "depends_on_milestone_id",
  ];
  const sets = [];
  const params = [];
  let i = 1;
  for (const k of allowed) {
    if (patch[k] !== undefined) {
      sets.push(`${k} = $${i++}`);
      params.push(k === "target_date" ? d(patch[k]) : patch[k]);
    }
  }
  // Stamp completed_at from the status transition.
  if (patch.status !== undefined) {
    sets.push(
      `completed_at = CASE WHEN $${i++}::text = 'done' THEN now() ELSE NULL END`,
    );
    params.push(patch.status);
  }
  if (!sets.length) return findMilestone({ milestone_id, goal_id });
  params.push(milestone_id, goal_id);
  const { rows } = await query(
    `UPDATE shared.goal_milestones SET ${sets.join(", ")}, updated_at = now()
      WHERE milestone_id = $${i++} AND goal_id = $${i} RETURNING *`,
    params,
  );
  return rows[0] || null;
}
async function deleteMilestone({ milestone_id, goal_id }) {
  const { rows } = await query(
    `DELETE FROM shared.goal_milestones
      WHERE milestone_id = $1 AND goal_id = $2 RETURNING milestone_id`,
    [milestone_id, goal_id],
  );
  return rows[0] || null;
}

// ── Stakeholders ───────────────────────────────────────────
async function listStakeholders({ goal_id }) {
  const { rows } = await query(
    `SELECT s.*,
            u.display_name AS user_name,
            c.display_name AS contact_name
       FROM shared.goal_stakeholders s
       LEFT JOIN shared.users u    ON u.user_id = s.user_id
       LEFT JOIN shared.contacts c ON c.contact_id = s.contact_id
      WHERE s.goal_id = $1
      ORDER BY s.created_at`,
    [goal_id],
  );
  return rows;
}
async function addStakeholder({ goal_id, user_id, contact_id, role }) {
  const { rows } = await query(
    `INSERT INTO shared.goal_stakeholders (goal_id, user_id, contact_id, role)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [goal_id, user_id || null, contact_id || null, role || null],
  );
  return rows[0] || null;
}
async function deleteStakeholder({ goal_id, stakeholder_id }) {
  const { rows } = await query(
    `DELETE FROM shared.goal_stakeholders
      WHERE stakeholder_id = $1 AND goal_id = $2 RETURNING stakeholder_id`,
    [stakeholder_id, goal_id],
  );
  return rows[0] || null;
}

// ── Linked tasks / events (read + link/unlink) ─────────────
async function listGoalTasks({ brand, goal_id }) {
  const { rows } = await query(
    `SELECT t.*, ua.display_name AS assigned_to_name
       FROM shared.tasks t
       LEFT JOIN shared.users ua ON ua.user_id = t.assigned_to
      WHERE t.goal_id = $1 AND t.business = $2 AND t.is_deleted = false
      ORDER BY (t.due_at IS NULL), t.due_at ASC, t.created_at DESC`,
    [goal_id, brand],
  );
  return rows;
}
async function listGoalEvents({ brand, goal_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.calendar_events
      WHERE goal_id = $1 AND business = $2 AND is_deleted = false
      ORDER BY start_at ASC`,
    [goal_id, brand],
  );
  return rows;
}
async function linkTask({ brand, task_id, goal_id, milestone_id }) {
  const { rows } = await query(
    `UPDATE shared.tasks SET goal_id = $3, milestone_id = $4, updated_at = now()
      WHERE task_id = $1 AND business = $2 AND is_deleted = false
      RETURNING task_id`,
    [task_id, brand, goal_id, milestone_id || null],
  );
  return rows[0] || null;
}
async function unlinkTask({ brand, task_id }) {
  const { rows } = await query(
    `UPDATE shared.tasks SET goal_id = NULL, milestone_id = NULL, updated_at = now()
      WHERE task_id = $1 AND business = $2 RETURNING task_id`,
    [task_id, brand],
  );
  return rows[0] || null;
}
async function linkEvent({ brand, event_id, goal_id, milestone_id }) {
  const { rows } = await query(
    `UPDATE shared.calendar_events SET goal_id = $3, milestone_id = $4, updated_at = now()
      WHERE event_id = $1 AND business = $2 AND is_deleted = false
      RETURNING event_id`,
    [event_id, brand, goal_id, milestone_id || null],
  );
  return rows[0] || null;
}
async function unlinkEvent({ brand, event_id }) {
  const { rows } = await query(
    `UPDATE shared.calendar_events SET goal_id = NULL, milestone_id = NULL, updated_at = now()
      WHERE event_id = $1 AND business = $2 RETURNING event_id`,
    [event_id, brand],
  );
  return rows[0] || null;
}

module.exports = {
  progressPct,
  createGoal,
  listGoals,
  findGoal,
  updateGoal,
  softDeleteGoal,
  recomputeProgress,
  setHealth,
  goalIdForTask,
  listMilestones,
  addMilestone,
  findMilestone,
  updateMilestone,
  deleteMilestone,
  listStakeholders,
  addStakeholder,
  deleteStakeholder,
  listGoalTasks,
  listGoalEvents,
  linkTask,
  unlinkTask,
  linkEvent,
  unlinkEvent,
};
