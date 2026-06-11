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
    });
  } catch (err) {
    logger.error(
      { err: err.message, task_id: task.task_id },
      "tasks: assignee notification failed",
    );
  }
}

const VALID_STATUSES = [
  "inbox",
  "today",
  "this_week",
  "this_month",
  "later",
  "done",
  "cancelled",
];
const VALID_PRIORITIES = ["low", "normal", "high", "urgent"];

function listTasks(args) {
  return repo.listTasks(args);
}

/** Kanban board: active tasks grouped by status column. */
async function getBoard({ brand, assigned_to }) {
  const rows = await repo.boardTasks({ brand, assigned_to });
  const columns = {};
  for (const s of VALID_STATUSES) {
    if (s === "cancelled") continue;
    columns[s] = [];
  }
  for (const t of rows) {
    if (!columns[t.status]) columns[t.status] = [];
    columns[t.status].push(t);
  }
  return { columns };
}
async function getTask({ brand, id }) {
  const task = await repo.findTask({ brand, id });
  if (!task) throw new NotFoundError("Task");
  task.subtasks = await repo.listSubtasks({ task_id: id });
  return task;
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
async function updateTask({ brand, user, request_id, id, patch }) {
  const before = await repo.findTask({ brand, id });
  if (!before) throw new NotFoundError("Task");
  const task = await repo.updateTask({ brand, id, patch });
  await A(brand, user, "tasks.update", "task", id, task, request_id);
  if (patch.assigned_to && patch.assigned_to !== before.assigned_to)
    await notifyAssignee({ brand, task });
  return task;
}
async function changeStatus({ brand, user, request_id, id, status }) {
  const before = await repo.findTask({ brand, id });
  if (!before) throw new NotFoundError("Task");
  const completed = status === "done";
  const task = await repo.setStatus({ brand, id, status, completed });
  await A(brand, user, "tasks.status", "task", id, { status }, request_id);
  events.emit("task.status_changed", { brand, task_id: id, status });
  return task;
}
async function deleteTask({ brand, user, request_id, id }) {
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

async function deleteSubtask({ brand, user, request_id, id, subtask_id }) {
  const task = await repo.findTask({ brand, id });
  if (!task) throw new NotFoundError("Task");
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

async function addSubtask({ brand, user, request_id, id, input }) {
  const task = await repo.findTask({ brand, id });
  if (!task) throw new NotFoundError("Task");
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
  user,
  request_id,
  id,
  subtask_id,
  is_done,
}) {
  const task = await repo.findTask({ brand, id });
  if (!task) throw new NotFoundError("Task");
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
