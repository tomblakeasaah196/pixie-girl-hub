/**
 * Platform Settings — service.
 *
 * Wraps the repo with the cross-cutting concerns that aren't its
 * job: transaction + audit on every write, and a Socket.IO
 * broadcast on appearance changes so every open browser re-themes
 * the moment the admin clicks Save (no F5 needed).
 */

"use strict";

const crypto = require("crypto");
const repo = require("./platform-settings.repo");
const storage = require("../../services/storage.service");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { logger } = require("../../config/logger");
const { AppError } = require("../../utils/errors");

// Branding images (logos, login background) are public assets served from
// a dedicated /media/branding prefix. SVG is excluded — it can carry script
// and these files are reachable unauthenticated.
const IMAGE_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

// Sensible fallbacks used when the platform_settings row carries no
// region_messages (e.g. a fresh DB before migration 000209 seeds it).
const GEO_DEFAULT = {
  welcome: "Welcome",
  note: "Two brands, one vision — always forward.",
};

/**
 * True for IPs we should never geolocate: missing, loopback, or RFC1918
 * private ranges (a dev box / behind NAT). Cheap string checks — good
 * enough for the gate; the provider call is the slow part we're avoiding.
 */
function isPrivateOrLocalIp(ip) {
  if (!ip || typeof ip !== "string") return true;
  // Express may hand us an IPv4-mapped IPv6 address (::ffff:10.0.0.1).
  const addr = ip.replace(/^::ffff:/i, "").trim();
  if (addr === "::1" || addr === "127.0.0.1") return true;
  if (/^127\./.test(addr)) return true;
  if (/^10\./.test(addr)) return true;
  if (/^192\.168\./.test(addr)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(addr)) return true;
  if (/^(fe80:|fc00:|fd00:)/i.test(addr)) return true; // link-local / ULA
  return false;
}

/**
 * Best-effort IP geolocation via ipwho.is (free, no key). Aborts after
 * ~1500ms and swallows every error — the caller falls back to the
 * default welcome. Returns the normalised location or null.
 */
async function lookupGeo(ip) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const resp = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      signal: controller.signal,
    });
    if (!resp.ok) return null;
    const body = await resp.json();
    if (!body || body.success === false) return null;
    return {
      city: body.city || null,
      country: body.country || null,
      country_code: body.country_code || null,
      continent_code: body.continent_code || null,
    };
  } catch (err) {
    logger.warn({ err: err.message }, "geo-welcome lookup failed");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function emitBrandingUpdated(payload) {
  // Socket.IO is wired late in app boot; if a write lands during a
  // cold start (e.g. seed migration replay in tests) we simply skip
  // the broadcast rather than crash the request.
  try {
    const { getIo } = require("../../config/socket");
    getIo().emit("branding:updated", payload);
  } catch (_) {
    /* socket not initialised yet — non-fatal */
  }
}

async function getPlatformSettings() {
  return repo.getPlatformSettings({ client: null });
}

async function updatePlatformSettings({ user, request_id, input }) {
  return transaction(async (client) => {
    const before = await repo.getPlatformSettings({ client });
    const after = await repo.updatePlatformSettings({
      client,
      patch: input,
      user_id: user?.user_id,
    });
    await audit({
      // Platform-level, not tied to any one brand — '*' is the
      // canonical "all brands" marker the audit log understands.
      business: "*",
      user_id: user?.user_id,
      action_key: "platform_settings.update",
      target_type: "platform_settings",
      target_id: after?.settings_id || null,
      metadata: { fields: Object.keys(input) },
      request_id,
    });
    emitBrandingUpdated({ scope: "platform", updated_at: after?.updated_at });
    return after;
  });
}

async function listFonts() {
  return repo.listFonts({ client: null, activeOnly: true });
}

async function getPublicBranding() {
  return repo.getPublicBranding({ client: null });
}

/**
 * Per-IP geo welcome for the login page. Resolves the client's continent
 * and returns the matching region message from login_config.region_messages
 * (falling back to the `default` entry, then to GEO_DEFAULT). Always
 * resolves with a 200-shaped payload; never throws.
 */
async function getGeoWelcome({ ip }) {
  const settings = await repo.getPlatformSettings({ client: null });
  const regions = settings?.login_config?.region_messages || {};
  const fallback = regions.default || GEO_DEFAULT;

  if (isPrivateOrLocalIp(ip)) {
    return { location: null, welcome: fallback.welcome, note: fallback.note };
  }

  const location = await lookupGeo(ip);
  if (!location) {
    return { location: null, welcome: fallback.welcome, note: fallback.note };
  }

  const msg = regions[location.continent_code] || fallback;
  return {
    location,
    welcome: msg.welcome || fallback.welcome,
    note: msg.note || fallback.note,
  };
}

/**
 * Store an uploaded branding image (logo / favicon / login background) and
 * return its public URL. Validated to a small raster allow-list and written
 * under the public `branding/` prefix. Admin-gated at the route.
 */
async function uploadBrandingImage({ file, user }) {
  if (!file || !file.buffer)
    throw new AppError("NO_FILE", "An image file is required", 422);
  const ext = IMAGE_EXT[file.mimetype];
  if (!ext)
    throw new AppError(
      "UNSUPPORTED_IMAGE",
      "Image must be PNG, JPEG, WEBP or GIF",
      422,
    );
  const key = `branding/${crypto.randomBytes(16).toString("hex")}.${ext}`;
  const stored = await storage.put(file.buffer, {
    key,
    contentType: file.mimetype,
  });
  await audit({
    business: "*",
    user_id: user?.user_id,
    action_key: "platform_settings.upload_image",
    target_type: "branding_image",
    target_id: stored.key,
    metadata: { size: stored.size, content_type: file.mimetype },
  });
  return { url: stored.public_url };
}

module.exports = {
  getPlatformSettings,
  updatePlatformSettings,
  listFonts,
  getPublicBranding,
  getGeoWelcome,
  uploadBrandingImage,
  emitBrandingUpdated,
};
