"use strict";

const service = require("./service-catalogue.service");

const ctx = (req) => ({
  user: req.user,
  brand: req.brand,
  request_id: req.request_id,
});

async function listServices(req, res) {
  const data = await service.listServices({
    brand: req.brand,
    category: req.query.category,
    active_only: req.query.include_inactive !== "true",
  });
  res.json({ data });
}

async function getService(req, res) {
  const data = await service.getService({
    brand: req.brand,
    id: req.params.id,
  });
  res.json(data);
}

async function createService(req, res) {
  const data = await service.createService({ ...ctx(req), input: req.body });
  res.status(201).json(data);
}

async function updateService(req, res) {
  const data = await service.updateService({
    ...ctx(req),
    id: req.params.id,
    input: req.body,
  });
  res.json(data);
}

async function deleteService(req, res) {
  await service.deleteService({ ...ctx(req), id: req.params.id });
  res.status(204).end();
}

module.exports = {
  listServices,
  getService,
  createService,
  updateService,
  deleteService,
};
