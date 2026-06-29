/**
 * Maintenance plans (Module 6.23) — HTTP controller. req.brand.
 */

"use strict";

const service = require("./maintenance.service");

async function listPlans(req, res) {
  res.json({ data: await service.listPlans({ brand: req.brand }) });
}

async function listSubscriptions(req, res) {
  res.json({ data: await service.listSubscriptions({ brand: req.brand }) });
}

async function createPlan(req, res) {
  res.status(201).json({
    data: await service.createPlan({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      input: req.body,
    }),
  });
}

async function updatePlan(req, res) {
  res.json({
    data: await service.updatePlan({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.id,
      patch: req.body,
    }),
  });
}

module.exports = { listPlans, listSubscriptions, createPlan, updatePlan };
