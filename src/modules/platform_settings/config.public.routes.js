/**
 * Public runtime config — GET /api/public/config.
 *
 * Unauthenticated by design: the public Walk-in + Online-QR address forms
 * read the Google Maps/Places browser key from here at runtime, so the key
 * can be set on the live server (an env var) and take effect WITHOUT a fresh
 * admin build. Display-level, non-secret data only (a referrer-restricted
 * browser key), mirroring the branding/manifest public feeds.
 */

"use strict";

const express = require("express");
const controller = require("./platform-settings.controller");

const router = express.Router();

router.get("/", controller.getPublicConfig);

module.exports = router;
