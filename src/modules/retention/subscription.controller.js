/**
 * Wig subscription (F-1 / PD §6.23.5) — HTTP controller. Authenticated; req.brand.
 */

"use strict";

const service = require("./subscription.service");

// ── Plans ──
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

async function listPlans(req, res) {
  res.json({
    data: await service.listPlans({
      brand: req.brand,
      only_active: req.query.active === "true",
    }),
  });
}

async function getPlan(req, res) {
  res.json({
    data: await service.getPlan({ brand: req.brand, id: req.params.id }),
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

async function setPlanActive(req, res) {
  res.json({
    data: await service.setPlanActive({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.id,
      is_active: req.body.is_active,
    }),
  });
}

// ── Subscriptions ──
async function enrol(req, res) {
  res.status(201).json({
    data: await service.enrol({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      input: req.body,
    }),
  });
}

async function listSubs(req, res) {
  res.json({
    data: await service.listSubscriptions({
      brand: req.brand,
      contact_id: req.query.contact_id,
      status: req.query.status,
    }),
  });
}

async function getSub(req, res) {
  res.json({
    data: await service.getSubscription({
      brand: req.brand,
      id: req.params.id,
    }),
  });
}

const action = (fn) => async (req, res) => {
  res.json({
    data: await service[fn]({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.id,
      reason: req.body && req.body.reason,
    }),
  });
};

module.exports = {
  createPlan,
  listPlans,
  getPlan,
  updatePlan,
  setPlanActive,
  enrol,
  listSubs,
  getSub,
  pause: action("pause"),
  resume: action("resume"),
  cancel: action("cancel"),
};
