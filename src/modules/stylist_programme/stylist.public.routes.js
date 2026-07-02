/**
 * Stylist Partner Programme (V2.2 §6.26) — PUBLIC routes (no auth).
 * Mounted at /api/public/stylist-programme behind the public write limiter.
 *
 * Surfaces: application questionnaire + intake (landing page), the certified
 * partner directory (storefront + portal), the tokenised customer review page
 * (quality-hold confirmation, Q14/Q15), and the referral redirect (Q17).
 * Badge verification stays at /api/public/stylist-verify (verify.routes.js).
 */

"use strict";

const express = require("express");
const multer = require("multer");
const c = require("./stylist.controller");
const v = require("./stylist.validator");
const { config } = require("../../config/env");

const router = express.Router();

// Application docs: ID + business verification (Q8). Images/PDF only, capped.
const applicationUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: (config.MEDIA_MAX_FILE_SIZE_MB || 10) * 1024 * 1024,
    files: 2,
  },
  fileFilter: (_req, file, cb) => {
    const ok = /^(image\/|application\/pdf)/.test(file.mimetype || "");
    cb(ok ? null : new Error("Only images or PDF documents are accepted"), ok);
  },
});

router.get("/questions", c.publicQuestions);
router.post(
  "/apply",
  applicationUpload.any(),
  v.validatePublicApply,
  c.publicApply,
);
router.get("/directory", c.publicDirectory);
router.get("/review/:token", c.publicGetReview);
router.post("/review/:token", v.validateRating, c.publicSubmitReview);
router.get("/r/:code", c.publicReferralRedirect);

module.exports = router;
