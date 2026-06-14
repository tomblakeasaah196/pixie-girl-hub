/**
 * Platform Settings — HTTP controllers.
 */

"use strict";

const service = require("./platform-settings.service");

const getSettings = async (_req, res) =>
  res.json({ data: await service.getPlatformSettings() });

const updateSettings = async (req, res) =>
  res.json({
    data: await service.updatePlatformSettings({
      user: req.user,
      request_id: req.request_id,
      input: req.body,
    }),
  });

const listFonts = async (_req, res) =>
  res.json({ data: await service.listFonts() });

const getPublicBranding = async (_req, res) =>
  res.json({ data: await service.getPublicBranding() });

const getGeoWelcome = async (req, res) => {
  // Per-IP and best-effort — never cache, never fail the page.
  res.set("Cache-Control", "no-store");
  res.json({ data: await service.getGeoWelcome({ ip: req.ip }) });
};

module.exports = {
  getSettings,
  updateSettings,
  listFonts,
  getPublicBranding,
  getGeoWelcome,
};
