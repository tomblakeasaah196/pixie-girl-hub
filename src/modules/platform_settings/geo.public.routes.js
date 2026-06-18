/**
 * Public geo endpoints (unauthenticated, per-IP).
 *
 * GET /api/public/geo-welcome   — login-page continent greeting
 * GET /api/public/geo/currency  — storefront SSR currency detection
 *
 * Both are best-effort (always 200, never cached).
 * Results come from the local MaxMind GeoLite2-Country mmdb reader;
 * no external API calls are made.
 */

"use strict";

const express = require("express");
const controller = require("./platform-settings.controller");

// ── /api/public/geo-welcome (existing) ────────────────────────────────────
const welcomeRouter = express.Router();
welcomeRouter.get("/", controller.getGeoWelcome);

// ── /api/public/geo (new) ─────────────────────────────────────────────────
const geoRouter = express.Router();

/**
 * GET /api/public/geo/currency
 * Body: { data: { country: 'NG'|null, currency: 'NGN'|'USD'|... } }
 * Used by the Next.js storefront during SSR to choose the display currency
 * before the first paint (zero layout shift).
 */
geoRouter.get("/currency", controller.getGeoCurrency);

module.exports = { welcomeRouter, geoRouter };
