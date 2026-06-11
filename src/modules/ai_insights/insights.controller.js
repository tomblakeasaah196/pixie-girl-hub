/**
 * AI Insights (V2.2 §6.30) — HTTP controller.
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
      category: req.params.category,
      status: req.query.status || "open",
      severity: req.query.severity,
      page: req.query.page ? Number(req.query.page) : undefined,
      page_size: req.query.page_size ? Number(req.query.page_size) : undefined,
    }),
  });
}
async function getOne(req, res) {
  res.json({
    data: await service.getOne({
      category: req.params.category,
      id: req.params.id,
    }),
  });
}
async function acknowledge(req, res) {
  res.json({
    data: await service.acknowledge({
      ...base(req),
      category: req.params.category,
      id: req.params.id,
    }),
  });
}
async function resolve(req, res) {
  res.json({
    data: await service.resolve({
      ...base(req),
      category: req.params.category,
      id: req.params.id,
      reason: req.body.reason,
    }),
  });
}
async function dismiss(req, res) {
  res.json({
    data: await service.dismiss({
      ...base(req),
      category: req.params.category,
      id: req.params.id,
    }),
  });
}
async function sweep(req, res) {
  res.json({ data: await service.runDetectorSweep() });
}

module.exports = {
  summary,
  list,
  getOne,
  acknowledge,
  resolve,
  dismiss,
  sweep,
};
