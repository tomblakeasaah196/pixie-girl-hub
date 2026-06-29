/**
 * Referral programme admin (Module 6.23) — HTTP controller. req.brand.
 */

"use strict";

const service = require("./referral-admin.service");

async function getSettings(req, res) {
  res.json({ data: await service.getSettings({ brand: req.brand }) });
}

async function saveSettings(req, res) {
  res.json({
    data: await service.saveSettings({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      patch: req.body,
    }),
  });
}

async function listTiers(req, res) {
  res.json({ data: await service.listTiers({ brand: req.brand }) });
}

async function createTier(req, res) {
  res.status(201).json({
    data: await service.createTier({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      input: req.body,
    }),
  });
}

async function updateTier(req, res) {
  res.json({
    data: await service.updateTier({ brand: req.brand, id: req.params.id, patch: req.body }),
  });
}

async function deleteTier(req, res) {
  res.json({ data: await service.deleteTier({ brand: req.brand, id: req.params.id }) });
}

async function dashboard(req, res) {
  res.json({ data: await service.dashboard({ brand: req.brand }) });
}

module.exports = {
  getSettings,
  saveSettings,
  listTiers,
  createTier,
  updateTier,
  deleteTier,
  dashboard,
};
