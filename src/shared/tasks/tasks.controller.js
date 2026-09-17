/**
 * Tasks (V2.2 §6.19) — HTTP controller.
 */

"use strict";

const service = require("./tasks.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  scope: req.permission_scope,
  user: req.user,
  request_id: req.request_id,
});

async function listTasks(req, res) {
  const { page, page_size } = parsePagination(req.query);
  // "me" asks for MY tasks (assigned to me or raised by me) — not for
  // "tasks whose assignee is my user_id", which silently drops every
  // unassigned task. See service.listTasks / service.getBoard.
  const mine = req.query.assigned_to === "me";
  res.json(
    await service.listTasks({
      brand: req.brand,
      scope: req.permission_scope,
      user: req.user,
      mine,
      status: req.query.status,
      assigned_to: mine ? undefined : req.query.assigned_to,
      priority: req.query.priority,
      reference_type: req.query.reference_type,
      reference_id: req.query.reference_id,
      page,
      page_size,
    }),
  );
}
async function listAssignees(req, res) {
  const { page_size } = parsePagination(req.query);
  res.json({
    data: await service.listAssignees({
      brand: req.brand,
      search: req.query.q,
      limit: page_size,
    }),
  });
}
async function getBoard(req, res) {
  const mine = req.query.assigned_to === "me";
  res.json({
    data: await service.getBoard({
      brand: req.brand,
      scope: req.permission_scope,
      user: req.user,
      mine,
      assigned_to: mine ? undefined : req.query.assigned_to,
    }),
  });
}
async function getTask(req, res) {
  res.json({
    data: await service.getTask({
      brand: req.brand,
      scope: req.permission_scope,
      user: req.user,
      id: req.params.id,
    }),
  });
}
async function createTask(req, res) {
  res.status(201).json({
    data: await service.createTask({ ...base(req), input: req.body }),
  });
}
async function updateTask(req, res) {
  res.json({
    data: await service.updateTask({
      ...base(req),
      id: req.params.id,
      patch: req.body,
    }),
  });
}
async function changeStatus(req, res) {
  res.json({
    data: await service.changeStatus({
      ...base(req),
      id: req.params.id,
      status: req.body.status,
    }),
  });
}
async function deleteTask(req, res) {
  await service.deleteTask({ ...base(req), id: req.params.id });
  res.status(204).end();
}
async function addSubtask(req, res) {
  res.status(201).json({
    data: await service.addSubtask({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}
async function setSubtaskDone(req, res) {
  res.json({
    data: await service.setSubtaskDone({
      ...base(req),
      id: req.params.id,
      subtask_id: req.params.subtask_id,
      is_done: req.body.is_done,
    }),
  });
}
async function deleteSubtask(req, res) {
  await service.deleteSubtask({
    ...base(req),
    id: req.params.id,
    subtask_id: req.params.subtask_id,
  });
  res.status(204).end();
}

module.exports = {
  listTasks,
  listAssignees,
  getBoard,
  getTask,
  createTask,
  updateTask,
  changeStatus,
  deleteTask,
  addSubtask,
  setSubtaskDone,
  deleteSubtask,
};
