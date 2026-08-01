/**
 * Public order tracking (V2.2 §6.23.6).
 * Lookup by public_tracking_token. No auth required.
 * GET /api/public/tracking/:token
 *
 * Read-only by design. The driver self-confirmation link that used to live
 * here (GET /driver/:token, POST /driver/:token/confirm) has been retired —
 * deliveries are marked complete by staff inside the Hub, so no
 * unauthenticated write path onto the delivery state machine remains.
 */

"use strict";

const express = require("express");
const controller = require("./logistics.controller");

const router = express.Router();

// Public, unauthenticated: resolve a delivery by its tracking token (searched
// across brands) and return status + state history.
router.get("/:token", controller.trackPublic);

module.exports = router;
