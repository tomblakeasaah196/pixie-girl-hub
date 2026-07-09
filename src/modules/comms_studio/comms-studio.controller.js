"use strict";

const service = require("./comms-studio.service");

const ctx = (req) => ({
  user: req.user,
  brand: req.brand,
  request_id: req.request_id,
});

async function list(req, res) {
  const data = await service.listAutomations({ brand: req.brand });
  res.json({ data });
}

async function get(req, res) {
  const data = await service.getAutomation({
    brand: req.brand,
    event_key: req.params.event_key,
  });
  if (!data) return res.status(404).json({ error: { code: "NOT_FOUND" } });
  res.json(data);
}

async function update(req, res) {
  const data = await service.updateAutomation({ ...ctx(req), input: req.body });
  res.json(data);
}

async function preview(req, res) {
  const data = await service.previewAutomation({
    brand: req.brand,
    input: req.body,
  });
  res.json(data);
}

async function sendTest(req, res) {
  const data = await service.sendTest({ ...ctx(req), input: req.body });
  res.json(data);
}

async function sendLog(req, res) {
  const data = await service.listSendLog({
    brand: req.brand,
    event_key: req.params.event_key,
    limit: Number(req.query.limit) || 25,
  });
  res.json({ data });
}

module.exports = { list, get, update, preview, sendTest, sendLog };
