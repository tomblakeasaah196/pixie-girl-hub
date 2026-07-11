/**
 * Chief of Staff (PR4) — risk engine.
 *
 * PURE functions over goals / milestones / tasks (NO LLM, NO DB). The scanner
 * (cos.accountability.repo + the cos-accountability scheduler) fetches the rows,
 * calls `assessGoal` here, persists the returned health, and turns the returned
 * candidates into follow-ups + action-button notifications.
 *
 * Three risk signals (§PR4):
 *   no_progress — a goal with children but no child status change in ≥ N days.
 *   slippage    — projected completion (from milestone velocity) runs past the
 *                 target_date → sets goals.health (on_track | at_risk | behind).
 *   due buckets — due_tomorrow / due_today / overdue from a task's due_at or a
 *                 milestone's target_date.
 *
 * Everything is deterministic and side-effect free so it unit-tests by passing
 * plain objects and a fixed `now`.
 */

"use strict";

// Tuning knobs (overridable via env, but sane defaults so PR4 needs no env).
const STALE_DAYS = Number(process.env.COS_STALE_DAYS) || 14;
// How many days a projected completion may run past target before it escalates
// from "at risk" to "behind".
const BEHIND_SLIP_DAYS = Number(process.env.COS_BEHIND_SLIP_DAYS) || 7;

