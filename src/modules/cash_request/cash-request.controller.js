/**
 * Cash Request & Disbursement (V2.2 §6.32) — HTTP controller.
 * Translates req/res to service calls. No business logic here.
 */

"use strict";

const service = require("./cash-request.service");

async function list(req, res) {
  const result = await service.list({
    brand: req.brand,
    user: req.user,
    scope: req.permission_scope,
    filters: req.query,
    page: parseInt(req.query.page || "1", 10),
    page_size: Math.min(parseInt(req.query.page_size || "25", 10), 100),
  });
  res.json(result);
}

async function getById(req, res) {
  const item = await service.getById({ brand: req.brand, id: req.params.id });
  res.json({ data: item });
}

async function create(req, res) {
  const created = await service.create({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    input: req.body,
  });
  res.status(201).json({ data: created });
}

async function submit(req, res) {
  const updated = await service.submit({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    id: req.params.id,
  });
  res.json({ data: updated });
}

async function financeDecision(req, res) {
  const updated = await service.financeDecision({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    id: req.params.id,
    decision: req.body.decision,
    notes: req.body.notes,
  });
  res.json({ data: updated });
}

async function ceoDecision(req, res) {
  const updated = await service.ceoDecision({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    id: req.params.id,
    decision: req.body.decision,
    notes: req.body.notes,
  });
  res.json({ data: updated });
}

async function disburse(req, res) {
  const updated = await service.disburse({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    id: req.params.id,
    input: req.body,
  });
  res.json({ data: updated });
}

async function settle(req, res) {
  const updated = await service.settle({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    id: req.params.id,
    input: req.body,
  });
  res.json({ data: updated });
}

async function cancel(req, res) {
  const updated = await service.cancel({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    id: req.params.id,
    reason: req.body.reason,
  });
  res.json({ data: updated });
}

module.exports = {
  list,
  getById,
  create,
  submit,
  financeDecision,
  ceoDecision,
  disburse,
  settle,
  cancel,
};
