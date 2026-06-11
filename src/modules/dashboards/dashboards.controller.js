/**
 * Dashboards (V2.2 §6.20) — HTTP controller.
 */

"use strict";

const service = require("./dashboards.service");

async function overview(req, res) {
  res.json({
    data: await service.overview({
      brand: req.brand,
      user: req.user,
      from: req.query.from,
      to: req.query.to,
    }),
  });
}
async function salesKpis(req, res) {
  res.json({
    data: await service.salesKpis({
      brand: req.brand,
      from: req.query.from,
      to: req.query.to,
    }),
  });
}
async function opsKpis(req, res) {
  res.json({ data: await service.opsKpis({ brand: req.brand }) });
}
async function listBriefings(req, res) {
  res.json({
    data: await service.listBriefings({ brand: req.brand, user: req.user }),
  });
}
async function getBriefing(req, res) {
  res.json({ data: await service.getBriefing({ id: req.params.id }) });
}
async function markBriefingRead(req, res) {
  res.json({ data: await service.markBriefingRead({ id: req.params.id }) });
}

module.exports = {
  overview,
  salesKpis,
  opsKpis,
  listBriefings,
  getBriefing,
  markBriefingRead,
};
