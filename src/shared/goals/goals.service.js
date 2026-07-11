/**
 * Goals (Chief of Staff, PR1) — business logic.
 *
 * Goals sit above the existing Workspace tasks/calendar: a goal owns
 * milestones and links (not moves) tasks/events to itself via their nullable
 * goal_id. `progress_pct` is a cached rollup recomputed whenever a milestone
 * or a linked task changes (equal weight per item). No AI here — the Chief of
 * Staff agent (PR3) drives these same endpoints through the confirm gate.
 */

"use strict";

const repo = require("./goals.repo");
const events = require("./goals.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { logger } = require("../../config/logger");
const { NotFoundError } = require("../../utils/errors");

const A = (brand, user, action_key, target_type, target_id, after, request_id) =>
  audit({
    business: brand,
    user_id: user ? user.user_id : null,
    action_key,
    target_type,
    target_id,
    after,
    request_id,
  });

/** Recompute + persist a goal's progress, then emit a thin signal. Best-effort. */
async function refreshProgress({ brand, goal_id, client }) {
  const pct = await repo.recomputeProgress({ client, goal_id });
  if (pct !== null && !client)
    events.emit("goal.progress", { brand, goal_id, progress_pct: pct });
  return pct;
}

// ── Goals ──────────────────────────────────────────────────
function listGoals(args) {
  return repo.listGoals(args);
}

async function getGoal({ brand, id }) {
  const goal = await repo.findGoal({ brand, id });
  if (!goal) throw new NotFoundError("Goal");
  // Reads self-heal the cached progress so the detail view is always accurate.
  const pct = await repo.recomputeProgress({ goal_id: id });
  if (pct !== null) goal.progress_pct = pct;
  const [milestones, tasks, calendar_events, stakeholders] = await Promise.all([
    repo.listMilestones({ goal_id: id }),
    repo.listGoalTasks({ brand, goal_id: id }),
    repo.listGoalEvents({ brand, goal_id: id }),
    repo.listStakeholders({ goal_id: id }),
  ]);
  return { ...goal, milestones, tasks, calendar_events, stakeholders };
}

async function createGoal({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const goal = await repo.createGoal({
      client,
      goal: {
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        owner_user_id: input.owner_user_id,
        target_date: input.target_date,
        source: input.source, // undefined via HTTP -> 'manual'; CoS may set 'cos'
        template_id: input.template_id,
        business: brand,
        created_by: user.user_id,
      },
    });
    const milestones = [];
    for (const m of input.milestones || [])
      milestones.push(
        await repo.addMilestone({ client, m: { ...m, goal_id: goal.goal_id } }),
      );
    const pct = await repo.recomputeProgress({ client, goal_id: goal.goal_id });
    if (pct !== null) goal.progress_pct = pct;
    await A(brand, user, "goals.create", "goal", goal.goal_id, { title: goal.title }, request_id);
    events.emit("goal.created", { brand, goal_id: goal.goal_id });
    return { ...goal, milestones };
  });
}

async function updateGoal({ brand, user, request_id, id, patch }) {
  const before = await repo.findGoal({ brand, id });
  if (!before) throw new NotFoundError("Goal");
  const goal = await repo.updateGoal({ brand, id, patch });
  await A(brand, user, "goals.update", "goal", id, goal, request_id);
  events.emit("goal.updated", { brand, goal_id: id });
  return goal;
}

async function deleteGoal({ brand, user, request_id, id }) {
  const ok = await repo.softDeleteGoal({ brand, id });
  if (!ok) throw new NotFoundError("Goal");
  await A(brand, user, "goals.delete", "goal", id, null, request_id);
  events.emit("goal.deleted", { brand, goal_id: id });
}

// ── Milestones ─────────────────────────────────────────────
async function addMilestone({ brand, user, request_id, id, input }) {
  const goal = await repo.findGoal({ brand, id });
  if (!goal) throw new NotFoundError("Goal");
  const m = await repo.addMilestone({ m: { ...input, goal_id: id } });
  await refreshProgress({ brand, goal_id: id });
  await A(brand, user, "goals.milestone.add", "goal", id, { milestone_id: m.milestone_id }, request_id);
  events.emit("milestone.created", { brand, goal_id: id, milestone_id: m.milestone_id });
  return m;
}

async function updateMilestone({ brand, user, request_id, id, milestone_id, patch }) {
  const goal = await repo.findGoal({ brand, id });
  if (!goal) throw new NotFoundError("Goal");
  const m = await repo.updateMilestone({ milestone_id, goal_id: id, patch });
  if (!m) throw new NotFoundError("Milestone");
  await refreshProgress({ brand, goal_id: id });
  await A(brand, user, "goals.milestone.update", "goal", id, { milestone_id, patch }, request_id);
  events.emit("milestone.updated", { brand, goal_id: id, milestone_id });
  return m;
}

