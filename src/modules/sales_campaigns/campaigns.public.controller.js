/**
 * Sales Campaigns — PUBLIC controller (no auth).
 *
 * Brand is resolved (in priority order) by:
 *   1. hostBrandResolverMiddleware — Host header → business_config.sales_subdomain
 *   2. X-Brand-Context header / ?brand= query — explicit hint (e.g. admin preview)
 *
 * The service refuses to fall back to a cross-brand slug scan: forcing a single
 * brand keeps the public endpoint O(1) per request and removes a timing oracle
 * that would let attackers enumerate slugs across brands.
 */

"use strict";

const publicService = require("./campaigns.public.service");

function brandHint(req) {
  const h = req.headers["x-brand-context"] || req.query.brand;
  return typeof h === "string" ? h.toLowerCase().trim() : undefined;
}

async function index(req, res) {
  const data = await publicService.getIndex({
    brand: req.brand,
    brandHint: brandHint(req),
  });
  res.json({ data });
}

async function landing(req, res) {
  const data = await publicService.getLanding({
    slug: req.params.slug,
    brand: req.brand,
    brandHint: brandHint(req),
  });
  res.json({ data });
}

async function stock(req, res) {
  const data = await publicService.getStock({
    slug: req.params.slug,
    brand: req.brand,
    brandHint: brandHint(req),
  });
  res.json({ data });
}

async function signup(req, res) {
  const result = await publicService.signup({
    slug: req.params.slug,
    brand: req.brand,
    brandHint: brandHint(req),
    input: req.body,
    ip: req.ip,
    user_agent: req.headers["user-agent"],
  });
  res.status(result.already_signed_up ? 200 : 201).json({ data: result });
}

async function checkout(req, res) {
  const result = await publicService.checkout({
    slug: req.params.slug,
    brand: req.brand,
    brandHint: brandHint(req),
    input: req.body,
    ip: req.ip,
    user_agent: req.headers["user-agent"],
  });
  res.status(201).json({ data: result });
}

async function quote(req, res) {
  const data = await publicService.quoteCart({
    slug: req.params.slug,
    brand: req.brand,
    brandHint: brandHint(req),
    input: req.body,
  });
  res.json({ data });
}

async function couponPreview(req, res) {
  const data = await publicService.previewCoupon({
    slug: req.params.slug,
    brand: req.brand,
    brandHint: brandHint(req),
    input: req.body,
  });
  res.json({ data });
}

async function orderStatus(req, res) {
  const data = await publicService.getOrderStatus({
    slug: req.params.slug,
    brand: req.brand,
    brandHint: brandHint(req),
    orderId: req.params.orderId,
  });
  res.json({ data });
}

/** Public product detail for the landing-page product modal — gallery,
 *  long description, variants (size × lace with price premiums), and the
 *  brand's head-size guide + video so the buyer never leaves the page. */
async function productDetail(req, res) {
  const data = await publicService.getProductDetail({
    slug: req.params.slug,
    brand: req.brand,
    brandHint: brandHint(req),
    styled_id: req.params.styledId,
  });
  res.json({ data });
}

module.exports = {
  index,
  landing,
  stock,
  signup,
  checkout,
  quote,
  couponPreview,
  orderStatus,
  productDetail,
};
