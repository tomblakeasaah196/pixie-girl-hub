/**
 * AI Insights (V2.2 §6.30 / §6.31) — HTTP controller.
 */

"use strict";

const service = require("./insights.service");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

async function summary(req, res) {
  res.json({ data: await service.summary({ brand: req.brand }) });
}
async function list(req, res) {
  res.json({
    data: await service.list({
      brand: req.brand,
      module: req.query.module,
      status: req.query.status || "open",
      severity: req.query.severity,
      page: req.query.page ? Number(req.query.page) : undefined,
      page_size: req.query.page_size ? Number(req.query.page_size) : undefined,
    }),
  });
}
async function getOne(req, res) {
  res.json({ data: await service.getOne({ id: req.params.id }) });
}
async function acknowledge(req, res) {
  res.json({
    data: await service.acknowledge({ ...base(req), id: req.params.id }),
  });
}
async function resolve(req, res) {
  res.json({
    data: await service.resolve({
      ...base(req),
      id: req.params.id,
      reason: req.body.reason,
    }),
  });
}
async function dismiss(req, res) {
  res.json({
    data: await service.dismiss({ ...base(req), id: req.params.id }),
  });
}
async function sweep(_req, res) {
  res.json({ data: await service.runDetectorSweep() });
}

// AI Control switchboard
async function listModules(_req, res) {
  res.json({ data: await service.listModules() });
}
async function updateModule(req, res) {
  res.json({
    data: await service.updateModule({
      ...base(req),
      module: req.params.module,
      fields: req.body,
    }),
  });
}

module.exports = {
  summary,
  list,
  getOne,
  acknowledge,
  resolve,
  dismiss,
  sweep,
  listModules,
  updateModule,
};
