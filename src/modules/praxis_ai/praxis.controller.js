/**
 * Praxis AI Agent (V2.2 §6.29) — HTTP controller.
 */

"use strict";

const service = require("./praxis.service");

const base = (req) => ({
  user: req.user,
  brand: req.brand,
  request_id: req.request_id,
});

// Conversations
async function listConversations(req, res) {
  res.json({ data: await service.listConversations({ user: req.user }) });
}
async function getConversation(req, res) {
  res.json({
    data: await service.getConversation({ user: req.user, id: req.params.id }),
  });
}
async function createConversation(req, res) {
  res.status(201).json({
    data: await service.createConversation({ ...base(req), input: req.body }),
  });
}
async function archiveConversation(req, res) {
  await service.archiveConversation({ user: req.user, id: req.params.id });
  res.status(204).end();
}
async function postMessage(req, res) {
  res.status(201).json({
    data: await service.postMessage({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}
async function listRunSteps(req, res) {
  res.json({
    data: await service.listRunSteps({ conversation_id: req.params.id }),
  });
}

// Pending actions
async function listPendingActions(req, res) {
  res.json({
    data: await service.listPendingActions({
      user: req.user,
      status: req.query.status,
    }),
  });
}
async function getPendingAction(req, res) {
  res.json({
    data: await service.getPendingAction({ user: req.user, id: req.params.id }),
  });
}
async function confirmAction(req, res) {
  res.json({
    data: await service.confirmAction({ ...base(req), id: req.params.id }),
  });
}
async function rejectAction(req, res) {
  res.json({
    data: await service.rejectAction({
      ...base(req),
      id: req.params.id,
      reason: req.body.reason,
    }),
  });
}

// Action catalogue (allowlist)
async function listActions(req, res) {
  res.json({
    data: await service.listEnabledActions({
      module: req.query.module,
      category: req.query.category,
    }),
  });
}

module.exports = {
  listConversations,
  getConversation,
  createConversation,
  archiveConversation,
  postMessage,
  listRunSteps,
  listPendingActions,
  getPendingAction,
  confirmAction,
  rejectAction,
  listActions,
};
