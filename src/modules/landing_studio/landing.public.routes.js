/**
 * Landing Studio — PUBLIC routes (no auth).
 * Mounted at /api/public/landing (host → brand resolver runs first).
 *
 *   GET / → published brand-level landing config (404 if never published)
 */

"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const controller = require("./landing.public.controller");

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

router.get("/", readLimiter, controller.published);
router.post("/signup", readLimiter, controller.signup);

module.exports = router;
