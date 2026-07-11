/**
 * Chief of Staff (PR5) — playbook templates (wow #9, hybrid).
 *
 * "Save as playbook" captures a goal's shape — its milestones and tasks as
 * DAY-OFFSETS from the goal's start — into shared.goal_templates. Reusing a
 * playbook re-dates every offset from a chosen start date and assembles a
 * deterministic batch plan (create_goal → milestones → tasks + links) that the
 * CEO approves once, exactly like a chat-proposed plan. usage_count++ on reuse.
 *
 * The offset<->date maths is pure (structureFromGoal / stepsFromTemplate), so
 * the capture→instantiate round-trip is unit-testable without a DB.
 */

"use strict";

const repo = require("./cos.templates.repo");
const planBuilder = require("./cos.plan-builder");
const goalsRepo = require("../../shared/goals/goals.repo");
const { audit } = require("../../middleware/audit");
const { NotFoundError, AppError } = require("../../utils/errors");
const { VALID_BRANDS } = require("../../config/brands");

const CONVERSATION_TITLE = "Chief of Staff · Playbooks";

// ── Pure date maths (unit-tested) ──────────────────────────
function addDaysDateOnly(value, days) {
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}
/** Whole days from `anchor` to `date` (floored at 0; 0 when date missing). */
function dayOffset(anchor, date) {
  if (!date) return 0;
  const a = new Date(`${String(anchor).slice(0, 10)}T00:00:00.000Z`).getTime();
  const b = new Date(`${String(date).slice(0, 10)}T00:00:00.000Z`).getTime();
  const diff = Math.round((b - a) / 86400000);
  return diff > 0 ? diff : 0;
}

/** Capture a goal (+ milestones + linked tasks) as an offset-based structure. */
function structureFromGoal({ goal, milestones = [], tasks = [] }) {
  const anchor = goal.created_at || goal.target_date || new Date().toISOString();
  const byMilestone = new Map();
  const goalLevel = [];
  for (const t of tasks) {
    const entry = { title: t.title, offset_days: dayOffset(anchor, t.due_at) };
    if (t.milestone_id) {
      if (!byMilestone.has(t.milestone_id)) byMilestone.set(t.milestone_id, []);
      byMilestone.get(t.milestone_id).push(entry);
    } else {
      goalLevel.push(entry);
    }
  }
  const ms = [...milestones]
    .sort((a, b) => (a.display_order || 0) - (b.display_order || 0))
    .filter((m) => m.status !== "skipped")
    .map((m) => ({
      title: m.title,
      offset_days: dayOffset(anchor, m.target_date),
      tasks: byMilestone.get(m.milestone_id) || [],
    }));
  return {
    goal: { priority: goal.priority || "normal" },
    milestones: ms,
    tasks: goalLevel,
  };
}

const taskDue = (startDate, offset) => `${addDaysDateOnly(startDate, offset)}T17:00:00.000Z`;

/**
 * Turn a saved structure + a start date into ordered plan steps
 * (action_key/payload/summary) with cross-step `{{step:N.field}}` tokens.
 * Pure — the executor resolves the tokens at run time.
 */
