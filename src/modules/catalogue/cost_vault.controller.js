/**
 * Cost Vault (V2.2 §6.24 P0-1) — HTTP controllers.
 */

"use strict";

const service = require("./cost_vault.service");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

async function getCost(req, res) {
  res.json({
    data: await service.getCost({
      ...base(req),
      variant_id: req.params.variantId,
    }),
  });
}

async function setCost(req, res) {
  res.json({
    data: await service.setCost({
      ...base(req),
      variant_id: req.params.variantId,
      input: req.body,
    }),
  });
}

async function myAccess(req, res) {
  res.json({ data: await service.myAccess({ brand: req.brand, user: req.user }) });
}

async function listGrants(req, res) {
  res.json({ data: await service.listGrants({ brand: req.brand, user: req.user }) });
}

async function grantAccess(req, res) {
  res.status(201).json({
    data: await service.grantAccess({ ...base(req), input: req.body }),
  });
}

async function revokeAccess(req, res) {
  await service.revokeAccess({
    ...base(req),
    target_user_id: req.params.userId,
    reason: req.body ? req.body.reason : undefined,
  });
  res.status(204).end();
}

module.exports = { myAccess, getCost, setCost, listGrants, grantAccess, revokeAccess };
