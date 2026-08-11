/**
 * Careers public router — the candidate-facing Careers page + application form.
 * Mounted at /api/public/careers (see src/routes/index.js) BEHIND
 * hostBrandResolverMiddleware, so req.brand comes from the host (or ?brand /
 * X-Brand-Context in dev/preview).
 *
 *   GET  /                 — published vacancies for the brand
 *   GET  /:slug            — one vacancy (JD/requirements rendered to HTML)
 *   POST /:slug/apply      — submit an application (multipart: CV + optional
 *                            headshot + up to 3 work images + cover-letter file)
 *
 * The apply route is rate-limited (publicWriteLimiter) and honeypot/captcha
 * guarded in the service. Uploads ride multer memoryStorage → storage.service.
 */

"use strict";

const express = require("express");
const multer = require("multer");
const c = require("./recruitment.careers.controller");
const v = require("./recruitment.careers.validator");
const { publicWriteLimiter } = require("../../middleware");
const { AppError } = require("../../utils/errors");

const MAX_MB = 10; // per file — CVs (pdf/doc) and images alike

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => {
    const ok =
      /^(application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|image\/(jpeg|jpg|png|webp|heic|heif))$/i.test(
        file.mimetype || "",
      );
    cb(
      ok
        ? null
        : new AppError("UNSUPPORTED_FILE", "bad mime", 415, {
            user_message: "Please upload a PDF, Word document or image (JPG/PNG/WEBP).",
          }),
      ok,
    );
  },
});

const uploadFields = upload.fields([
  { name: "cv", maxCount: 1 },
  { name: "headshot", maxCount: 1 },
  { name: "work_images", maxCount: 3 },
  { name: "cover_letter_file", maxCount: 1 },
]);

/** Map multer's own errors (oversized/too-many files) to friendly AppErrors. */
function handleUpload(req, res, next) {
  uploadFields(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return next(
        new AppError("FILE_TOO_LARGE", "file exceeds size limit", 413, {
          user_message: `One of your files is too large — please keep each under ${MAX_MB}MB.`,
        }),
      );
    }
    if (err instanceof multer.MulterError) {
      return next(
        new AppError("UPLOAD_FAILED", err.code || "multer error", 400, {
          user_message: "We couldn't accept those files — please try again.",
        }),
      );
    }
    next(err);
  });
}

const router = express.Router();

router.get("/", c.list);
router.get("/:slug", c.get);
router.post("/:slug/apply", publicWriteLimiter, handleUpload, v.validateApply, c.apply);

module.exports = router;
