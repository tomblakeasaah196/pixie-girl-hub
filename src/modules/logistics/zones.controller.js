/**
 * Delivery zones — HTTP controller.
 */

"use strict";

const service = require("./zones.service");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

async function list(req, res) {
  res.json({ data: await service.list({ brand: req.brand }) });
}
async function create(req, res) {
  res.status(201).json({
    data: await service.create({ ...base(req), input: req.body }),
  });
}
async function update(req, res) {
  res.json({
    data: await service.update({
      ...base(req),
      id: req.params.id,
      patch: req.body,
    }),
  });
}
async function remove(req, res) {
  await service.remove({ ...base(req), id: req.params.id });
  res.status(204).end();
}
async function quote(req, res) {
  res.json({
    data: await service.quote({
      brand: req.brand,
      lat: req.query.lat,
      lng: req.query.lng,
      country_code: req.query.country,
    }),
  });
}

module.exports = { list, create, update, remove, quote };
