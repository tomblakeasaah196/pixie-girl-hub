"use strict";

const service = require("./outbound-policy.service");

const ctx = (req) => ({
  user: req.user,
  brand: req.brand,
  request_id: req.request_id,
});

async function listPolicies(req, res) {
  const data = await service.listPolicies({ brand: req.brand });
  res.json({ data });
}

async function getPolicy(req, res) {
  const data = await service.getPolicy({
    brand: req.brand,
    event_key: req.params.event_key,
  });
  if (!data) return res.status(404).json({ error: { code: "NOT_FOUND" } });
  res.json(data);
}

async function upsertPolicy(req, res) {
  const data = await service.upsertPolicy({ ...ctx(req), input: req.body });
  res.json(data);
}

async function resolveChannel(req, res) {
  const data = await service.resolveChannel({
    brand: req.brand,
    event_key: req.query.event_key,
    contact_id: req.query.contact_id,
  });
  res.json(data);
}

module.exports = { listPolicies, getPolicy, upsertPolicy, resolveChannel };
