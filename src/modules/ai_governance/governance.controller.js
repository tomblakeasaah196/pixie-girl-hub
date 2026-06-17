/**
 * AI Governance (V2.2 §6.31) — HTTP controller (the "AI Control" surface).
 */

"use strict";

const service = require("./governance.service");

const base = (req) => ({ user: req.user, request_id: req.request_id });

// Flags
async function listFlags(req, res) {
  res.json({ data: await service.listFlags() });
}
async function upsertFlag(req, res) {
  res.status(201).json({
    data: await service.upsertFlag({ ...base(req), input: req.body }),
  });
}
async function toggleFlag(req, res) {
  res.json({
    data: await service.setFlagEnabled({
      ...base(req),
      feature_key: req.params.feature_key,
      is_enabled: req.body.is_enabled,
    }),
  });
}

// Grants
async function listGrants(req, res) {
  res.json({
    data: await service.listGrants({
      user_id: req.query.user_id,
      feature_key: req.query.feature_key,
    }),
  });
}
async function grant(req, res) {
  res
    .status(201)
    .json({ data: await service.grant({ ...base(req), input: req.body }) });
}
async function revokeGrant(req, res) {
  await service.revokeGrant({
    ...base(req),
    grant_id: req.params.grant_id,
    reason: req.body.reason,
  });
  res.status(204).end();
}

// Vendors
async function listVendors(req, res) {
  res.json({ data: await service.listVendors() });
}
async function upsertVendor(req, res) {
  res.status(201).json({
    data: await service.upsertVendor({ ...base(req), input: req.body }),
  });
}
async function rotateVendor(req, res) {
  res.json({
    data: await service.rotateVendorKey({
      ...base(req),
      vendor: req.params.vendor,
      api_key: req.body.api_key,
    }),
  });
}
async function setVendorActive(req, res) {
  res.json({
    data: await service.setVendorActive({
      ...base(req),
      vendor: req.params.vendor,
      is_active: req.body.is_active,
    }),
  });
}

// Budget
async function activeBudget(req, res) {
  res.json({ data: await service.getActivePeriod() });
}
async function listBudgets(req, res) {
  res.json({ data: await service.listPeriods() });
}
async function openBudget(req, res) {
  res.status(201).json({
    data: await service.openPeriod({ ...base(req), input: req.body }),
  });
}
async function setBudgetCaps(req, res) {
  res.json({
    data: await service.setCaps({
      ...base(req),
      period_id: req.params.period_id,
      soft_cap_ngn: req.body.soft_cap_ngn,
      hard_cap_ngn: req.body.hard_cap_ngn,
    }),
  });
}

// Usage
async function listUsage(req, res) {
  res.json({
    data: await service.listUsage({
      feature_key: req.query.feature_key,
      user_id: req.query.user_id,
      from: req.query.from,
      to: req.query.to,
    }),
  });
}
async function spendMeter(req, res) {
  res.json({
    data: await service.spendMeter({
      from: req.query.from,
      to: req.query.to,
      feature_key: req.query.feature_key,
      vendor: req.query.vendor,
    }),
  });
}

// Action catalogue
async function listActions(req, res) {
  res.json({
    data: await service.listActions({
      module: req.query.module,
      category: req.query.category,
      ai_enabled:
        req.query.ai_enabled === undefined
          ? undefined
          : req.query.ai_enabled === "true",
      is_write:
        req.query.is_write === undefined
          ? undefined
          : req.query.is_write === "true",
    }),
  });
}
async function upsertAction(req, res) {
  res.status(201).json({
    data: await service.upsertAction({ ...base(req), input: req.body }),
  });
}
async function toggleAction(req, res) {
  res.json({
    data: await service.setActionEnabled({
      ...base(req),
      action_key: req.params.action_key,
      ai_enabled: req.body.ai_enabled,
    }),
  });
}

async function listModels(req, res) {
  res.json({
    data: await service.listModels({
      vendor: req.query.vendor,
      capability: req.query.capability,
      active_only: req.query.include_inactive !== "true",
    }),
  });
}
async function upsertModel(req, res) {
  res.status(201).json({
    data: await service.upsertModel({
      user: req.user,
      request_id: req.request_id,
      input: req.body,
    }),
  });
}

async function getBrandVoice(req, res) {
  res.json(await service.getBrandVoice({ brand: req.brand }));
}
async function upsertBrandVoice(req, res) {
  res.json({
    data: await service.upsertBrandVoice({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      input: req.body,
    }),
  });
}

module.exports = {
  listFlags,
  upsertFlag,
  toggleFlag,
  listGrants,
  grant,
  revokeGrant,
  listVendors,
  upsertVendor,
  rotateVendor,
  setVendorActive,
  activeBudget,
  listBudgets,
  openBudget,
  setBudgetCaps,
  listUsage,
  spendMeter,
  listActions,
  upsertAction,
  toggleAction,
  getBrandVoice,
  upsertBrandVoice,
  listModels,
  upsertModel,
};
