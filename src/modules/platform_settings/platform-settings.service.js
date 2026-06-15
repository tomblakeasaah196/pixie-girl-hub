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
const sharp = require("sharp");
const repo = require("./platform-settings.repo");
const storage = require("../../services/storage.service");
const iconPipeline = require("../../services/icon-pipeline.service");
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
 * Dynamic PWA manifest — built from platform_settings so the installed app
 * carries the live product name, theme colour, and icons. The login-page
 * shell links this at /api/public/manifest.webmanifest.
 *
 * Icons: the logo-upload pipeline stores favicon.ico + icon-192/512 +
 * maskable as siblings under one hashed folder, so when favicon_url points
 * at one of those we derive the PNG entries from it. The static
 * /favicon.svg is always included as a scalable fallback.
 */
async function getWebManifest() {
  const p = await repo.getPlatformSettings({ client: null });
  const name = p?.product_name || "Pixie Girl Hub";
  const themeColour =
    rgbToHex(p?.theme?.dark?.bg) ?? rgbToHex(p?.theme?.light?.bg) ?? "#0f0809";

  const icons = [
    { src: "/favicon.svg", type: "image/svg+xml", sizes: "any", purpose: "any" },
  ];
  const favicon = p?.favicon_url || null;
  // Derive the generated PNG siblings when the favicon came from the pipeline.
  const m = favicon && /^(.*)\/favicon\.ico$/.exec(favicon);
  if (m) {
    const base = m[1];
    icons.push(
      { src: `${base}/icon-192.png`, type: "image/png", sizes: "192x192", purpose: "any" },
      { src: `${base}/icon-512.png`, type: "image/png", sizes: "512x512", purpose: "any" },
      { src: `${base}/maskable-512.png`, type: "image/png", sizes: "512x512", purpose: "maskable" },
    );
  }

  return {
    name,
    short_name: name.length > 12 ? name.split(" ")[0] : name,
    description:
      p?.tagline || "One command center for Pixie Girl Global and Faitlyn Hair.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: themeColour,
    theme_color: themeColour,
    icons,
  };
}

/** "R G B" triplet (as stored in theme tokens) → #rrggbb, or null. */
function rgbToHex(triplet) {
  if (typeof triplet !== "string") return null;
  const m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/.exec(triplet.trim());
  if (!m) return null;
  const h = (n) => Math.min(255, Number(n)).toString(16).padStart(2, "0");
  return `#${h(m[1])}${h(m[2])}${h(m[3])}`;
}

/**
 * Per-IP geo welcome for the login page. Resolves the client's continent
 * and returns the matching region message from login_config.region_messages
 * (falling back to the `default` entry, then to GEO_DEFAULT). Always
 * resolves with a 200-shaped payload; never throws.
 *
 * `override` is a development-only preview hook (the controller only ever
 * populates it when NODE_ENV !== "production") so the geo greeting can be
 * exercised from localhost, where the real client IP is loopback:
 *   • { continent: "EU", country? }  → forces that region's copy, no lookup.
 *   • { ip: "8.8.8.8" }              → does a real lookup of that address.
 */
async function getGeoWelcome({ ip, override } = {}) {
  const settings = await repo.getPlatformSettings({ client: null });
  const regions = settings?.login_config?.region_messages || {};
  const fallback = regions.default || GEO_DEFAULT;
  const pick = (loc) => {
    const msg = (loc && regions[loc.continent_code]) || fallback;
    return {
      location: loc,
      welcome: msg.welcome || fallback.welcome,
      note: msg.note || fallback.note,
    };
  };

  // Dev preview: force a continent's copy without any network lookup.
  if (override?.continent) {
    return pick({
      city: override.city || null,
      country: override.country || null,
      country_code: null,
      continent_code: override.continent,
    });
  }

  // Dev preview: real lookup of a supplied public IP (bypasses the
  // loopback short-circuit). Otherwise honour the loopback skip.
  const lookupIp = override?.ip || ip;
  if (!override?.ip && isPrivateOrLocalIp(ip)) {
    return pick(null);
  }

  const location = await lookupGeo(lookupIp);
  return pick(location);
}

/**
 * Store an uploaded branding image (logo / favicon / login background) and
 * return its public URL. Validated to a small raster allow-list and written
 * under the public `branding/` prefix. Admin-gated at the route.
 *
 * When `purpose === "logo"` the image is run through the icon pipeline:
 * the background is made transparent (alpha-aware; best-effort key-out for
 * opaque sources, with a surfaced warning) and a full favicon + PWA icon
 * set is generated and stored alongside. The response then also carries
 * `favicon_url`, `icons`, and `transparency` so the UI can auto-fill the
 * favicon field and warn the admin.
 */
