/**
 * Payment-gateway configuration controller (B / PD §6.21). HTTP only.
 * Credentials are write-only (never returned); reads are masked.
 */

"use strict";

const service = require("./payment-gateways.service");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

async function list(req, res) {
  res.json({ data: await service.listGateways({ brand: req.brand }) });
}
async function configure(req, res) {
  res.json({
    data: await service.configureGateway({ ...base(req), input: req.body }),
  });
}
async function setActive(req, res) {
  res.json({
    data: await service.setActive({
      ...base(req),
      provider: req.params.provider,
      is_active: req.body.is_active,
    }),
  });
}
async function setRole(req, res) {
  res.json({
    data: await service.setRole({
      ...base(req),
      provider: req.params.provider,
      role: req.body.role,
    }),
  });
}
async function remove(req, res) {
  await service.removeGateway({ ...base(req), provider: req.params.provider });
  res.status(204).end();
}

module.exports = { list, configure, setActive, setRole, remove };
