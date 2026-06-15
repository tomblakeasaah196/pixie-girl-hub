/**
 * Public PWA manifest — GET /api/public/manifest.webmanifest.
 *
 * Unauthenticated by design: the install/app shell needs the product
 * name, theme colour and icons before any token exists. Built live from
 * platform_settings so the installed app reflects the current branding
 * (the "dynamic app name" requirement for PWA).
 */

"use strict";

const express = require("express");
const controller = require("./platform-settings.controller");

const router = express.Router();

router.get("/", controller.getWebManifest);

module.exports = router;