// Max dimension for branding images (keeps retina quality, trims excess).
const MAX_DIM = 2048;
const WEBP_QUALITY = 85;

async function compressBrandingImage(buffer, mimetype) {
  const img = sharp(buffer);
  const meta = await img.metadata();
  const needsResize =
    (meta.width && meta.width > MAX_DIM) ||
    (meta.height && meta.height > MAX_DIM);
  const pipeline = needsResize
    ? img.resize(MAX_DIM, MAX_DIM, { fit: "inside", withoutEnlargement: true })
    : img;

  // GIFs may be animated — keep them as-is (sharp can't compress animated GIFs
  // without losing frames), just resize if oversized.
  if (mimetype === "image/gif") {
    return { buffer: await pipeline.toBuffer(), ext: "gif", mime: "image/gif" };
  }
  // Everything else → high-quality WEBP (typically 60-80% smaller than PNG,
  // 30-50% smaller than JPEG at equivalent perceptual quality).
  const out = await pipeline
    .webp({ quality: WEBP_QUALITY, effort: 4 })
    .toBuffer();
  return { buffer: out, ext: "webp", mime: "image/webp" };
}

async function uploadBrandingImage({ file, user, purpose }) {
  if (!file || !file.buffer)
    throw new AppError("NO_FILE", "An image file is required", 422);
  const ext = IMAGE_EXT[file.mimetype];
  if (!ext)
    throw new AppError(
      "UNSUPPORTED_IMAGE",
      "Image must be PNG, JPEG, WEBP or GIF",
      422,
    );

  if (purpose === "logo") return uploadBrandingLogo({ file, user });

  const compressed = await compressBrandingImage(file.buffer, file.mimetype);
  const key = `branding/${crypto.randomBytes(16).toString("hex")}.${compressed.ext}`;
  const stored = await storage.put(compressed.buffer, {
    key,
    contentType: compressed.mime,
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

/**
 * Logo upload + icon generation. Produces a transparent display logo plus
 * favicon.ico / favicon-64 / PWA (192, 512, maskable) / apple-touch icons,
 * all written under one hashed folder so they're easy to evict together.
 */
async function uploadBrandingLogo({ file, user }) {
  let set;
  try {
    set = await iconPipeline.generateIconSet(file.buffer, { allowKeyOut: true });
  } catch (err) {
    logger.error({ err }, "icon pipeline failed");
    throw new AppError(
      "IMAGE_PROCESSING_FAILED",
      "Could not process that image. Try a different file.",
      422,
    );
  }

  const dir = `branding/${crypto.randomBytes(16).toString("hex")}`;
  const png = "image/png";
  const assets = [
    ["logo", `${dir}/logo.png`, set.logo, png],
    ["favicon", `${dir}/favicon.ico`, set.faviconIco, "image/x-icon"],
    ["favicon64", `${dir}/favicon-64.png`, set.favicon64, png],
    ["icon192", `${dir}/icon-192.png`, set.icon192, png],
    ["icon512", `${dir}/icon-512.png`, set.icon512, png],
    ["maskable512", `${dir}/maskable-512.png`, set.maskable512, png],
    ["apple180", `${dir}/apple-touch-icon.png`, set.apple180, png],
  ];

  const urls = {};
  let totalSize = 0;
  for (const [name, key, buffer, contentType] of assets) {
    const stored = await storage.put(buffer, { key, contentType });
    urls[name] = stored.public_url;
    totalSize += stored.size;
  }

  await audit({
    business: "*",
    user_id: user?.user_id,
    action_key: "platform_settings.upload_logo",
    target_type: "branding_image",
    target_id: dir,
    metadata: {
      size: totalSize,
      source_content_type: file.mimetype,
      transparency: set.transparency,
    },
  });

  return {
    url: urls.logo,
    favicon_url: urls.favicon,
    icons: {
      favicon: urls.favicon,
      favicon64: urls.favicon64,
      icon192: urls.icon192,
      icon512: urls.icon512,
      maskable512: urls.maskable512,
      apple: urls.apple180,
    },
    transparency: set.transparency,
  };
}

module.exports = {
  getPlatformSettings,
  updatePlatformSettings,
  listFonts,
  getPublicBranding,
  getWebManifest,
  getGeoWelcome,
  uploadBrandingImage,
  uploadBrandingLogo,
  emitBrandingUpdated,
};
