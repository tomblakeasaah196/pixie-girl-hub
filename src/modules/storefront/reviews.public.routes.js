/**
 * Storefront product reviews - PUBLIC routes.
 * Mounted under /api/public/storefront (with customerAuthOptional upstream).
 *
 *   GET  /products/:slug/reviews   -> approved reviews + rating summary
 *   POST /reviews                  -> submit a review (signed-in customer)
 *   POST /reviews/photos           -> upload review photos (signed-in customer)
 *
 * Brand resolved from X-Brand-Context / ?brand (same as the catalogue).
 */

"use strict";

const express = require("express");
const crypto = require("crypto");
const multer = require("multer");
const reviewsRepo = require("./reviews.repo");
const storefrontRepo = require("./storefront.repo");
const storage = require("../../services/storage.service");
const {
  compressUploadChecked,
} = require("../../services/media-compression.service");
const { VALID_BRANDS } = require("../../config/brands");
const { config } = require("../../config/env");
const { AppError } = require("../../utils/errors");

const router = express.Router();

// Max customer photos per review — mirrors the reviews.repo create() cap so the
// client, the upload endpoint and the DB write all agree.
const MAX_REVIEW_PHOTOS = 6;

// Raw per-photo ceiling before compression — a modern phone JPEG is routinely
// 8-18MB, so keep this generous; compression shrinks it well under the stored
// ceiling afterwards.
const MAX_PHOTO_MB = 20;

// Customer review photos: images only, a handful per request.
const reviewPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_MB * 1024 * 1024, files: MAX_REVIEW_PHOTOS },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\//.test(file.mimetype || "");
    cb(
      ok
        ? null
        : new AppError("UNSUPPORTED_PHOTO", "non-image upload", 415, {
            user_message: "Please upload image files only (JPG, PNG, WEBP or HEIC).",
          }),
      ok,
    );
  },
});

// multer's own errors (oversized file, too many files) arrive as MulterError,
// which the global handler doesn't recognise — map the common cases to clean
// AppErrors so the shopper is told exactly what went wrong.
function uploadReviewPhotos(req, res, next) {
  reviewPhotoUpload.array("photos", MAX_REVIEW_PHOTOS)(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE")
        return next(
          new AppError("PHOTO_TOO_LARGE", "photo exceeds size limit", 413, {
            user_message: `Each photo must be under ${MAX_PHOTO_MB}MB — try a smaller one.`,
          }),
        );
      if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE")
        return next(
          new AppError("TOO_MANY_PHOTOS", "too many photos", 422, {
            user_message: `You can add up to ${MAX_REVIEW_PHOTOS} photos.`,
          }),
        );
      return next(
        new AppError("UPLOAD_FAILED", err.code || "multer error", 400, {
          user_message: "That photo couldn't be uploaded — please try again.",
        }),
      );
    }
    next(err);
  });
}

function brandHint(req) {
  const h = req.brand || req.headers["x-brand-context"] || req.query.brand;
  return VALID_BRANDS.has(h) ? h : "pixiegirl";
}

// Reject guests up front (before multer buffers any file) — customerAuthOptional
// upstream has already resolved req.customer from the Bearer token.
function requireCustomer(req, _res, next) {
  if (!req.customer || !req.customer.contact_id)
    return next(
      new AppError("AUTH_REQUIRED", "Please sign in to continue.", 401),
    );
  next();
}

// Only accept photo URLs that we ourselves minted (relative /media path or the
// configured CDN), so a review can't smuggle in an arbitrary off-site/`javascript:`
// image reference. Returns the cleaned, de-duplicated, capped list.
function sanitizePhotoUrls(input) {
  if (!Array.isArray(input)) return [];
  const cdn = (config.CDN_BASE_URL || "").replace(/\/+$/, "");
  const seen = new Set();
  const out = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const url = raw.trim();
    const ok =
      url.startsWith("/media/") || (cdn && url.startsWith(`${cdn}/`));
    if (ok && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
    if (out.length >= MAX_REVIEW_PHOTOS) break;
  }
  return out;
}

async function resolveProductId(brand, slug) {
  const styled_id = await storefrontRepo.getLiveStyledIdBySlug({ brand, slug });
  if (!styled_id)
    throw new AppError("NOT_FOUND", "That product could not be found.", 404);
  return styled_id;
}

// GET approved reviews + summary for a product.
router.get("/products/:slug/reviews", async (req, res) => {
  const brand = brandHint(req);
  const product_id = await resolveProductId(brand, req.params.slug);
  const [reviews, summary] = await Promise.all([
    reviewsRepo.listApproved({ brand, product_id }),
    reviewsRepo.summary({ brand, product_id }),
  ]);
  res.json({ data: { summary, reviews } });
});

// POST a review (signed-in customers only; lands in moderation).
router.post("/reviews", requireCustomer, async (req, res) => {
  const brand = brandHint(req);
  const { product_slug, rating, title, body, photo_urls } = req.body || {};
  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5)
    throw new AppError("INVALID_RATING", "Rating must be 1 to 5 stars.", 422);
  if (!product_slug)
    throw new AppError("MISSING_PRODUCT", "Which product is this review for?", 422);

  const product_id = await resolveProductId(brand, product_slug);
  const created = await reviewsRepo.create({
    brand,
    product_id,
    contact_id: req.customer.contact_id,
    rating: r,
    title,
    body,
    photo_urls: sanitizePhotoUrls(photo_urls),
    submitter_ip: req.ip,
  });
  res.status(201).json({
    data: {
      review_id: created.review_id,
      status: created.status,
      message: "Thanks! Your review will appear once approved.",
    },
  });
});

// Upload customer review photos (signed-in customers only). Returns the stored
// public URLs; the client then submits them with POST /reviews. Kept separate
// from the review write so the shopper sees thumbnails before committing, and
// so a slow multi-photo upload doesn't block the (tiny) review JSON.
router.post(
  "/reviews/photos",
  requireCustomer,
  uploadReviewPhotos,
  async (req, res) => {
    const brand = brandHint(req);
    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0)
      throw new AppError("NO_FILE", "Choose at least one photo to upload.", 422);

    const photos = [];
    for (const file of files) {
      // Compress/normalise (HEIC→JPEG, downscale, size-gate) before storing.
      const shrunk = await compressUploadChecked(file);
      // Key mirrors the Studio upload convention: `<category>/<brand>/<hash>.ext`
      // (no leading `media/` — express already mounts /media → storage root).
      const ext =
        String(shrunk.filename || file.originalname || "")
          .split(".")
          .pop()
          ?.toLowerCase()
          .replace(/[^a-z0-9]/g, "")
          .slice(0, 5) || "jpg";
      const key = `reviews/${brand}/${crypto.randomBytes(16).toString("hex")}.${ext}`;
      const stored = await storage.put(shrunk.buffer, {
        key,
        contentType: shrunk.mime_type,
      });
      photos.push({ url: stored.public_url });
    }

    res.status(201).json({ data: { photos } });
  },
);

module.exports = router;
