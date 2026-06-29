/**
 * Retention strategy engine (Module 6.23) — HTTP controller.
 * Authenticated; req.brand. Thin: delegates to strategy.service.
 */

"use strict";

const service = require("./strategy.service");

async function listCatalogue(_req, res) {
  res.json({ data: service.getCatalogue() });
}

async function list(req, res) {
  res.json({ data: await service.list({ brand: req.brand, status: req.query.status }) });
}

async function getOne(req, res) {
  res.json({ data: await service.getOne({ brand: req.brand, id: req.params.id }) });
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

async function fromTemplate(req, res) {
  res.status(201).json({
    data: await service.createFromTemplate({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      template_key: req.body.template_key,
      overrides: req.body.overrides,
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

async function setStatus(req, res) {
  res.json({
    data: await service.setStatus({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.id,
      status: req.body.status,
    }),
  });
}

async function preview(req, res) {
  res.json({
    data: await service.preview({
      brand: req.brand,
      id: req.params.id,
      contact_id: req.body.contact_id,
    }),
  });
}

async function testSend(req, res) {
  res.json({
    data: await service.testSend({
      brand: req.brand,
      id: req.params.id,
      step_order: req.body.step_order,
      user: req.user,
    }),
  });
}

async function listEnrollments(req, res) {
  res.json({ data: await service.listEnrollments({ brand: req.brand, id: req.params.id }) });
}

async function trigger(req, res) {
  res.status(202).json({
    data: await service.trigger({
      brand: req.brand,
      trigger_type: req.body.trigger_type,
      contact_id: req.body.contact_id,
      source_table: req.body.source_table,
      source_id: req.body.source_id,
      event: req.body.event,
    }),
  });
}

module.exports = {
  listCatalogue,
  list,
  getOne,
  create,
  fromTemplate,
  update,
  setStatus,
  preview,
  testSend,
  listEnrollments,
  trigger,
};
