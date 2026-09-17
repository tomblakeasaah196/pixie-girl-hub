/**
 * Tasks (V2.2 §6.19) — business logic.
 *
 * Personal/assigned task management. Tasks can be standalone or linked to a
 * source record (reference_type/id) — e.g. a service_job auto-raises a task via
 * a DB trigger, and that task shows here with a back-reference. Notifies the
 * assignee when a task is assigned to them.
 */

"use strict";

const repo = require("./tasks.repo");
const { deepLinkFor } = require("../links/deep-links");
const events = require("./tasks.events");
const notifications = require("../../services/notifications.service");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { logger } = require("../../config/logger");
const { NotFoundError } = require("../../utils/errors");

const A = (
  brand,
  user,
  action_key,
  target_type,
  target_id,
  after,
  request_id,
) =>
  audit({
    business: brand,
    user_id: user ? user.user_id : null,
    action_key,
    target_type,
    target_id,
    after,
    request_id,
  });

async function notifyAssignee({ brand, task }) {
  if (!task.assigned_to) return;
  try {
    await notifications.notify({
      user_id: task.assigned_to,
      business: brand,
      type: "task_assigned",
      priority: task.priority === "urgent" ? "high" : "normal",
      title: "A task was assigned to you",
      body: task.title,
      reference_type: "task",
      reference_id: task.task_id,
      // Point at the RECORD when the task is about one (an approval, an
      // order), and at the task itself otherwise. Being dropped on a task
      // that says "approve X" is one hop short of where the holder is going.
      action_url:
        deepLinkFor(task.reference_type, task.reference_id) ||
        deepLinkFor("task", task.task_id),
    });
  } catch (err) {
    logger.error(
      { err: err.message, task_id: task.task_id },
      "tasks: assignee notification failed",
    );
  }
}

const VALID_STATUSES = [
  "to_do",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
];
const VALID_PRIORITIES = ["low", "normal", "high", "urgent"];

/**
 * Record-scope guard (RBAC layer 4). With 'own' scope a task is visible only
 * to its assignee or creator. 'team' has no membership source yet, so it
 * behaves like 'all' — same as every other module repo today.
 */
function canSee(task, scope, user) {
  if (scope !== "own") return true;
  const uid = user && user.user_id;
  return task.assigned_to === uid || task.created_by === uid;
}

/**
 * Stamp every task with the route to the record it is about.
 *
 * A task that says "Approve stock write-off FLH-ADJ-0007" and gives you no
 * way to open FLH-ADJ-0007 is a memo, not a task — the holder has to go and
 * find it by hand. Derived on READ (not stored) so existing tasks gain their
 * link the moment a route is added, and one change to deep-links.js moves
 * every task pointing at that record.
 */
function withLink(task) {
  if (!task) return task;
  return {
    ...task,
    action_url: deepLinkFor(task.reference_type, task.reference_id),
  };
}

async function listTasks({ scope, user, mine, ...args }) {
  // Same "mine" resolution as the board: assigned to me OR raised by me.
  // See getBoard for why `assigned_to = me` alone is wrong.
  if (scope === "own" || mine) args.visible_to = user.user_id;
  const result = await repo.listTasks(args);
  // The repo returns either a bare array or { data, meta } depending on the
  // caller — handle both rather than assuming.
  if (Array.isArray(result)) return result.map(withLink);
  if (result && Array.isArray(result.data))
    return { ...result, data: result.data.map(withLink) };
  return result;
}

/**
 * The teammates a task can be assigned to (or an event participant can be).
 * Powers the assignee picker and, via the CoS catalogue, the agent's
 * search_users tool — the only place a valid `assigned_to` user_id comes from.
 */
function listAssignees({ brand, search, limit }) {
  return repo.listAssignableUsers({ brand, search, limit });
}

/**
 * Kanban board: active tasks grouped by status column.
 *
 * `mine` is the UI's "?assigned_to=me" and it means MY BOARD, not "tasks whose
 * assignee is my user_id" — so it resolves to the same definition of "mine"
 * the list already uses for 'own' scope: assigned to me OR raised by me.
 *
 * It used to be passed straight through as `assigned_to`, which the repo turns
 * into the equality filter `t.assigned_to = <me>`. The Workspace "New Task"
 * form posts no assignee (there is no assignee field), so every task created
 * in the UI is stored with assigned_to NULL — and `NULL = '<uuid>'` is NULL,
 * not true. Every task a user created was written to the database and then
 * filtered out of their own board. "Created a task, it never showed up" was
 * that one clause.
 */
