/**
 * Goals (Chief of Staff, PR1) — HTTP controller. Thin req/res only.
 */

"use strict";

const service = require("./goals.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

async function listGoals(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listGoals({
      brand: req.brand,
      status: req.query.status,
      owner_user_id:
        req.query.owner === "me" ? req.user.user_id : req.query.owner,
      priority: req.query.priority,
      target_before: req.query.target_before,
      target_after: req.query.target_after,
      search: req.query.q,
      page,
      page_size,
    }),
  );
}
async function getGoal(req, res) {
  res.json({ data: await service.getGoal({ brand: req.brand, id: req.params.id }) });
}
async function createGoal(req, res) {
  res.status(201).json({
    data: await service.createGoal({ ...base(req), input: req.body }),
  });
}
async function updateGoal(req, res) {
  res.json({
    data: await service.updateGoal({ ...base(req), id: req.params.id, patch: req.body }),
  });
}
async function deleteGoal(req, res) {
  await service.deleteGoal({ ...base(req), id: req.params.id });
  res.status(204).end();
}

async function addMilestone(req, res) {
  res.status(201).json({
    data: await service.addMilestone({ ...base(req), id: req.params.id, input: req.body }),
  });
}
async function updateMilestone(req, res) {
  res.json({
    data: await service.updateMilestone({
      ...base(req),
      id: req.params.id,
      milestone_id: req.params.mid,
      patch: req.body,
    }),
  });
}
async function deleteMilestone(req, res) {
  await service.deleteMilestone({
    ...base(req),
    id: req.params.id,
    milestone_id: req.params.mid,
  });
  res.status(204).end();
}

async function addStakeholder(req, res) {
  res.status(201).json({
    data: await service.addStakeholder({ ...base(req), id: req.params.id, input: req.body }),
  });
}
async function removeStakeholder(req, res) {
  await service.removeStakeholder({
    ...base(req),
    id: req.params.id,
    stakeholder_id: req.params.sid,
  });
  res.status(204).end();
}

async function linkTask(req, res) {
  await service.linkTask({
    ...base(req),
    id: req.params.id,
    task_id: req.params.taskId,
    milestone_id: req.body.milestone_id,
  });
  res.status(204).end();
}
async function unlinkTask(req, res) {
  await service.unlinkTask({ ...base(req), id: req.params.id, task_id: req.params.taskId });
  res.status(204).end();
}
async function linkEvent(req, res) {
  await service.linkEvent({
    ...base(req),
    id: req.params.id,
    event_id: req.params.eventId,
    milestone_id: req.body.milestone_id,
  });
  res.status(204).end();
}
async function unlinkEvent(req, res) {
  await service.unlinkEvent({ ...base(req), id: req.params.id, event_id: req.params.eventId });
  res.status(204).end();
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
};
