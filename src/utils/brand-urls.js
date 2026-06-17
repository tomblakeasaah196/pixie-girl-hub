/**
 * Per-brand public URL helpers.
 *
 * Replaces the single `STOREFRONT_BASE_URL` env var pattern with a
 * lookup on `business_config.storefront_domain` so each brand can
 * have its own customer-facing domain (e.g. pixiegirlglobal.com and
 * thefaitlynbrand.com).
 *
 * Resolution order:
 *   1. business_config.storefront_domain  (preferred — CEO-editable)
 *   2. STOREFRONT_BASE_URL                (legacy env fallback)
 *   3. ADMIN_BASE_URL                     (dev fallback so links still
 *                                          resolve when storefront isn't
 *                                          configured yet)
 *   4. '' (relative path)
 *
 * Returned URLs ARE NOT trailing-slash-terminated, so callers append
 * paths like `/welcome/{token}` directly.
 *
 * Domain hygiene: `storefront_domain` may be stored as 'pixiegirlglobal.com'
 * (no scheme), 'https://pixiegirlglobal.com', or 'https://pixiegirlglobal.com/'.
 * The helper normalises to `https://<host>`. http:// is preserved when
 * present (so localhost dev still works).
 */

"use strict";

const { query } = require("../config/database");
const { config } = require("../config/env");
const { logger } = require("../config/logger");

// In-memory cache: one row per brand, refreshed on cache-miss or after
// `CACHE_TTL_MS`. Keeps a tight hot path because every outbound
// notification calls this — we don't want a DB round-trip per send.
const cache = new Map();
const CACHE_TTL_MS = 60_000;

function normaliseUrl(raw) {
  if (!raw) return "";
  let url = String(raw).trim();
  if (!url) return "";
  // Prepend https:// when missing, preserve http:// for localhost.
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, ""); // strip trailing slashes
}

async function loadBrandUrls(brand) {
  try {
    const { rows } = await query(
      `SELECT storefront_domain, support_email, support_email_display_name
         FROM shared.business_config WHERE business_key = $1`,
      [brand],
    );
    return rows[0] || null;
  } catch (err) {
    logger.warn(
      { err: err.message, brand },
      "brand-urls: business_config lookup failed",
    );
    return null;
  }
}

async function getBrandConfig(brand) {
  if (!brand) return null;
  const now = Date.now();
  const cached = cache.get(brand);
  if (cached && cached.expires_at > now) return cached.row;
  const row = await loadBrandUrls(brand);
  cache.set(brand, { row, expires_at: now + CACHE_TTL_MS });
  return row;
}

/**
 * Returns the base public URL for a brand (no trailing slash).
 * Callers append the path.
 */
async function publicBaseUrl(brand) {
  const row = await getBrandConfig(brand);
  return (
    normaliseUrl(row && row.storefront_domain) ||
    normaliseUrl(config.STOREFRONT_BASE_URL) ||
    normaliseUrl(config.ADMIN_BASE_URL) ||
    ""
  );
}

/**
 * `${publicBaseUrl}/welcome/{token}` for the Online QR customer form.
 */
async function welcomeUrl(brand, token) {
  const base = await publicBaseUrl(brand);
  // The /welcome route is keyed by business + token because the same
  // public app may serve multiple brands at the same host.
  return base
    ? `${base}/welcome/${brand}/${token}`
    : `/welcome/${brand}/${token}`;
}

/**
 * `${publicBaseUrl}/order/capture/{token}` for a pre-filled order
 * capture link. The consumer page decodes the signed JWT and pre-fills
 * the cart.
 */
async function orderCaptureUrl(brand, token) {
  const base = await publicBaseUrl(brand);
  return base
    ? `${base}/order/capture/${token}`
    : `/order/capture/${token}`;
}

/**
 * `${publicBaseUrl}/pay/{token}` — kept identical to the pre-existing
 * layaway pay-link URL so the smartcomm subscriber can adopt this
 * helper without changing customer-facing copy.
 */
async function payLinkUrl(brand, token) {
  if (!token) return "";
  const base = await publicBaseUrl(brand);
  return base ? `${base}/pay/${token}` : `/pay/${token}`;
}

/**
 * Returns the support email + display name for a brand, with the
 * brand's display_name as the fallback display label. Used by email
 * dispatch + receipt rendering.
 */
async function supportContact(brand) {
  const row = await getBrandConfig(brand);
  if (!row) return null;
  return {
    email: row.support_email || null,
    display_name: row.support_email_display_name || null,
  };
}

/** Invalidates the cache (used by Business Setup save). */
function invalidate(brand) {
  if (brand) cache.delete(brand);
  else cache.clear();
}

module.exports = {
  publicBaseUrl,
  welcomeUrl,
  orderCaptureUrl,
  payLinkUrl,
  supportContact,
  invalidate,
};
