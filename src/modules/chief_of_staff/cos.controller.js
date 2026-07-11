/**
 * Chief of Staff (PR3) — HTTP controller. Thin req/res only.
 */

"use strict";

const service = require("./cos.service");

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
      // Threaded to the plan executor: it re-enters the API over loopback AS
      // this user, so auth/brand/RBAC/validation re-apply on every step.
      auth_header: req.headers.authorization,
    }),
  });
}

// Plans (batch-plan confirm gate)
async function getPlan(req, res) {
  res.json({ data: await service.getPlan({ user: req.user, id: req.params.planId }) });
}
async function confirmPlan(req, res) {
  res.json({
    data: await service.confirmPlan({
      ...base(req),
      id: req.params.planId,
      auth_header: req.headers.authorization,
    }),
  });
}
async function rejectPlan(req, res) {
  res.json({
    data: await service.rejectPlan({
      ...base(req),
      id: req.params.planId,
      reason: req.body.reason,
    }),
  });
}

module.exports = {
  listConversations,
  getConversation,
  createConversation,
  archiveConversation,
  postMessage,
  getPlan,
  confirmPlan,
  rejectPlan,
};
