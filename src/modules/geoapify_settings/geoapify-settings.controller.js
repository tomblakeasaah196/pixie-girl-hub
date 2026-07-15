"use strict";

const service = require("./geoapify-settings.service");

const ctx = (req) => ({ user: req.user, request_id: req.request_id });

async function getSettings(req, res) {
  res.json({ data: await service.getSettings() });
}

async function upsertSettings(req, res) {
  res.status(201).json({
    data: await service.upsertSettings({ ...ctx(req), input: req.body }),
  });
}

async function revealSecret(req, res) {
  const result = await service.revealSecret({
    ...ctx(req),
    field: req.body.field,
    password: req.body.password,
    source_ip: req.ip,
  });
  res.json(result);
}

async function listReveals(req, res) {
  res.json({ data: await service.listReveals() });
}

async function testConnection(req, res) {
  res.json(await service.testConnection());
}

module.exports = {
  getSettings,
  upsertSettings,
  revealSecret,
  listReveals,
  testConnection,
};
