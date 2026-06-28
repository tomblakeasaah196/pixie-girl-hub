/**
 * Storefront geo/currency + delivery quote — PUBLIC routes (no auth).
 * Mounted at /api/public/storefront. The customer website calls these.
 *
 *   GET  /currency            → display/charge currency + FX rates
 *   GET  /shipping-rates      → country flat fees + local zones (NGN)
 *   GET  /geo-options         → countries / NG states / Lagos LGAs (autofill)
 *   GET  /pickup-address      → business pickup address ("collect in store")
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
const zonesService = require("../logistics/zones.service");
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

router.get("/shipping-rates", async (req, res, next) => {
  try {
    const brand = resolveBrand(req);
    res.json({ data: await service.shippingRates({ brand }) });
  } catch (err) {
    next(err);
  }
});

router.post("/delivery-quote", async (req, res, next) => {
  try {
    const brand = resolveBrand(req);
    const { lat, lng, country, qty } = req.body || {};
    res.json({
      data: await service.deliveryQuote({ brand, lat, lng, country, qty }),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/pickup-address", async (req, res, next) => {
  try {
    const brand = resolveBrand(req);
    res.json({ data: await service.pickupAddress({ brand }) });
  } catch (err) {
    next(err);
  }
});

// Delivery fee preview before checkout (§5.5): thin wrapper over the logistics
// zone quote. Resolves by zone_code (NG state/LGA) or ISO-2 country_code + qty —
// no geocoding. Used by the cart/checkout to show the fee live as the buyer
// fills Country/State/City.
router.get("/delivery/quote", async (req, res, next) => {
  try {
    const brand = resolveBrand(req);
    const zoneCode = req.query.zone_code || req.query.country_code || null;
    if (!zoneCode)
      throw new AppError(
        "ZONE_REQUIRED",
        "zone_code or country_code is required",
        400,
      );
    const qty = Math.max(1, parseInt(req.query.qty || "1", 10));
    const quote = await zonesService.quote({
      brand,
      country_code: zoneCode,
      qty,
    });
    res.json({ data: quote });
  } catch (err) {
    next(err);
  }
});

// Geo picker options (countries / Nigerian states / Lagos LGAs) for the
// checkout autofill. Codes match the delivery zones so the quote resolves.
router.get("/geo-options", async (req, res, next) => {
  try {
    const brand = resolveBrand(req);
    res.json({ data: await service.geoOptions({ brand }) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
