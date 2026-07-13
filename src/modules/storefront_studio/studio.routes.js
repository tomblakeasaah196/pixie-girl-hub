/**
 * Storefront Studio (V2.2 §6.28) — routes. Mounted at /api/v1/storefront-studio.
 * Permission key: storefront_studio. Draft/publish editor for the brand's
 * theme, navigation and pages.
 *
 * Backing tables (shared): storefront_themes, storefront_pages,
 * storefront_navigation, storefront_revisions.
 */

"use strict";

const os = require("os");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const multer = require("multer");
const controller = require("./studio.controller");
const validator = require("./studio.validator");
const { requirePermission } = require("../../middleware/rbac");
const { AppError } = require("../../utils/errors");

const router = express.Router();
const can = (action) => requirePermission("storefront_studio", action);

// In-memory upload for branding images (logo/favicon/OG). 8MB cap.
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

// Video uploads stream to disk — a raw phone clip can be 100MB+, which must
// never sit in the Node heap. FFmpeg reads the temp file; the service unlinks
// it when done.
const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
const videoUpload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname || "") || ".mp4")
        .toLowerCase()
        .replace(/[^.a-z0-9]/g, "")
        .slice(0, 6);
      cb(null, `sf-video-${crypto.randomBytes(12).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: VIDEO_MAX_BYTES },
});

// Translate multer's size error into the platform error shape (otherwise a
// too-big file surfaces as an opaque 500).
function acceptVideoUpload(req, res, next) {
  videoUpload.single("file")(req, res, (err) => {
    if (err && err.code === "LIMIT_FILE_SIZE") {
      next(
        new AppError("FILE_TOO_LARGE", "Video exceeds the upload limit", 413, {
          user_message:
            "That video is over 200MB. Trim it shorter (the loop only keeps 20 seconds) and try again.",
        }),
      );
      return;
    }
    next(err);
  });
}

// Theme
router.get("/theme", can("view"), controller.getThemes);
router.put(
  "/theme/draft",
  can("edit"),
  validator.validateThemeDraft,
  controller.saveThemeDraft,
);
router.post("/theme/publish", can("approve"), controller.publishTheme);

// Navigation
router.get("/navigation", can("view"), controller.getNavigation);
router.put(
  "/navigation/draft",
  can("edit"),
  validator.validateNavDraft,
  controller.saveNavDraft,
);
router.post("/navigation/publish", can("approve"), controller.publishNav);

// Pages
router.get("/pages", can("view"), controller.listPages);
router.put(
  "/pages/draft",
  can("edit"),
  validator.validatePageDraft,
  controller.savePageDraft,
);
router.post("/pages/:pageKey/publish", can("approve"), controller.publishPage);

// Popups (newsletter / exit-intent / promo / age-gate)
router.get("/popups", can("view"), controller.listPopups);
router.put(
  "/popups/draft",
  can("edit"),
  validator.validatePopupDraft,
  controller.savePopupDraft,
);
router.post(
  "/popups/:popupKey/publish",
  can("approve"),
  controller.publishPopup,
);
router.delete("/popups/:popupKey", can("approve"), controller.deletePopup);

// Branding image upload (logo / favicon / OG) -> returns { url }.
router.post(
  "/upload-image",
  can("edit"),
  imageUpload.single("file"),
  controller.uploadImage,
);

// Looping-video upload (hero "living image"). Multipart fields: file +
// trim_start/trim_end (sec), aspect, focus. Trims to ≤20s, compresses and
// cleans the picture into HD/SD MP4 loops + a poster; returns their URLs.
router.post(
  "/upload-video",
  can("edit"),
  acceptVideoUpload,
  controller.uploadVideo,
);

// Content posts (FAQ / care guide / journal / policy) — the storefront CMS
// that also feeds Praxis's Brand Brain. Single-row status lifecycle, so
// publish/unpublish flip status rather than duplicating a draft.
router.get("/content", can("view"), controller.listContent);
router.post(
  "/content",
  can("edit"),
  validator.validateContentPost,
  controller.createContent,
);
router.put(
  "/content/:postId",
  can("edit"),
  validator.validateContentPost,
  controller.updateContent,
);
router.post("/content/:postId/publish", can("approve"), controller.publishContent);
router.post(
  "/content/:postId/unpublish",
  can("approve"),
  controller.unpublishContent,
);
router.delete("/content/:postId", can("approve"), controller.deleteContent);

// Section template library for the page composer.
router.get("/section-templates", can("view"), controller.listSectionTemplates);

// Draft preview: mint a token + storefront URL for the embedded/live preview.
router.get("/preview", can("view"), controller.previewInfo);

// Revisions: publish history + one-click rollback (restores to draft).
router.get("/revisions", can("view"), controller.listRevisions);
router.post(
  "/revisions/:revisionId/rollback",
  can("approve"),
  controller.rollbackRevision,
);

module.exports = router;
