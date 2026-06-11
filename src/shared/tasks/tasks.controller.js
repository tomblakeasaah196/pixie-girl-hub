/**
 * Tasks (V2.2 §6.19) — HTTP controller.
 */

"use strict";

const service = require("./tasks.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

async function listTasks(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listTasks({
      brand: req.brand,
      status: req.query.status,
      assigned_to:
        req.query.assigned_to === "me"
          ? req.user.user_id
          : req.query.assigned_to,
      priority: req.query.priority,
      reference_type: req.query.reference_type,
      reference_id: req.query.reference_id,
      page,
      page_size,
    }),
  );
}
async function getBoard(req, res) {
  res.json({
    data: await service.getBoard({
      brand: req.brand,
      assigned_to:
        req.query.assigned_to === "me"
          ? req.user.user_id
          : req.query.assigned_to,
    }),
  });
}
async function getTask(req, res) {
  res.json({
    data: await service.getTask({ brand: req.brand, id: req.params.id }),
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
