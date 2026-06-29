/**
 * Loyalty rewards catalogue (Module 6.23) — HTTP controller. req.brand.
 */

"use strict";

const service = require("./rewards.service");

async function listCatalogue(req, res) {
  res.json({ data: await service.listCatalogue({ brand: req.brand }) });
}

async function listAll(req, res) {
  res.json({ data: await service.listAll({ brand: req.brand }) });
}

async function create(req, res) {
  res.status(201).json({
    data: await service.create({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      input: req.body,
    }),
  });
}

async function update(req, res) {
  res.json({
    data: await service.update({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.id,
      patch: req.body,
    }),
  });
}

async function redeem(req, res) {
  res.status(201).json({
    data: await service.redeemReward({
      brand: req.brand,
      contact_id: req.body.contact_id,
      reward_id: req.body.reward_id,
      reference_type: req.body.reference_type,
      reference_id: req.body.reference_id,
      user: req.user,
      request_id: req.request_id,
    }),
  });
}

module.exports = { listCatalogue, listAll, create, update, redeem };
