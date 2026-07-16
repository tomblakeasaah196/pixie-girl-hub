/**
 * Chief of Staff (PR4) — follow-up state machine.
 *
 * The conversational accountability loop behind the Done / In-Progress /
 * Delayed action buttons:
 *
 *   respond  → CEO taps a button. 'done' marks the subject done (via the PR3
 *              executor, loopback as the CEO) and resolves; 'in_progress'
 *              acknowledges; 'delayed' asks "what caused the delay?".
 *   reason   → CEO explains. We generate suggested_actions (move deadline /
 *              reschedule dependents / notify a stakeholder).
 *   act      → CEO picks a suggestion. 'move_deadline' shifts the subject;
 *              'reschedule_dependents' builds a BATCH RE-PLAN (reusing the PR3
 *              plan executor) that shifts every later open item on the goal;
 *              'notify_stakeholder' pings the goal's internal stakeholders.
 *   snooze / dismiss → park or close the follow-up.
 *
 * Every write is audited and re-scoped: subject changes and re-plans go back
 * through the real REST endpoints as the CEO, so RBAC/validation re-apply and
 * the CoS can never exceed the CEO.
 */

"use strict";

const repo = require("./cos.accountability.repo");
const cosRepo = require("./cos.repo");
const planExecutor = require("./cos.plan-executor");
const executor = require("../praxis_ai/praxis.executor");
const praxisRepo = require("../praxis_ai/praxis.repo");
const goalsRepo = require("../../shared/goals/goals.repo");
const governance = require("../ai_governance/governance.service");
const notifications = require("../../services/notifications.service");
const events = require("./cos.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError, AppError } = require("../../utils/errors");

const DEFAULT_SHIFT_DAYS = 7;
const SYSTEM_CONVERSATION_TITLE = "Chief of Staff · Accountability";

const nowIso = () => new Date().toISOString();

// ── Pure helpers (unit-tested without a DB) ────────────────
function addDaysDateOnly(value, days) {
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function addDaysIso(value, days) {
  const d = new Date(value);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/** The suggestion chips offered after a delay reason is captured. */
function buildSuggestions({ subject_type, shiftDays = DEFAULT_SHIFT_DAYS }) {
  const s = [
    {
      label: `Move the deadline +${shiftDays} days`,
      kind: "move_deadline",
      payload: { days: shiftDays },
    },
  ];
  if (subject_type === "goal" || subject_type === "milestone") {
    s.push({
      label: `Reschedule dependents +${shiftDays} days`,
      kind: "reschedule_dependents",
      payload: { days: shiftDays },
    });
  }
  s.push({ label: "Notify a stakeholder", kind: "notify_stakeholder", payload: {} });
  return s;
}

// ── Subject resolution ─────────────────────────────────────
async function resolveGoalId(followup, brand) {
  if (followup.subject_type === "goal") return followup.subject_id;
  if (followup.subject_type === "milestone") {
    const m = await repo.findMilestoneById({ milestone_id: followup.subject_id });
    return m ? m.goal_id : null;
  }
  const t = await repo.findTaskById({ brand, task_id: followup.subject_id });
  return t ? t.goal_id : null;
}

/** The subject's own date (YYYY-MM-DD) — the cutoff for a dependents re-plan. */
async function subjectDate(followup, brand) {
  if (followup.subject_type === "milestone") {
    const m = await repo.findMilestoneById({ milestone_id: followup.subject_id });
    return m && m.target_date ? String(m.target_date).slice(0, 10) : null;
  }
  if (followup.subject_type === "task") {
    const t = await repo.findTaskById({ brand, task_id: followup.subject_id });
    return t && t.due_at ? String(t.due_at).slice(0, 10) : null;
  }
  return null; // a goal-level delay reschedules everything
}

async function subjectDonePending({ followup, brand }) {
  if (followup.subject_type === "task") {
    return {
      method: "POST",
      route: "/api/v1/tasks/:id/status",
      payload: { id: followup.subject_id, status: "done" },
      business: brand,
    };
  }
  if (followup.subject_type === "milestone") {
    const m = await repo.findMilestoneById({ milestone_id: followup.subject_id });
    if (!m) throw new NotFoundError("Milestone");
    return {
      method: "PATCH",
      route: "/api/v1/goals/:id/milestones/:mid",
      payload: { id: m.goal_id, mid: followup.subject_id, status: "done" },
      business: brand,
    };
  }
  return {
    method: "PATCH",
    route: "/api/v1/goals/:id",
    payload: { id: followup.subject_id, status: "achieved" },
    business: brand,
  };
}

async function moveDeadlinePending({ followup, brand, days }) {
  if (followup.subject_type === "task") {
    const t = await repo.findTaskById({ brand, task_id: followup.subject_id });
    if (!t) throw new NotFoundError("Task");
    const base = t.due_at || nowIso();
    return {
      method: "PATCH",
      route: "/api/v1/tasks/:id",
      payload: { id: followup.subject_id, due_at: addDaysIso(base, days) },
      business: brand,
    };
  }
  if (followup.subject_type === "milestone") {
    const m = await repo.findMilestoneById({ milestone_id: followup.subject_id });
    if (!m) throw new NotFoundError("Milestone");
    const base = m.target_date || nowIso().slice(0, 10);
    return {
      method: "PATCH",
      route: "/api/v1/goals/:id/milestones/:mid",
      payload: {
        id: m.goal_id,
        mid: followup.subject_id,
        target_date: addDaysDateOnly(base, days),
      },
      business: brand,
    };
  }
  const g = await goalsRepo.findGoal({ brand, id: followup.subject_id });
  const base = (g && g.target_date) || nowIso().slice(0, 10);
  return {
    method: "PATCH",
    route: "/api/v1/goals/:id",
    payload: { id: followup.subject_id, target_date: addDaysDateOnly(base, days) },
    business: brand,
  };
}

async function runAsCeo({ pending, auth_header, request_id, what }) {
  const exec = await executor.executeAction({
    pending,
    authHeader: auth_header,
    requestId: request_id,
  });
  if (!exec.ok) {
    throw new AppError(
      "COS_ACTION_FAILED",
      `Could not ${what}: ${JSON.stringify(exec.result).slice(0, 300)}`,
      422,
      { user_message: `The Chief of Staff couldn't ${what} — try it from the board.` },
    );
  }
  return exec.result;
}

// ── System conversation host for accountability re-plans ────
async function getOrCreateSystemConversation({ user, brand }) {
  const existing = await praxisRepo.listConversations({
    user_id: user.user_id,
    kind: "chief_of_staff",
  });
  const match = (existing || []).find(
    (c) => c.title === SYSTEM_CONVERSATION_TITLE && !c.is_archived,
  );
  if (match) return match;
  return praxisRepo.createConversation({
    c: {
      user_id: user.user_id,
      business: brand,
      title: SYSTEM_CONVERSATION_TITLE,
      kind: "chief_of_staff",
    },
  });
}

const actionByKey = (actions, key) => actions.find((a) => a.action_key === key);

/**
 * Build + confirm a batch re-plan that shifts every open milestone/task on the
 * follow-up's goal (from the subject's date onward) by `days`. Reuses the PR3
 * plan executor so each shift re-enters the real endpoint as the CEO — the
 * steps run on the cos-plan-exec worker. Returns the plan in 'executing'
 * state, or null when there was nothing to move.
 */
async function rescheduleDependents({ followup, brand, user, days, request_id }) {
  const goalId = await resolveGoalId(followup, brand);
  if (!goalId)
    throw new AppError("COS_NO_GOAL", "This item isn't linked to a goal to re-plan.", 422);

  const actions = await governance.listActions({ ai_enabled: true, surface: "workspace" });
  const updMilestone = actionByKey(actions, "workspace.update_milestone");
  const updTask = actionByKey(actions, "workspace.update_task");

  const [milestones, tasks, cutoff] = await Promise.all([
    repo.openMilestones({ goal_id: goalId }),
    repo.openGoalTasks({ brand, goal_id: goalId }),
    subjectDate(followup, brand),
  ]);

  const steps = [];
  for (const m of milestones) {
    if (!m.target_date || !updMilestone) continue;
    if (cutoff && String(m.target_date).slice(0, 10) < cutoff) continue;
    steps.push({
      action: updMilestone,
      payload: {
        id: goalId,
        mid: m.milestone_id,
        target_date: addDaysDateOnly(m.target_date, days),
      },
      summary: `Move milestone “${String(m.title).slice(0, 60)}” +${days}d`,
    });
  }
  for (const t of tasks) {
    if (!t.due_at || !updTask) continue;
    if (cutoff && String(t.due_at).slice(0, 10) < cutoff) continue;
    steps.push({
      action: updTask,
      payload: { id: t.task_id, due_at: addDaysIso(t.due_at, days) },
      summary: `Move task “${String(t.title).slice(0, 60)}” +${days}d`,
    });
  }
  if (!steps.length) return null;

  const conv = await getOrCreateSystemConversation({ user, brand });
  const plan = await transaction(async (client) => {
    const p = await cosRepo.createPlan({
      client,
      p: {
        conversation_id: conv.conversation_id,
        business: brand,
        proposed_by_user_id: user.user_id,
        title: `Re-plan: shift ${steps.length} item(s) +${days}d`,
        summary: `Reschedule ${steps.length} dependent item(s) by ${days} days after a reported delay.`,
      },
    });
    let idx = 0;
    for (const s of steps) {
      await cosRepo.createPlanStep({
        client,
        s: {
          conversation_id: conv.conversation_id,
          proposed_by_user_id: user.user_id,
          business: brand,
          action_id: s.action.action_id,
          action_key: s.action.action_key,
          method: s.action.method,
          route: s.action.route,
          payload: s.payload,
          human_summary: s.summary,
          confidence: 1,
          plan_id: p.plan_id,
          plan_step: idx++,
        },
      });
    }
    return p;
  });

  // The CEO already approved by choosing this suggestion — confirm hands the
  // run to the cos-plan-exec worker; the returned plan is 'executing' and the
  // card settles via the cos_plan:executed realtime push.
  return planExecutor.confirmPlan({ user, request_id, id: plan.plan_id });
}

async function notifyStakeholders({ followup, brand }) {
  const goalId = await resolveGoalId(followup, brand);
  if (!goalId) return { notified: 0 };
  const [stakeholders, goal] = await Promise.all([
    goalsRepo.listStakeholders({ goal_id: goalId }),
    goalsRepo.findGoal({ brand, id: goalId }),
  ]);
  let notified = 0;
  for (const s of stakeholders) {
    if (!s.user_id) continue; // external contacts don't get in-app notifications
    await notifications.notify({
      user_id: s.user_id,
      business: brand,
      type: "cos_followup",
      title: `Heads up on “${goal ? goal.title : "a goal"}”`,
      body: `A delay was flagged${followup.reason ? `: ${followup.reason}` : ""}.`,
      priority: "normal",
      reference_type: "goal",
      reference_id: goalId,
    });
    notified += 1;
  }
  return { notified };
}

// ── Public state-machine endpoints ─────────────────────────
async function loadFollowup({ user, id }) {
  const f = await repo.findFollowupForUser({ id, user_id: user.user_id });
  if (!f) throw new NotFoundError("Follow-up");
  return f;
}

async function respond({ user, brand, request_id, id, auth_header, answer }) {
  const f = await loadFollowup({ user, id });
  if (!["open", "asked"].includes(f.state))
    throw new AppError("BAD_STATE", `This follow-up is already ${f.state}.`, 422);
  if (!["done", "in_progress", "delayed"].includes(answer))
    throw new AppError("VALIDATION", "answer must be done|in_progress|delayed", 422);

  let updated;
  let subjectResult = null;
  if (answer === "done") {
    const pending = await subjectDonePending({ followup: f, brand });
    subjectResult = await runAsCeo({
      pending,
      auth_header,
      request_id,
      what: `mark this ${f.subject_type} done`,
    });
    updated = await repo.updateFollowup({
      id,
      fields: { answer: "done", state: "resolved", resolved_at: nowIso(), question: null },
    });
  } else if (answer === "in_progress") {
    updated = await repo.updateFollowup({
      id,
      fields: { answer: "in_progress", state: "answered", resolved_at: nowIso(), question: null },
    });
  } else {
    updated = await repo.updateFollowup({
      id,
      fields: { answer: "delayed", state: "answered", question: "What caused the delay?" },
    });
  }

  // Adaptive-timing signal (PR6, wow #8): the CEO acted on this nudge, so mark
  // its cos_nudges rows engaged. Best-effort — timing is a nicety, not a
  // correctness path — so a failure here never fails the response.
  try {
    await repo.markNudgeEngaged({ reference_type: "cos_followup", reference_id: id });
  } catch {
    /* ignore */
  }

  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "cos.followup.respond",
    target_type: "cos_followup",
    target_id: id,
    after: { answer, state: updated.state },
    request_id,
  });
  emitFollowup(updated, answer === "done" ? "resolved" : "updated");
  return { followup: updated, subject_result: subjectResult, question: updated.question };
}

async function reason({ user, brand, request_id, id, reason: reasonText }) {
  const f = await loadFollowup({ user, id });
  if (f.answer !== "delayed" || f.state !== "answered")
    throw new AppError("BAD_STATE", "Answer “Delayed” before giving a reason.", 422);

  const suggestions = buildSuggestions({ subject_type: f.subject_type });
  const updated = await repo.updateFollowup({
    id,
    fields: { reason: reasonText || null, suggested_actions: suggestions, question: null },
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "cos.followup.reason",
    target_type: "cos_followup",
    target_id: id,
    request_id,
  });
  emitFollowup(updated, "updated");
  return { followup: updated, suggested_actions: suggestions };
}

async function act({ user, brand, request_id, id, auth_header, action }) {
  const f = await loadFollowup({ user, id });
  if (f.state !== "answered" || !Array.isArray(f.suggested_actions) || !f.suggested_actions.length)
    throw new AppError("BAD_STATE", "There are no suggested actions to act on.", 422);

  const kind = action && action.kind;
  const chosen = (f.suggested_actions || []).find((a) => a.kind === kind);
  if (!chosen)
    throw new AppError("VALIDATION", "Unknown suggested action.", 422);

  const days = (action.payload && Number(action.payload.days)) || (chosen.payload && Number(chosen.payload.days)) || DEFAULT_SHIFT_DAYS;
  let plan = null;
  let extra = {};

  if (kind === "move_deadline") {
    const pending = await moveDeadlinePending({ followup: f, brand, days });
    await runAsCeo({ pending, auth_header, request_id, what: "move the deadline" });
  } else if (kind === "reschedule_dependents") {
    plan = await rescheduleDependents({ followup: f, brand, user, days, request_id });
  } else if (kind === "notify_stakeholder") {
    extra = await notifyStakeholders({ followup: f, brand });
  } else {
    throw new AppError("VALIDATION", `Unsupported action: ${kind}`, 422);
  }

  const updated = await repo.updateFollowup({
    id,
    fields: { state: "resolved", resolved_at: nowIso() },
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "cos.followup.act",
    target_type: "cos_followup",
    target_id: id,
    after: { kind, days },
    request_id,
  });
  emitFollowup(updated, "resolved");
  return { followup: updated, plan: plan ? { ...plan } : null, ...extra };
}

async function snooze({ user, brand, request_id, id, until }) {
  await loadFollowup({ user, id }); // ownership check
  const updated = await repo.updateFollowup({
    id,
    fields: { state: "snoozed", snooze_until: until || null },
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "cos.followup.snooze",
    target_type: "cos_followup",
    target_id: id,
    after: { until: updated.snooze_until },
    request_id,
  });
  emitFollowup(updated, "updated");
  return { followup: updated };
}

async function dismiss({ user, brand, request_id, id }) {
  await loadFollowup({ user, id }); // ownership check
  const updated = await repo.updateFollowup({
    id,
    fields: { state: "dismissed", resolved_at: nowIso() },
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "cos.followup.dismiss",
    target_type: "cos_followup",
    target_id: id,
    request_id,
  });
  emitFollowup(updated, "resolved");
  return { followup: updated };
}

function emitFollowup(followup, kind) {
  if (!followup) return;
  events.emit(`followup.${kind}`, {
    followup_id: followup.followup_id,
    user_id: followup.user_id,
    subject_type: followup.subject_type,
    subject_id: followup.subject_id,
    state: followup.state,
  });
}

async function listOpen({ user, subject_type, subject_id }) {
  return repo.listOpenFollowups({ user_id: user.user_id, subject_type, subject_id });
}

module.exports = {
  respond,
  reason,
  act,
  snooze,
  dismiss,
  listOpen,
  // pure helpers exposed for tests
  buildSuggestions,
  addDaysDateOnly,
  addDaysIso,
};