function stepsFromTemplate({ structure, startDate, name, description }) {
  const s = structure || {};
  const milestones = Array.isArray(s.milestones) ? s.milestones : [];
  const goalTasks = Array.isArray(s.tasks) ? s.tasks : [];

  // Goal target date = the furthest offset in the playbook (default +30d).
  let maxOffset = 0;
  for (const m of milestones) {
    maxOffset = Math.max(maxOffset, m.offset_days || 0);
    for (const t of m.tasks || []) maxOffset = Math.max(maxOffset, t.offset_days || 0);
  }
  for (const t of goalTasks) maxOffset = Math.max(maxOffset, t.offset_days || 0);

  const steps = [];
  steps.push({
    action_key: "workspace.create_goal",
    payload: {
      title: name,
      description: description || undefined,
      priority: (s.goal && s.goal.priority) || "normal",
      target_date: addDaysDateOnly(startDate, maxOffset || 30),
    },
    summary: `Create goal “${name}”`,
  });
  const GOAL = "{{step:0.goal_id}}";

  const pushTask = (title, offset, milestoneToken) => {
    const createIdx = steps.length;
    steps.push({
      action_key: "workspace.create_task",
      payload: { title, priority: "normal", due_at: taskDue(startDate, offset) },
      summary: `Task “${title}”`,
    });
    const linkPayload = { id: GOAL, taskId: `{{step:${createIdx}.task_id}}` };
    if (milestoneToken) linkPayload.milestone_id = milestoneToken;
    steps.push({
      action_key: "workspace.link_task",
      payload: linkPayload,
      summary: `Link task “${title}” to the goal`,
    });
  };

  milestones.forEach((m, i) => {
    const mIdx = steps.length;
    steps.push({
      action_key: "workspace.add_milestone",
      payload: {
        id: GOAL,
        title: m.title,
        target_date: addDaysDateOnly(startDate, m.offset_days || 0),
        display_order: i,
      },
      summary: `Milestone “${m.title}”`,
    });
    for (const t of m.tasks || []) pushTask(t.title, t.offset_days || 0, `{{step:${mIdx}.milestone_id}}`);
  });
  for (const t of goalTasks) pushTask(t.title, t.offset_days || 0, null);

  return steps;
}

// ── CEO brand set (CoS is cross-brand for the CEO) ─────────
function ceoBrands(user) {
  if (Array.isArray(user.available_businesses) && user.available_businesses.length && !user.is_ceo)
    return user.available_businesses;
  return [...VALID_BRANDS];
}

// ── Service ────────────────────────────────────────────────
function list({ user }) {
  return repo.listTemplates({ businesses: ceoBrands(user) });
}

/** Save an existing goal as a reusable playbook. */
async function saveFromGoal({ user, brand, request_id, goal_id, name, description }) {
  const goal = await goalsRepo.findGoal({ brand, id: goal_id });
  if (!goal) throw new NotFoundError("Goal");
  const [milestones, tasks] = await Promise.all([
    goalsRepo.listMilestones({ goal_id }),
    goalsRepo.listGoalTasks({ brand, goal_id }),
  ]);
  const structure = structureFromGoal({ goal, milestones, tasks });
  const tpl = await repo.createTemplate({
    t: {
      business: brand,
      name: name || goal.title,
      description: description || goal.description,
      structure,
      source_goal_id: goal_id,
      created_by: user.user_id,
    },
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "cos.template.save",
    target_type: "goal_template",
    target_id: tpl.template_id,
    after: { name: tpl.name, milestones: structure.milestones.length },
    request_id,
  });
  return tpl;
}

/**
 * Instantiate a playbook into a PROPOSED batch plan (create goal + milestones +
 * tasks, re-dated from `start_date`). Returns the plan for one-tap approval.
 */
async function instantiate({ user, brand, request_id, template_id, start_date, name }) {
  const tpl = await repo.findTemplate({ template_id, businesses: ceoBrands(user) });
  if (!tpl) throw new NotFoundError("Template");
  const startDate = (start_date || new Date().toISOString()).slice(0, 10);
  const goalName = name || tpl.name;

  const steps = stepsFromTemplate({
    structure: tpl.structure,
    startDate,
    name: goalName,
    description: tpl.description,
  });
  if (steps.length < 1)
    throw new AppError("COS_EMPTY_TEMPLATE", "This playbook has no steps to run.", 422);

  const built = await planBuilder.buildProposedPlan({
    user,
    brand,
    title: `Playbook: ${goalName}`,
    summary: `Reuse “${tpl.name}” from ${startDate} — ${tpl.structure?.milestones?.length || 0} milestone(s).`,
    steps,
    conversationTitle: CONVERSATION_TITLE,
  });

  await repo.incrementUsage({ template_id });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "cos.template.instantiate",
    target_type: "goal_template",
    target_id: template_id,
    after: { plan_id: built.plan.plan_id, start_date: startDate },
    request_id,
  });
  return { ...built.plan, steps: built.steps };
}

module.exports = {
  list,
  saveFromGoal,
  instantiate,
  // pure helpers (exposed for tests)
  structureFromGoal,
  stepsFromTemplate,
  dayOffset,
  addDaysDateOnly,
  ceoBrands,
};
