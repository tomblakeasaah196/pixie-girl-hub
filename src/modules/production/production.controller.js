/**
 * Production & Landed Cost (V2.2 §6.24) — HTTP controller.
 */

"use strict";

const service = require("./production.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

// ── Runs ───────────────────────────────────────────────────
async function listRuns(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listRuns({
      brand: req.brand,
      status: req.query.status,
      page,
      page_size,
    }),
  );
}
async function getRun(req, res) {
  res.json({
    data: await service.getRun({ brand: req.brand, id: req.params.id }),
  });
}
async function openRun(req, res) {
  res.status(201).json({
    data: await service.openRun({ ...base(req), input: req.body }),
  });
}
async function advanceRun(req, res) {
  res.json({
    data: await service.advanceRun({
      ...base(req),
      id: req.params.id,
      status: req.body.status,
    }),
  });
}
async function addCostComponent(req, res) {
  res.status(201).json({
    data: await service.addCostComponent({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}
async function addUnit(req, res) {
  res.status(201).json({
    data: await service.addUnit({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}
async function receiveProduction(req, res) {
  res.json({
    data: await service.receiveProduction({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}

// ── Service jobs ───────────────────────────────────────────
async function listServiceJobs(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listServiceJobs({
      brand: req.brand,
      status: req.query.status,
      page,
      page_size,
    }),
  );
}
async function getServiceJob(req, res) {
  res.json({
    data: await service.getServiceJob({ brand: req.brand, id: req.params.id }),
  });
}
async function createServiceJob(req, res) {
  res.status(201).json({
    data: await service.createServiceJob({ ...base(req), input: req.body }),
  });
}
async function advanceServiceJob(req, res) {
  res.json({
    data: await service.advanceServiceJob({
      ...base(req),
      id: req.params.id,
      status: req.body.status,
      actual_cost_ngn: req.body.actual_cost_ngn,
    }),
  });
}

module.exports = {
  listRuns,
  getRun,
  openRun,
  advanceRun,
  addCostComponent,
  addUnit,
  receiveProduction,
  listServiceJobs,
  getServiceJob,
  createServiceJob,
  advanceServiceJob,
};