async function getBoard({ brand, scope, user, assigned_to, mine }) {
  const rows = await repo.boardTasks({
    brand,
    assigned_to,
    visible_to: scope === "own" || mine ? user.user_id : undefined,
  });
  const board = { to_do: [], in_progress: [], in_review: [], done: [] };
  for (const t of rows) {
    if (board[t.status]) board[t.status].push(withLink(t));
  }
  return board;
}
async function getTask({ brand, scope, user, id }) {
  const task = await repo.findTask({ brand, id });
  if (!task || !canSee(task, scope, user)) throw new NotFoundError("Task");
  task.subtasks = await repo.listSubtasks({ task_id: id });
  return withLink(task);
}
async function createTask({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const task = await repo.createTask({
      client,
      task: { ...input, business: brand, created_by: user.user_id },
    });
    for (const s of input.subtasks || [])
      await repo.addSubtask({
        s: {
          task_id: task.task_id,
          title: s.title,
          display_order: s.display_order,
        },
      });
    await A(
      brand,
      user,
      "tasks.create",
      "task",
      task.task_id,
      { title: task.title },
      request_id,
    );
    events.emit("task.created", { brand, task_id: task.task_id });
    await notifyAssignee({ brand, task });
    return task;
  });
}
async function updateTask({ brand, scope, user, request_id, id, patch }) {
  const before = await repo.findTask({ brand, id });
  if (!before || !canSee(before, scope, user)) throw new NotFoundError("Task");
  // Keep the reminder honest: unless the caller pinned an explicit remind_at,
  // recompute it whenever the due date or the relative offset changes —
  // otherwise a moved deadline silently fires the reminder at the old time.
  if (
    patch.remind_at === undefined &&
    (patch.due_at !== undefined || patch.reminder_minutes !== undefined)
  ) {
    const due = patch.due_at !== undefined ? patch.due_at : before.due_at;
    const mins =
      patch.reminder_minutes !== undefined
        ? patch.reminder_minutes
        : before.reminder_minutes;
    const hasBoth =
      due !== null && due !== undefined && mins !== null && mins !== undefined;
    patch.remind_at = hasBoth
      ? new Date(new Date(due).getTime() - mins * 60000).toISOString()
      : null;
  }
  const task = await repo.updateTask({ brand, id, patch });
  await A(brand, user, "tasks.update", "task", id, task, request_id);
  if (patch.assigned_to && patch.assigned_to !== before.assigned_to)
    await notifyAssignee({ brand, task });
  return task;
}
async function changeStatus({ brand, scope, user, request_id, id, status }) {
  const before = await repo.findTask({ brand, id });
  if (!before || !canSee(before, scope, user)) throw new NotFoundError("Task");
  const completed = status === "done";
  const task = await repo.setStatus({ brand, id, status, completed });
  await A(brand, user, "tasks.status", "task", id, { status }, request_id);
  events.emit("task.status_changed", { brand, task_id: id, status });
  return task;
}
async function deleteTask({ brand, scope, user, request_id, id }) {
  const before = await repo.findTask({ brand, id });
  if (!before || !canSee(before, scope, user)) throw new NotFoundError("Task");
  const ok = await repo.softDeleteTask({ brand, id });
  if (!ok) throw new NotFoundError("Task");
  await A(brand, user, "tasks.delete", "task", id, null, request_id);
}

/**
 * Cross-module hook: another module raises a task programmatically (e.g. an
 * approval lands on an approver, a campaign needs review). Mirrors the
 * calendar.createForReference pattern. `created_by` defaults to system (null
 * not allowed by schema, so callers must pass a user_id).
 */
async function createFromModule({ brand, created_by, task }) {
  const created = await repo.createTask({
    task: {
      ...task,
      business: brand,
      created_by,
      reference_type: task.reference_type,
      reference_id: task.reference_id,
    },
  });
  events.emit("task.created", {
    brand,
    task_id: created.task_id,
    source: task.reference_type,
  });
  if (created.assigned_to) await notifyAssignee({ brand, task: created });
  return created;
}

async function deleteSubtask({ brand, scope, user, request_id, id, subtask_id }) {
  const task = await repo.findTask({ brand, id });
  if (!task || !canSee(task, scope, user)) throw new NotFoundError("Task");
  const ok = await repo.deleteSubtask({ subtask_id });
  if (!ok) throw new NotFoundError("Subtask");
  await A(
    brand,
    user,
    "tasks.subtask.delete",
    "task",
    id,
    { subtask_id },
    request_id,
  );
}

async function addSubtask({ brand, scope, user, request_id, id, input }) {
  const task = await repo.findTask({ brand, id });
  if (!task || !canSee(task, scope, user)) throw new NotFoundError("Task");
  const sub = await repo.addSubtask({
    s: { task_id: id, title: input.title, display_order: input.display_order },
  });
  await A(
    brand,
    user,
    "tasks.subtask.add",
    "task",
    id,
    { subtask_id: sub.subtask_id },
    request_id,
  );
  return sub;
}
async function setSubtaskDone({
  brand,
  scope,
  user,
  request_id,
  id,
  subtask_id,
  is_done,
}) {
  const task = await repo.findTask({ brand, id });
  if (!task || !canSee(task, scope, user)) throw new NotFoundError("Task");
  const sub = await repo.setSubtaskDone({ subtask_id, is_done });
  if (!sub) throw new NotFoundError("Subtask");
  await A(
    brand,
    user,
    "tasks.subtask.toggle",
    "task",
    id,
    { subtask_id, is_done },
    request_id,
  );
  return sub;
}

module.exports = {
  listTasks,
  listAssignees,
  getBoard,
  getTask,
  createTask,
  createFromModule,
  updateTask,
  changeStatus,
  deleteTask,
  addSubtask,
  setSubtaskDone,
  deleteSubtask,
  VALID_STATUSES,
  VALID_PRIORITIES,
};
