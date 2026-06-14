/**
 * Public geo-welcome — GET /api/public/geo-welcome.
 *
 * Unauthenticated, per-IP. The login page calls this to greet a visitor
 * by continent ("Welcome from Africa") using login_config.region_messages.
 * Best-effort: a missing/private IP or a failed lookup falls back to the
 * default welcome, and the endpoint always returns 200.
 *
 * Never cached (Cache-Control: no-store, set in the controller) — the
 * response varies per client IP.
 */

"use strict";

const express = require("express");
const controller = require("./platform-settings.controller");

const router = express.Router();

router.get("/", controller.getGeoWelcome);

module.exports = router;
