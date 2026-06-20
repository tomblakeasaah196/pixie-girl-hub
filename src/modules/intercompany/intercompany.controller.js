/**
 * Inter-Company Transactions (V2.2 §5.1) — HTTP controller.
 */

"use strict";

const service = require("./intercompany.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({ user: req.user, request_id: req.request_id });

async function list(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.list({
      brand: req.brand,
      status: req.query.status,
      page,
      page_size,
    }),
  );
}
async function getById(req, res) {
  res.json({ data: await service.getById({ id: req.params.id }) });
}
async function record(req, res) {
  res.status(201).json({
    data: await service.recordTransaction({ ...base(req), input: req.body }),
  });
}
async function approve(req, res) {
  res.json({
    data: await service.approveTransaction({
      ...base(req),
      id: req.params.id,
      notes: req.body.notes,
    }),
  });
}
async function reject(req, res) {
  res.json({
    data: await service.rejectTransaction({
      ...base(req),
      id: req.params.id,
      reason: req.body.reason,
    }),
  });
}
async function match(req, res) {
  res.json({
    data: await service.matchTransaction({ ...base(req), id: req.params.id }),
  });
}
async function settle(req, res) {
  res.json({
    data: await service.settleTransaction({ ...base(req), id: req.params.id }),
  });
}
async function openReconciliation(req, res) {
  res.status(201).json({
    data: await service.openReconciliation({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}

module.exports = {
  list,
  getById,
  record,
  approve,
  reject,
  match,
  settle,
  openReconciliation,
};
