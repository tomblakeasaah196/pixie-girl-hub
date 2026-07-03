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
const { AppError } = require("../../utils/errors");
const c = require("./shade-finder.controller");
const v = require("./shade-finder.validator");
const service = require("./shade-finder.service");

const router = express.Router();

// Selfie/hair photos only — Gemini-supported raster types (HEIC converts
// in-memory via the shared compressor). 8MB cap keeps memory bounded.
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpeg|jpg|png|webp|heic|heif)$/i.test(
      file.mimetype || "",
    );
    cb(ok ? null : new AppError("UNSUPPORTED_PHOTO", "bad mime", 400, {
      user_message: "Please upload a JPG, PNG, WEBP or iPhone (HEIC) photo.",
    }), ok);
  },
});

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
  photoUpload.single("photo"),
  v.validateAnalyze,
  c.analyze,
);
router.post("/session/:sid/chat", requireGuest, v.validateChat, c.chat);

module.exports = router;
