/**
 * Chief of Staff (PR4) — accountability repository.
 *
 * SHARED tables: cos_followups (the follow-up state machine) + cos_nudges (the
 * dedupe / adaptive-timing log). Also the risk-scan reads over goals /
 * milestones / tasks that the hourly scheduler feeds to cos.risk. Parameterised
 * SQL only; every read/write is brand- (and, for follow-ups, user-) scoped.
 *
 * `"trigger"` is quoted throughout — it is a SQL keyword.
 */

"use strict";

const { query, ex } = require("../../config/database");

// ── Risk-scan reads ────────────────────────────────────────
/** Active/on-hold, non-deleted goals for a brand (the risk-scan universe). */
async function listGoalsForRisk({ brand }) {
  const { rows } = await query(
    `SELECT * FROM shared.goals
      WHERE business = $1 AND is_deleted = false
        AND status IN ('active','on_hold')
      ORDER BY created_at`,
    [brand],
  );
  return rows;
}

/** The most recent child/goal activity timestamp, for no-progress detection. */
async function lastActivityForGoal({ goal_id }) {
  const { rows } = await query(
    `SELECT GREATEST(
              (SELECT max(updated_at) FROM shared.goals WHERE goal_id = $1),
              COALESCE((SELECT max(GREATEST(updated_at, COALESCE(completed_at, updated_at)))
                          FROM shared.goal_milestones WHERE goal_id = $1), 'epoch'),
              COALESCE((SELECT max(GREATEST(updated_at, COALESCE(completed_at, updated_at)))
                          FROM shared.tasks
                         WHERE goal_id = $1 AND is_deleted = false), 'epoch')
            ) AS last_activity_at`,
    [goal_id],
  );
  return rows[0] ? rows[0].last_activity_at : null;
}

/** Open (non-done/skipped) milestones on a goal, oldest target first. */
async function openMilestones({ goal_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.goal_milestones
      WHERE goal_id = $1 AND status NOT IN ('done','skipped')
      ORDER BY (target_date IS NULL), target_date, display_order`,
    [goal_id],
  );
  return rows;
}

/** Every non-skipped milestone (for velocity/slippage), ordered. */
async function allMilestones({ goal_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.goal_milestones
      WHERE goal_id = $1 ORDER BY display_order, created_at`,
    [goal_id],
  );
  return rows;
}

/** Open (non-done/cancelled) linked tasks on a goal. */
async function openGoalTasks({ brand, goal_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.tasks
      WHERE goal_id = $1 AND business = $2 AND is_deleted = false
        AND status NOT IN ('done','cancelled')
      ORDER BY (due_at IS NULL), due_at`,
    [goal_id, brand],
  );
  return rows;
}

/** A single milestone (to resolve its goal_id / target_date on respond/act). */
async function findMilestoneById({ milestone_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.goal_milestones WHERE milestone_id = $1`,
    [milestone_id],
  );
  return rows[0] || null;
}

/** End-of-day counts for a brand's evening review. */
async function eveningStats({ brand }) {
  const { rows } = await query(
    `SELECT
       (SELECT count(*)::int FROM shared.goals
         WHERE business = $1 AND is_deleted = false AND status = 'active')          AS active_goals,
       (SELECT count(*)::int FROM shared.tasks
         WHERE business = $1 AND is_deleted = false AND status = 'done'
           AND completed_at >= date_trunc('day', now()))                            AS completed_today,
       (SELECT count(*)::int FROM shared.tasks
         WHERE business = $1 AND is_deleted = false
           AND status NOT IN ('done','cancelled')
           AND due_at >= date_trunc('day', now())
           AND due_at <  date_trunc('day', now()) + interval '1 day')               AS due_today_open,
       (SELECT count(*)::int FROM shared.tasks
         WHERE business = $1 AND is_deleted = false
           AND status NOT IN ('done','cancelled') AND due_at < now())               AS overdue_open`,
    [brand],
  );
  return rows[0];
}

/** A single task within a brand (respond/act subject resolution). */
async function findTaskById({ brand, task_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.tasks
      WHERE task_id = $1 AND business = $2 AND is_deleted = false`,
    [task_id, brand],
  );
  return rows[0] || null;
}

// ── Follow-ups ─────────────────────────────────────────────
async function createFollowup({ client, f }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.cos_followups
       (business, user_id, subject_type, subject_id, "trigger", state,
        question, suggested_actions)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,'open'),$7,COALESCE($8,'[]'::jsonb))
     RETURNING *`,
    [
      f.business,
      f.user_id,
      f.subject_type,
      f.subject_id,
      f.trigger,
      f.state || null,
      f.question || null,
      f.suggested_actions ? JSON.stringify(f.suggested_actions) : null,
    ],
  );
  return rows[0];
}

/**
 * A live or recently-closed follow-up for this (subject, trigger). Blocks a
 * duplicate nudge while one is open/asked, and within `cooldownHours` after it
 * was answered/resolved/dismissed so an acknowledged item isn't re-pinged next
 * hour. Returns the row (any state) if one qualifies, else null.
 */
