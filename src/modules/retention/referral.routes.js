/**
 * Public referral landing (V2.2 §6.23). No auth.
 * GET /api/public/referral/:code → validate a shared referral code.
 * The brand is implied by the code (referral_code is globally unique).
 */

"use strict";

const express = require("express");
const controller = require("./retention.controller");

const router = express.Router();

router.get("/:code", controller.validateReferralPublic);

module.exports = router;
