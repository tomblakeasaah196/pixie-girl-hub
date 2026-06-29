/**
 * Storefront product reviews - PUBLIC routes.
 * Mounted under /api/public/storefront (with customerAuthOptional upstream).
 *
 *   GET  /products/:slug/reviews   -> approved reviews + rating summary
 *   POST /reviews                  -> submit a review (signed-in customer)
 *
 * Brand resolved from X-Brand-Context / ?brand (same as the catalogue).
 */

"use strict";

const express = require("express");
const reviewsRepo = require("./reviews.repo");
const storefrontRepo = require("./storefront.repo");
const { VALID_BRANDS } = require("../../config/brands");
const { AppError } = require("../../utils/errors");

const router = express.Router();

function brandHint(req) {
  const h = req.brand || req.headers["x-brand-context"] || req.query.brand;
  return VALID_BRANDS.has(h) ? h : "pixiegirl";
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
router.post("/reviews", async (req, res) => {
  if (!req.customer || !req.customer.contact_id)
    throw new AppError(
      "AUTH_REQUIRED",
      "Please sign in to leave a review.",
      401,
    );
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
    photo_urls,
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

module.exports = router;
