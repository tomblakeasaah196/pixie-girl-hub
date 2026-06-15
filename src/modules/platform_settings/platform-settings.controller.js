/**
 * Platform Settings — HTTP controllers.
 */

"use strict";

const service = require("./platform-settings.service");
const { config } = require("../../config/env");

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

const getWebManifest = async (_req, res) => {
  const manifest = await service.getWebManifest();
  res.set("Cache-Control", "public, max-age=300");
  res.type("application/manifest+json");
  res.send(JSON.stringify(manifest));
};

const getGeoWelcome = async (req, res) => {
  // Per-IP and best-effort — never cache, never fail the page.
  res.set("Cache-Control", "no-store");

  // Development-only preview: ?geo=<continent code> forces a region's copy,
  // ?ip=<public ip> does a real lookup of that address. Ignored in prod so
  // a visitor can never spoof their greeting.
  let override;
  if (config.NODE_ENV !== "production") {
    const geo =
      typeof req.query.geo === "string" ? req.query.geo.toUpperCase() : null;
    const ip = typeof req.query.ip === "string" ? req.query.ip : null;
    const country =
      typeof req.query.country === "string" ? req.query.country : null;
    if (geo || ip) override = { continent: geo, ip, country };
  }

  res.json({ data: await service.getGeoWelcome({ ip: req.ip, override }) });
};

const uploadImage = async (req, res) =>
  res.json({
    data: await service.uploadBrandingImage({
      file: req.file,
      user: req.user,
      purpose: req.body?.purpose,
    }),
  });

module.exports = {
  getSettings,
  updateSettings,
  listFonts,
  getPublicBranding,
  getWebManifest,
  getGeoWelcome,
  uploadImage,
};