const HEALTH = Object.freeze({
  ON_TRACK: "on_track",
  AT_RISK: "at_risk",
  BEHIND: "behind",
  ACHIEVED: "achieved",
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** A UTC calendar day index, so "today/tomorrow" ignore clock time. */
function dayIndex(value) {
  const d = new Date(value);
  return Math.floor(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY_MS,
  );
}

/** Whole days from `from` → `to` (calendar-day granularity, signed). */
function daysUntil(to, from) {
  return dayIndex(to) - dayIndex(from);
}

const isOpenTask = (t) => t && t.status !== "done" && t.status !== "cancelled";
const isOpenMilestone = (m) =>
  m && m.status !== "done" && m.status !== "skipped";

/**
 * Bucket a due date relative to `now`: overdue (past) / due_today / due_tomorrow
 * / null (further out or absent). Calendar-day based.
 */
function dueBucket(dueValue, now) {
  if (!dueValue) return null;
  const delta = daysUntil(dueValue, now);
  if (delta < 0) return "overdue";
  if (delta === 0) return "due_today";
  if (delta === 1) return "due_tomorrow";
  return null;
}

/** True when a goal has had no child activity for ≥ staleDays. */
function isStale({ lastActivityAt, now, staleDays = STALE_DAYS }) {
  if (!lastActivityAt) return false;
  return daysUntil(now, lastActivityAt) >= staleDays;
}

/**
 * Project a goal's completion from milestone velocity and compare to target.
 * Returns { velocity, projectedDate|null, slipDays|null } where slipDays > 0
 * means "projected to finish that many days past target". Velocity is
 * done-milestones per day since the goal was created.
 */
function projectSlippage({ goal, milestones, now }) {
  const active = (milestones || []).filter(
    (m) => m.status !== "skipped",
  );
  const total = active.length;
  const done = active.filter((m) => m.status === "done").length;
  const remaining = total - done;

  if (!goal.target_date) return { velocity: 0, projectedDate: null, slipDays: null };
  if (total === 0) return { velocity: 0, projectedDate: null, slipDays: null };

  // All milestones done → no remaining work to slip.
  if (remaining === 0) return { velocity: 0, projectedDate: null, slipDays: null };

  const elapsedDays = Math.max(1, daysUntil(now, goal.created_at));
  const velocity = done / elapsedDays; // milestones/day

  // No completed milestone yet: fall back to time-consumed heuristic — if the
  // deadline is already within reach but nothing's done, project overrun by the
  // remaining count in days (1 milestone/day floor) so a stalled goal still
  // registers as slipping rather than silently on_track.
  const perMilestoneDays = velocity > 0 ? 1 / velocity : elapsedDays / Math.max(1, done || 1);
  const daysToFinish = remaining * (velocity > 0 ? perMilestoneDays : Math.max(perMilestoneDays, 1));
  const projected = new Date(now).getTime() + daysToFinish * DAY_MS;
  const projectedDate = new Date(projected);
  const slipDays = daysUntil(projectedDate, goal.target_date);
  return { velocity, projectedDate, slipDays };
}

/**
 * Overall health for a goal from its signals. Precedence:
 *   achieved → behind → at_risk → on_track.
 */
function computeHealth({ goal, milestones, tasks, slip, stale, now }) {
  if (goal.status === "achieved" || Number(goal.progress_pct) >= 100)
    return HEALTH.ACHIEVED;

  const overdueMilestone = (milestones || []).some(
    (m) => isOpenMilestone(m) && dueBucket(m.target_date, now) === "overdue",
  );
  const overdueTask = (tasks || []).some(
    (t) => isOpenTask(t) && dueBucket(t.due_at, now) === "overdue",
  );

  // Behind: something is already overdue, or we project to blow the target by
  // more than the escalation window.
  if (overdueMilestone || overdueTask) return HEALTH.BEHIND;
  if (slip && slip.slipDays !== null && slip.slipDays > BEHIND_SLIP_DAYS)
    return HEALTH.BEHIND;

  // At risk: projected past target at all, or gone stale with no progress.
  if (slip && slip.slipDays !== null && slip.slipDays > 0) return HEALTH.AT_RISK;
  if (stale) return HEALTH.AT_RISK;

  return HEALTH.ON_TRACK;
}

// Human-readable follow-up question per trigger/subject.
function questionFor({ trigger, subjectTitle }) {
  const t = subjectTitle ? `“${String(subjectTitle).slice(0, 80)}”` : "this";
  switch (trigger) {
    case "overdue":
      return `${t} is overdue — where does it stand?`;
    case "due_today":
      return `${t} is due today — is it done?`;
    case "due_tomorrow":
      return `${t} is due tomorrow — on track?`;
    case "no_progress":
      return `No movement on ${t} for a while — what's the status?`;
    case "slippage":
      return `${t} is projected to miss its target date — how do you want to handle it?`;
    default:
      return `How is ${t} going?`;
  }
}

/**
 * Assess one goal and everything under it. Returns:
 *   { health, candidates: [{ subject_type, subject_id, trigger, question,
 *                            subject_title, priority }] }
 * The scanner dedupes candidates against existing open follow-ups before it
 * creates notifications, so producing a candidate here is cheap and idempotent.
 */
function assessGoal({ goal, milestones = [], tasks = [], lastActivityAt, now = new Date(), staleDays = STALE_DAYS }) {
  const slip = projectSlippage({ goal, milestones, now });
  const stale =
    goal.status === "active" &&
    (milestones.length > 0 || tasks.length > 0) &&
    isStale({ lastActivityAt, now, staleDays });
  const health = computeHealth({ goal, milestones, tasks, slip, stale, now });

  const candidates = [];
  const goalActive = goal.status === "active" || goal.status === "on_hold";

  if (goalActive && stale) {
    candidates.push({
      subject_type: "goal",
      subject_id: goal.goal_id,
      trigger: "no_progress",
      subject_title: goal.title,
      priority: "normal",
      question: questionFor({ trigger: "no_progress", subjectTitle: goal.title }),
    });
  }

  if (goalActive && slip.slipDays !== null && slip.slipDays > 0) {
    candidates.push({
      subject_type: "goal",
      subject_id: goal.goal_id,
      trigger: "slippage",
      subject_title: goal.title,
      priority: slip.slipDays > BEHIND_SLIP_DAYS ? "high" : "normal",
      question: questionFor({ trigger: "slippage", subjectTitle: goal.title }),
      meta: { slip_days: slip.slipDays, projected_date: slip.projectedDate },
    });
  }

  for (const m of milestones) {
    if (!isOpenMilestone(m)) continue;
    const bucket = dueBucket(m.target_date, now);
    if (!bucket) continue;
    candidates.push({
      subject_type: "milestone",
      subject_id: m.milestone_id,
      trigger: bucket,
      subject_title: m.title,
      goal_id: goal.goal_id,
      priority: bucket === "overdue" ? "high" : "normal",
      question: questionFor({ trigger: bucket, subjectTitle: m.title }),
    });
  }

  for (const t of tasks) {
    if (!isOpenTask(t)) continue;
    const bucket = dueBucket(t.due_at, now);
    if (!bucket) continue;
    candidates.push({
      subject_type: "task",
      subject_id: t.task_id,
      trigger: bucket,
      subject_title: t.title,
      goal_id: goal.goal_id,
      priority: bucket === "overdue" ? "high" : t.priority === "urgent" ? "high" : "normal",
      question: questionFor({ trigger: bucket, subjectTitle: t.title }),
    });
  }

  return { health, slip, candidates };
}

module.exports = {
  HEALTH,
  STALE_DAYS,
  BEHIND_SLIP_DAYS,
  daysUntil,
  dueBucket,
  isStale,
  projectSlippage,
  computeHealth,
  questionFor,
  assessGoal,
};
