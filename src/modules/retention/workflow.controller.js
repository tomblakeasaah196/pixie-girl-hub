/**
 * Automated retention workflows (F-4 / PD §6.23) — HTTP controller.
 * Authenticated; req.brand.
 */

"use strict";

const service = require("./workflow.service");

async function create(req, res) {
  res.status(201).json({
    data: await service.createRule({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      input: req.body,
    }),
  });
}

async function list(req, res) {
  res.json({
    data: await service.listRules({
      brand: req.brand,
      only_active: req.query.active === "true",
    }),
  });
}

async function getOne(req, res) {
  res.json({
    data: await service.getRule({ brand: req.brand, id: req.params.id }),
  });
}

async function update(req, res) {
  res.json({
    data: await service.updateRule({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.id,
      patch: req.body,
    }),
  });
}

async function setActive(req, res) {
  res.json({
    data: await service.setRuleActive({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.id,
      is_active: req.body.is_active,
    }),
  });
}

async function trigger(req, res) {
  res.status(202).json({
    data: await service.trigger({
      brand: req.brand,
      trigger_type: req.body.trigger_type,
      contact_id: req.body.contact_id,
      source_table: req.body.source_table,
      source_id: req.body.source_id,
    }),
  });
}

module.exports = { create, list, getOne, update, setActive, trigger };
