/**
 * Brand-context middleware (V2.2 §3 — entity isolation).
 *
 * Every API call after auth must specify which entity it operates on.
 * Resolved in order:
 *   1. X-Brand-Context header                          → primary signal from frontend
 *   2. URL path (/api/v1/{brand}/...)                  → fallback for direct access
 *   3. user.default_business_key                       → falls back to user's home brand
 *
 * After resolution:
 *   req.brand      = 'valid brands'
 *   req.brand_id   = the business_id (uuid)
 *
 * If the resolved brand is NOT in user.available_businesses, 403.
 * (CEO has all brands; other roles have one. Cross-brand views go through
 * dedicated endpoints under /api/v1/group/* that bypass this middleware.)
 *
 * RLS (R-1): the resolved brand + user are bound into the AsyncLocalStorage
 * request context for the rest of the request, so every `transaction()` opened
 * downstream sets `app.current_business` / `app.current_user_id` and the RLS
 * policies in migration 000200 actually filter. See config/database.js.
 */

"use strict";

const { AppError } = require("../utils/errors");
const businessConfigRepo = require("../modules/business_setup/business-config.repo");
const requestContext = require("../config/request-context");

const { VALID_BRANDS } = require("../config/brands");

async function brandContextMiddleware(req, _res, next) {
  if (!req.user) {
    throw new AppError("AUTH_REQUIRED", "Authentication required first", 401);
  }

  let brand =
    req.headers["x-brand-context"] ||
    req.params.brand ||
    req.user.default_business_key;

  brand = typeof brand === "string" ? brand.toLowerCase().trim() : null;

  if (!brand || !VALID_BRANDS.has(brand)) {
    throw new AppError(
      "BRAND_CONTEXT_REQUIRED",
      "Missing or invalid X-Brand-Context header (expected valid brand key)",
      400,
    );
  }

  // CEO has implicit access to both; everyone else must be granted.
  if (!req.user.is_ceo && !req.user.available_businesses.includes(brand)) {
    throw new AppError("BRAND_ACCESS_DENIED", `No access to ${brand}`, 403);
  }

  const business = await businessConfigRepo.findByKey(brand);
  if (!business) {
    throw new AppError(
      "BRAND_NOT_FOUND",
      `Brand config not found for ${brand}`,
      500,
    );
  }

  req.brand = brand;
  req.brand_id = business.business_id;
  req.brand_config = business;

  // Bind the brand + user for the rest of the request so downstream
  // transactions set the RLS/audit GUCs automatically (R-1). Wrapping the
  // next() call keeps the async continuation inside the ALS scope.
  return requestContext.run(
    { brand, userId: req.user.user_id || req.user.id || null },
    () => next(),
  );
}

module.exports = { brandContextMiddleware };
