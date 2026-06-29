/**
 * Loyalty earn-rules (Module 6.23) — HTTP controller. req.brand.
 */

"use strict";

const service = require("./earn.service");

async function list(req, res) {
  res.json({ data: await service.list({ brand: req.brand }) });
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

module.exports = { list, create, update };
