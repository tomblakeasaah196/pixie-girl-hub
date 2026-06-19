/**
 * Host → brand resolver (Sales Campaigns v2).
 *
 * Public landing pages run on per-brand subdomains configured via
 * Settings → Business Setup → Public Identity (column
 * `business_config.sales_subdomain`). The DNS layer routes the
 * subdomain to this Express app; this middleware reads the incoming
 * Host header, looks up the matching brand, and sets `req.brand` so
 * the public landing controller can serve the right campaign.
 *
 * Order of resolution:
 *   1. ?brand= query param           (developer override)
 *   2. X-Brand-Context header        (admin-side calls during preview)
 *   3. Host header → business_config.sales_subdomain  (production)
 *   4. business_config.storefront_domain               (back-compat)
 *
 * If no brand resolves, the middleware does NOT throw — the public
 * landing controller will fall back to scanning across known brands by
 * slug (an existing safety net in campaigns.public.service). A 404 is
 * still possible — the caller decides what to render.
 */

"use strict";

const { query } = require("../config/database");
const { VALID_BRANDS } = require("../config/brands");

let cachedHostMap = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60 * 1000; // 60s — small TTL keeps onboarding lag-free.

async function loadHostMap() {
  const now = Date.now();
  if (cachedHostMap && now - cacheLoadedAt < CACHE_TTL_MS) return cachedHostMap;
  const { rows } = await query(
    `SELECT business_key, sales_subdomain, storefront_domain
       FROM shared.business_config
      WHERE is_active = true`,
  );
  const map = new Map();
  for (const r of rows) {
    if (r.sales_subdomain)
      map.set(r.sales_subdomain.toLowerCase(), r.business_key);
    if (r.storefront_domain)
      map.set(r.storefront_domain.toLowerCase(), r.business_key);
  }
  cachedHostMap = map;
  cacheLoadedAt = now;
  return map;
}

function invalidateHostMap() {
  cachedHostMap = null;
  cacheLoadedAt = 0;
}

async function hostBrandResolverMiddleware(req, _res, next) {
  try {
    const fromQuery = (req.query && req.query.brand) || null;
    const fromHeader = req.headers["x-brand-context"] || null;
    const candidate =
      (fromQuery && String(fromQuery).toLowerCase().trim()) ||
      (fromHeader && String(fromHeader).toLowerCase().trim()) ||
      null;
    if (candidate && VALID_BRANDS.has(candidate)) {
      req.brand = candidate;
      return next();
    }

    const rawHost = (req.hostname || req.headers.host || "")
      .toLowerCase()
      .split(":")[0];
    if (!rawHost) return next();
    const map = await loadHostMap();
    const brand = map.get(rawHost);
    if (brand && VALID_BRANDS.has(brand)) {
      req.brand = brand;
    }
    return next();
  } catch {
    // Resolver never blocks — the controller handles unbranded fallback.
    return next();
  }
}

module.exports = { hostBrandResolverMiddleware, invalidateHostMap };
