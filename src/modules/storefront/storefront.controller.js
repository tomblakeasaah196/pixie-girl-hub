/**
 * E-Commerce Storefront & Channel Sync (V2.2 §6.4) — HTTP controller.
 * All endpoints are public; brand resolves from the X-Brand-Context header
 * or ?brand (default pixiegirl).
 */

"use strict";

const service = require("./storefront.service");

const { VALID_BRANDS } = require("../../config/brands");
function brandHint(req) {
  // Authenticated requests carry req.brand (brand-context middleware);
  // public requests pass it via the X-Brand-Context header or ?brand.
  const h = req.brand || req.headers["x-brand-context"] || req.query.brand;
  return VALID_BRANDS.has(h) ? h : "pixiegirl";
}

// ── Catalogue ──────────────────────────────────────────────
async function listProducts(req, res) {
  res.json(
    await service.listProducts({
      brand: brandHint(req),
      filters: { category_slug: req.query.category, q: req.query.q },
      page: parseInt(req.query.page || "1", 10),
      page_size: Math.min(parseInt(req.query.page_size || "24", 10), 60),
    }),
  );
}

async function getProduct(req, res) {
  res.json({
    data: await service.getProduct({
      brand: brandHint(req),
      slug: req.params.slug,
    }),
  });
}

async function listCategories(req, res) {
  res.json({ data: await service.listCategories({ brand: brandHint(req) }) });
}

async function getCollection(req, res) {
  res.json({
    data: await service.getCollection({
      brand: brandHint(req),
      slug: req.params.slug,
    }),
  });
}

async function listShades(req, res) {
  res.json({ data: await service.listShades({ brand: brandHint(req) }) });
}

async function getShade(req, res) {
  res.json({
    data: await service.getShade({
      brand: brandHint(req),
      slug: req.params.slug,
    }),
  });
}

async function listCollections(req, res) {
  res.json({ data: await service.listCollections({ brand: brandHint(req) }) });
}

async function listBundles(req, res) {
  res.json({ data: await service.listBundles({ brand: brandHint(req) }) });
}

async function getBundle(req, res) {
  res.json({
    data: await service.getBundle({
      brand: brandHint(req),
      slug: req.params.slug,
    }),
  });
}

// Published Studio config for the SSR shell (theme tokens, nav, pages, popups).
// Optional ?path narrows to one page. The website hydrates the shell from this.
async function getSite(req, res) {
  res.json({
    data: await service.getSite({
      brand: brandHint(req),
      path: req.query.path || null,
    }),
  });
}

async function getContent(req, res) {
  res.json({
    data: await service.getContent({
      brand: brandHint(req),
      type: req.params.type,
      slug: req.params.slug,
    }),
  });
}

// ── Public Order Form ──────────────────────────────────────
async function submitOrderForm(req, res) {
  res.status(201).json({
    data: await service.submitOrderForm({
      brand: brandHint(req),
      input: req.body,
      request_id: req.request_id,
    }),
  });
}

// ── Analytics ──────────────────────────────────────────────
async function startSession(req, res) {
  res.status(201).json({
    data: await service.startSession({
      brand: brandHint(req),
      input: req.body,
      ip: req.ip,
    }),
  });
}

async function recordPageView(req, res) {
  res.status(201).json({
    data: await service.recordPageView({
      brand: brandHint(req),
      input: req.body,
    }),
  });
}

async function recordFunnelEvent(req, res) {
  res.status(201).json({
    data: await service.recordFunnelEvent({
      brand: brandHint(req),
      input: req.body,
    }),
  });
}

// ── Install Hub (public, resolved by tracking token) ───────
async function getInstallHub(req, res) {
  res.json({ data: await service.getInstallHub({ token: req.params.token }) });
}

module.exports = {
  listProducts,
  getProduct,
  listCategories,
  getCollection,
  listShades,
  getShade,
  listCollections,
  listBundles,
  getBundle,
  getSite,
  getContent,
  submitOrderForm,
  startSession,
  recordPageView,
  recordFunnelEvent,
  getInstallHub,
};
