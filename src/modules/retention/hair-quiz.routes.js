/**
 * Hair Quiz public endpoints (V2.2 §6.23 — "Find your style"). No auth.
 * Brand from X-Brand-Context header or ?brand (default pixiegirl).
 *   GET  /api/public/hair-quiz          — active quiz + questions
 *   POST /api/public/hair-quiz/submit   — answers → recs + lead + stars
 */

"use strict";

const express = require("express");
const controller = require("./retention.controller");
const validator = require("./retention.validator");

const router = express.Router();

router.get("/", controller.getQuizPublic);
router.post(
  "/submit",
  validator.validateQuizSubmit,
  controller.submitQuizPublic,
);

module.exports = router;
