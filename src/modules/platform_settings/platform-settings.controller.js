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

/**
 * GET /api/public/config — runtime client config for unauthenticated pages.
 *
 * Today it surfaces the Google Maps/Places browser key so the public address
 * forms enable autocomplete from a SERVER env var (no admin rebuild needed —
 * a baked-in VITE_* var can't be changed without one). Forgiving on the var
 * name so whatever the operator already set on the host is picked up. The key
 * is a public, referrer-restricted browser key — safe to expose here.
 */
const getPublicConfig = (_req, res) => {
  const mapsKey =
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.VITE_GOOGLE_PLACES_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_KEY ||
    "";
  res.set("Cache-Control", "public, max-age=300");
  res.json({
    data: {
      maps: { places_key: mapsKey || null, configured: Boolean(mapsKey) },
    },
  });
};

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

/**
 * GET /api/public/geo/currency
 *
 * Returns the detected country + recommended storefront currency for the
 * requesting IP. Called by the Next.js storefront during SSR to initialise
 * the price-display component without a layout shift.
 *
 * Always 200 — falls back to USD on missing/private IP.
 * Cache-Control: no-store — response varies per client IP.
 */
const getGeoCurrency = (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    data: {
      country: req.geoCountry || null,
      currency: req.geoCurrency || "USD",
    },
  });
};

module.exports = {
  getSettings,
  updateSettings,
  listFonts,
  getPublicBranding,
  getPublicConfig,
  getWebManifest,
  getGeoWelcome,
  getGeoCurrency,
  uploadImage,
};
