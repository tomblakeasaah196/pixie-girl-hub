/**
 * Sales Campaigns & Landing Pages (V2.2 §6.22)
 * HTTP controller — translates req/res to service calls. No business logic.
 */

"use strict";

const service = require("./campaigns.service");
const { parsePagination } = require("../../utils/pagination");

async function list(req, res) {
  const { page, page_size } = parsePagination(req.query);
  const result = await service.list({
    brand: req.brand,
    user: req.user,
    scope: req.permission_scope,
    filters: {
      status: req.query.status,
      q: req.query.q,
      active_on: req.query.active_on,
    },
    page,
    page_size,
  });
  res.json(result);
}

async function getById(req, res) {
  const item = await service.getById({
    brand: req.brand,
    scope: req.permission_scope,
    user: req.user,
    id: req.params.id,
  });
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

async function update(req, res) {
  const updated = await service.update({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    id: req.params.id,
    patch: req.body,
  });
  res.json({ data: updated });
}

async function archive(req, res) {
  await service.archive({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    id: req.params.id,
  });
  res.status(204).end();
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

async function approve(req, res) {
  const updated = await service.approve({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    id: req.params.id,
    notes: req.body.notes,
  });
  res.json({ data: updated });
}

async function reject(req, res) {
  const updated = await service.reject({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    id: req.params.id,
    notes: req.body.notes,
  });
  res.json({ data: updated });
}

function makeTransition(action) {
  return async function handler(req, res) {
    const updated = await service.transition({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.id,
      action,
    });
    res.json({ data: updated });
  };
}

async function duplicate(req, res) {
  const created = await service.duplicate({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    id: req.params.id,
    overrides: req.body,
  });
  res.status(201).json({ data: created });
}

async function listProducts(req, res) {
  const data = await service.listProducts({
    brand: req.brand,
    id: req.params.id,
  });
  res.json({ data });
}

async function addProduct(req, res) {
  const link = await service.addProduct({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    id: req.params.id,
    input: req.body,
  });
  res.status(201).json({ data: link });
}

async function updateProduct(req, res) {
  const link = await service.updateProduct({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    id: req.params.id,
    link_id: req.params.linkId,
    patch: req.body,
  });
  res.json({ data: link });
}

async function removeProduct(req, res) {
  await service.removeProduct({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    id: req.params.id,
    link_id: req.params.linkId,
  });
  res.status(204).end();
}

async function uploadImage(req, res) {
  const data = await service.uploadImage({
    brand: req.brand,
    id: req.params.id,
    file: req.file,
  });
  res.status(201).json({ data });
}

async function getLanding(req, res) {
  const data = await service.getLanding({
    brand: req.brand,
    id: req.params.id,
  });
  res.json({ data });
}

async function updateLanding(req, res) {
  const data = await service.updateLanding({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    id: req.params.id,
    patch: req.body,
  });
  res.json({ data });
}

async function preview(req, res) {
  const data = await service.preview({
    brand: req.brand,
    id: req.params.id,
    state: req.query.state,
  });
  res.json({ data });
}

async function shareKit(req, res) {
  const data = await service.getShareKit({
    brand: req.brand,
    brand_config: req.brand_config,
    id: req.params.id,
  });
  res.json({ data });
}

async function listSignups(req, res) {
  const { page, page_size } = parsePagination(req.query);
  const result = await service.listSignups({
    brand: req.brand,
    id: req.params.id,
    page,
    page_size,
  });
  res.json(result);
}

async function metrics(req, res) {
  const data = await service.getMetrics({
    brand: req.brand,
    id: req.params.id,
  });
  res.json({ data });
}

async function dailyMetrics(req, res) {
  const data = await service.listDailyMetrics({
    brand: req.brand,
    id: req.params.id,
    from: req.query.from,
    to: req.query.to,
  });
  res.json({ data });
}

async function report(req, res) {
  const data = await service.getReport({
    brand: req.brand,
    id: req.params.id,
    format: req.query.format,
  });
  res.json({ data });
}

module.exports = {
  list,
  getById,
  create,
  update,
  archive,
  submit,
  approve,
  reject,
  launch: makeTransition("launch"),
  pause: makeTransition("pause"),
  resume: makeTransition("resume"),
  end: makeTransition("end"),
  duplicate,
  listProducts,
  addProduct,
  updateProduct,
  removeProduct,
  uploadImage,
  getLanding,
  updateLanding,
  preview,
  shareKit,
  listSignups,
  metrics,
  dailyMetrics,
  report,
};
