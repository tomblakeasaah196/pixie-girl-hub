/**
 * Public email tracking (V2.2 §6.16). No auth — these URLs are embedded in
 * sent emails. Brand from X-Brand-Context header / ?brand.
 *   GET /api/public/email/open/:recipient_id     → 1x1 pixel, logs an open
 *   GET /api/public/email/click/:recipient_id?url → 302 redirect, logs a click
 *   GET /api/public/email/unsubscribe/:recipient_id → marks unsubscribed
 */

"use strict";

const express = require("express");
const c = require("./email-campaigns.controller");

const router = express.Router();

router.get("/open/:recipient_id", c.trackOpen);
router.get("/click/:recipient_id", c.trackClick);
router.get("/unsubscribe/:recipient_id", c.unsubscribe);

module.exports = router;
