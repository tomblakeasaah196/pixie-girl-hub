/**
 * Storefront geo/currency + delivery quote — PUBLIC routes (no auth).
 * Mounted at /api/public/storefront. The customer website calls these.
 *
 *   GET  /currency            → display/charge currency + FX rates
 *   POST /delivery-quote      → geofenced delivery fee for {lat,lng}
 *
 * Brand comes from ?brand or the X-Brand-Context header (the storefront sets
 * it from its host/config). Country comes from ?country (client geo) and falls
 * back to the cf-ipcountry header when the site is behind Cloudflare.
 */

"use strict";

const express = require("express");
const { VALID } = require("../../config/brands");
const service = require("./geo.service");
const { AppError } = require("../../utils/errors");

const router = express.Router();

function resolveBrand(req) {
  const b = req.query.brand || req.headers["x-brand-context"];
  if (!b || !VALID.has(b))
    throw new AppError("BRAND_REQUIRED", "A valid brand is required", 400);
  return b;
}

router.get("/currency", async (req, res, next) => {
  try {
    const country =
      req.query.country || req.headers["cf-ipcountry"] || null;
    res.json({ data: await service.resolveCurrency({ country }) });
  } catch (err) {
    next(err);
  }
});

router.post("/delivery-quote", async (req, res, next) => {
  try {
    const brand = resolveBrand(req);
    const { lat, lng, country } = req.body || {};
    res.json({
      data: await service.deliveryQuote({ brand, lat, lng, country }),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
