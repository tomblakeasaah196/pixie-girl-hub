/**
 * Public branding — GET /api/public/branding.
 *
 * Unauthenticated by design: the login page (and any pre-auth screen)
 * needs the product name, logos, fonts and colour theme before any
 * token exists. Display-level data only — no credentials, keys, or
 * settings beyond what every rendered page exposes anyway.
 *
 * Cache briefly so a busy login flow doesn't hit the DB per request;
 * the appearance PATCH broadcasts `branding:updated` over Socket.IO
 * to invalidate every open browser instantly.
 */

"use strict";

const express = require("express");
const controller = require("./platform-settings.controller");

const router = express.Router();

router.get("/", (req, res, next) => {
  res.set("Cache-Control", "public, max-age=60");
  return controller.getPublicBranding(req, res, next);
});

module.exports = router;
