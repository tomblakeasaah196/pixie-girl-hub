/**
 * Shade Finder public endpoints (Praxis Shade Match). No account needed.
 * Mounted at /api/public/shade-finder. Brand from X-Brand-Context / ?brand.
 *
 *   POST   /session               — open a guest session (token + shades + quota)
 *   GET    /session/:sid          — restore state after a refresh
 *   DELETE /session/:sid          — end session, wipe all state now
 *   POST   /session/:sid/analyze  — multipart photo (+optional message) → advice
 *   POST   /session/:sid/chat     — follow-up text turn
 *
 * The photo rides multer memoryStorage and is never written to disk — see
 * the privacy contract in shade-finder.service.js.
 */

"use strict";

const express = require("express");
const multer = require("multer");
const { config } = require("../../config/env");
const { AppError } = require("../../utils/errors");
const c = require("./shade-finder.controller");
const v = require("./shade-finder.validator");
const service = require("./shade-finder.service");

const router = express.Router();

const MAX_PHOTO_MB = config.SHADE_FINDER_MAX_PHOTO_MB;

// Selfie/hair photos only — Gemini-supported raster types (HEIC converts
// in-memory via the shared compressor). The cap keeps memory bounded; the
// shared compressor (media-compression.service) then downscales whatever
// gets through before it ever reaches Gemini.
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|webp|heic|heif)$/i.test(
      file.mimetype || "",
    );
    cb(ok ? null : new AppError("UNSUPPORTED_PHOTO", "bad mime", 400, {
      user_message: "Please upload a JPG, PNG, WEBP or iPhone (HEIC) photo.",
    }), ok);
  },
});

/**
 * multer's own errors (oversized file, stray extra file) arrive via next(err)
 * as a MulterError, which is neither an AppError nor anything the global
 * handler recognises — it used to fall through to a generic "something went
 * wrong" 500 that gave the shopper no idea their photo was the problem. Map
 * the size-limit case explicitly so they're told exactly what to do instead
 * of silently failing (and Praxis never gets a photo to hallucinate around).
 */
function uploadPhoto(req, res, next) {
  photoUpload.single("photo")(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return next(
        new AppError("PHOTO_TOO_LARGE", "photo exceeds size limit", 413, {
          user_message: `That photo is a bit too heavy — please try one under ${MAX_PHOTO_MB}MB.`,
        }),
      );
    }
    if (err instanceof multer.MulterError) {
      return next(
        new AppError("UPLOAD_FAILED", err.code || "multer error", 400, {
          user_message: "That photo couldn't be uploaded — please try again.",
        }),
      );
    }
    next(err);
  });
}

/** Guest-token gate: Bearer token bound to this session id + brand. */
function requireGuest(req, _res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  const payload = token && service.verifyGuestToken(token);
  if (!payload || payload.sid !== req.params.sid) {
    throw new AppError("GUEST_AUTH_REQUIRED", "bad shade guest token", 401, {
      user_message: "This styling session has ended — start a fresh one.",
    });
  }
  req.shadeGuest = payload;
  next();
}

router.post("/session", c.startSession);
router.get("/session/:sid", requireGuest, c.getSession);
router.delete("/session/:sid", requireGuest, c.endSession);
router.post(
  "/session/:sid/analyze",
  requireGuest,
  uploadPhoto,
  v.validateAnalyze,
  c.analyze,
);
router.post("/session/:sid/chat", requireGuest, v.validateChat, c.chat);

module.exports = router;