async function deleteMilestone({ brand, user, request_id, id, milestone_id }) {
  const goal = await repo.findGoal({ brand, id });
  if (!goal) throw new NotFoundError("Goal");
  const ok = await repo.deleteMilestone({ milestone_id, goal_id: id });
  if (!ok) throw new NotFoundError("Milestone");
  await refreshProgress({ brand, goal_id: id });
  await A(brand, user, "goals.milestone.delete", "goal", id, { milestone_id }, request_id);
  events.emit("milestone.updated", { brand, goal_id: id, milestone_id });
}

// ── Stakeholders ───────────────────────────────────────────
async function addStakeholder({ brand, user, request_id, id, input }) {
  const goal = await repo.findGoal({ brand, id });
  if (!goal) throw new NotFoundError("Goal");
  const s = await repo.addStakeholder({ goal_id: id, ...input });
  await A(brand, user, "goals.stakeholder.add", "goal", id, input, request_id);
  events.emit("goal.updated", { brand, goal_id: id });
  return s; // null when already present (idempotent)
}

async function removeStakeholder({ brand, user, request_id, id, stakeholder_id }) {
  const goal = await repo.findGoal({ brand, id });
  if (!goal) throw new NotFoundError("Goal");
  const ok = await repo.deleteStakeholder({ goal_id: id, stakeholder_id });
  if (!ok) throw new NotFoundError("Stakeholder");
  await A(brand, user, "goals.stakeholder.remove", "goal", id, { stakeholder_id }, request_id);
  events.emit("goal.updated", { brand, goal_id: id });
}

// ── Linking tasks / events ─────────────────────────────────
async function linkTask({ brand, user, request_id, id, task_id, milestone_id }) {
  const goal = await repo.findGoal({ brand, id });
  if (!goal) throw new NotFoundError("Goal");
  const ok = await repo.linkTask({ brand, task_id, goal_id: id, milestone_id });
  if (!ok) throw new NotFoundError("Task");
  await refreshProgress({ brand, goal_id: id });
  await A(brand, user, "goals.task.link", "goal", id, { task_id, milestone_id }, request_id);
  events.emit("goal.updated", { brand, goal_id: id });
}

async function unlinkTask({ brand, user, request_id, id, task_id }) {
  const goal = await repo.findGoal({ brand, id });
  if (!goal) throw new NotFoundError("Goal");
  const ok = await repo.unlinkTask({ brand, task_id });
  if (!ok) throw new NotFoundError("Task");
  await refreshProgress({ brand, goal_id: id });
  await A(brand, user, "goals.task.unlink", "goal", id, { task_id }, request_id);
  events.emit("goal.updated", { brand, goal_id: id });
}

async function linkEvent({ brand, user, request_id, id, event_id, milestone_id }) {
  const goal = await repo.findGoal({ brand, id });
  if (!goal) throw new NotFoundError("Goal");
  const ok = await repo.linkEvent({ brand, event_id, goal_id: id, milestone_id });
  if (!ok) throw new NotFoundError("Event");
  await A(brand, user, "goals.event.link", "goal", id, { event_id, milestone_id }, request_id);
  events.emit("goal.updated", { brand, goal_id: id });
}

async function unlinkEvent({ brand, user, request_id, id, event_id }) {
  const goal = await repo.findGoal({ brand, id });
  if (!goal) throw new NotFoundError("Goal");
  const ok = await repo.unlinkEvent({ brand, event_id });
  if (!ok) throw new NotFoundError("Event");
  await A(brand, user, "goals.event.unlink", "goal", id, { event_id }, request_id);
  events.emit("goal.updated", { brand, goal_id: id });
}

/**
 * Cross-module hook: a linked task's status changed on the Tasks board, so the
 * owning goal's progress must refresh. Called by the goals event subscriber
 * (goals.subscribers.js). Best-effort — a miss only leaves the cache stale
 * until the goal is next opened (getGoal self-heals).
 */
async function recomputeForTask({ brand, task_id }) {
  try {
    const goal_id = await repo.goalIdForTask({ task_id });
    if (goal_id) await refreshProgress({ brand, goal_id });
  } catch (err) {
    logger.error({ err: err.message, task_id }, "goals: progress recompute failed");
  }
}

module.exports = {
  listGoals,
  getGoal,
  createGoal,
  updateGoal,
  deleteGoal,
  addMilestone,
  updateMilestone,
  deleteMilestone,
  addStakeholder,
  removeStakeholder,
  linkTask,
  unlinkTask,
  linkEvent,
  unlinkEvent,
  recomputeForTask,
};
