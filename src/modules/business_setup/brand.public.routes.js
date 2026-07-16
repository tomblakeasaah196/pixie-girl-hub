/**
 * Public brand identity — GET /api/public/brand/:brandKey.
 *
 * Unauthenticated by design: the public apps (sales landing, storefront)
 * need the brand's display name, domains, and support mailbox WITHOUT
 * hardcoding them — everything served here comes from
 * shared.business_config, which the CEO edits in Settings → Business
 * Setup → Public Identity. Display-level data only; a domain change is
 * done entirely from the UI and picked up here on the next request.
 */

"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const { VALID_BRANDS } = require("../../config/brands");
const controller = require("./business-setup.controller");

const router = express.Router();

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "TOO_MANY_REQUESTS",
      message: "Too many requests — slow down and try again shortly.",
    },
  },
});

router.get("/:brandKey", readLimiter, (req, res, next) => {
  const key = String(req.params.brandKey || "").toLowerCase().trim();
  if (!VALID_BRANDS.has(key)) {
    return res.status(404).json({
      error: { code: "NOT_FOUND", message: "Unknown brand" },
    });
  }
  res.set("Cache-Control", "public, max-age=60");
  return controller.getPublicBrandIdentity(req, res, next);
});

module.exports = router;