async function findBlockingFollowup({ subject_type, subject_id, trigger, cooldown_hours = 20 }) {
  const { rows } = await query(
    `SELECT * FROM shared.cos_followups
      WHERE subject_type = $1 AND subject_id = $2 AND "trigger" = $3
        AND (
          state IN ('open','asked')
          OR (state = 'snoozed' AND (snooze_until IS NULL OR snooze_until > now()))
          OR (state IN ('answered','resolved','dismissed')
              AND updated_at > now() - ($4 || ' hours')::interval)
        )
      ORDER BY created_at DESC
      LIMIT 1`,
    [subject_type, subject_id, trigger, String(cooldown_hours)],
  );
  return rows[0] || null;
}

async function findFollowupForUser({ id, user_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.cos_followups WHERE followup_id = $1 AND user_id = $2`,
    [id, user_id],
  );
  return rows[0] || null;
}

async function updateFollowup({ client, id, fields = {} }) {
  const sets = [];
  const params = [id];
  let i = 2;
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = $${i++}`);
    params.push(
      k === "suggested_actions" && v !== null && v !== undefined
        ? JSON.stringify(v)
        : v,
    );
  }
  if (!sets.length) {
    const { rows } = await ex(client)(
      `SELECT * FROM shared.cos_followups WHERE followup_id = $1`,
      [id],
    );
    return rows[0] || null;
  }
  const { rows } = await ex(client)(
    `UPDATE shared.cos_followups SET ${sets.join(", ")}
      WHERE followup_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

/** Open follow-ups for a user (optionally scoped to one subject). */
async function listOpenFollowups({ user_id, subject_type, subject_id }) {
  const where = ["user_id = $1", "state IN ('open','asked','answered')"];
  const params = [user_id];
  let i = 2;
  if (subject_type) {
    where.push(`subject_type = $${i++}`);
    params.push(subject_type);
  }
  if (subject_id) {
    where.push(`subject_id = $${i++}`);
    params.push(subject_id);
  }
  const { rows } = await query(
    `SELECT * FROM shared.cos_followups
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC`,
    params,
  );
  return rows;
}

/** Snoozed follow-ups whose snooze window has elapsed (scheduler re-arms them). */
async function listSnoozedDue({ business }) {
  const { rows } = await query(
    `SELECT * FROM shared.cos_followups
      WHERE business = $1 AND state = 'snoozed'
        AND snooze_until IS NOT NULL AND snooze_until <= now()`,
    [business],
  );
  return rows;
}

// ── Nudges (dedupe + adaptive-timing log) ──────────────────
async function logNudge({ client, n }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.cos_nudges
       (user_id, business, type, channel, reference_type, reference_id)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      n.user_id,
      n.business,
      n.type,
      n.channel,
      n.reference_type || null,
      n.reference_id || null,
    ],
  );
  return rows[0];
}

/**
 * Has a nudge of `type` gone to this user for this brand since `sinceIso`?
 * Used to keep the morning briefing / evening review to once per day even if
 * the hourly scheduler ticks many times inside the window.
 */
async function nudgeSentSince({ user_id, business, type, since }) {
  const { rows } = await query(
    `SELECT 1 FROM shared.cos_nudges
      WHERE user_id = $1 AND business = $2 AND type = $3 AND sent_at >= $4
      LIMIT 1`,
    [user_id, business, type, since],
  );
  return rows.length > 0;
}

/**
 * Mark the nudges behind a reference as engaged (the CEO acted on the nudge).
 * Only the first engagement sticks (engaged_at IS NULL guard), so the timing
 * signal reflects when she first responded. Best-effort — never throws for the
 * caller (adaptive timing is a nicety, not a correctness path).
 */
async function markNudgeEngaged({ reference_type, reference_id }) {
  if (!reference_id) return 0;
  const { rowCount } = await query(
    `UPDATE shared.cos_nudges
        SET engaged_at = now()
      WHERE reference_type = $1 AND reference_id = $2 AND engaged_at IS NULL`,
    [reference_type, reference_id],
  );
  return rowCount;
}

/**
 * The engaged_at timestamps for a user over the last `days`, for adaptive
 * timing (wow #8, PR6). The scheduler converts each to the CEO's local hour.
 */
async function recentEngagedNudges({ user_id, days = 45 }) {
  const { rows } = await query(
    `SELECT engaged_at FROM shared.cos_nudges
      WHERE user_id = $1 AND engaged_at IS NOT NULL
        AND engaged_at >= now() - ($2 || ' days')::interval
      ORDER BY engaged_at DESC
      LIMIT 200`,
    [user_id, String(days)],
  );
  return rows.map((r) => r.engaged_at);
}

/** Has a celebration nudge already fired for this subject? (dedupe, PR6) */
async function celebrationExists({ reference_type, reference_id }) {
  const { rows } = await query(
    `SELECT 1 FROM shared.cos_nudges
      WHERE type = 'celebration' AND reference_type = $1 AND reference_id = $2
      LIMIT 1`,
    [reference_type, reference_id],
  );
  return rows.length > 0;
}

module.exports = {
  // scan reads
  listGoalsForRisk,
  lastActivityForGoal,
  openMilestones,
  allMilestones,
  openGoalTasks,
  findMilestoneById,
  findTaskById,
  eveningStats,
  // follow-ups
  createFollowup,
  findBlockingFollowup,
  findFollowupForUser,
  updateFollowup,
  listOpenFollowups,
  listSnoozedDue,
  // nudges
  logNudge,
  nudgeSentSince,
  markNudgeEngaged,
  recentEngagedNudges,
  celebrationExists,
};
