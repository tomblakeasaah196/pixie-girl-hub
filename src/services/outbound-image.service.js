/**
 * Outbound image compatibility for the Meta messaging channels.
 *
 * WhatsApp Cloud API accepts ONLY image/jpeg + image/png for `image`
 * messages, and Instagram DM attachments accept jpeg/png/gif. Anything
 * else — most notably WebP — is rejected by Meta with an opaque media
 * upload error. That is exactly why bundle shares failed on every
 * channel: bundle collage covers are generated as WebP
 * (services/collage.service.js), and operator-uploaded WebP catalogue
 * photos hit the same wall, while ordinary JPEG product photos sailed
 * through.
 *
 * Two entry points, one per channel model:
 *   • ensureWhatsAppImage({ buffer, mime })   — WhatsApp uploads BYTES to
 *     Meta, so we just transcode the buffer to JPEG in memory when needed.
 *   • ensureInstagramImageUrl(urlOrKey)       — Instagram only takes a
 *     URL that Meta fetches itself, so an incompatible image is
 *     transcoded, re-hosted next to the original in storage (cached —
 *     the derived key is deterministic), and the new absolute URL
 *     returned.
 *
 * Both are defensive: on any failure the original input is returned so
 * behaviour is never worse than before the guard existed.
 */

"use strict";

const crypto = require("crypto");
const sharp = require("sharp");
const storage = require("./storage.service");
const { config } = require("../config/env");
const { logger } = require("../config/logger");

// sharp `metadata().format` names, per channel.
const WHATSAPP_OK = new Set(["jpeg", "png"]);
const INSTAGRAM_OK = new Set(["jpeg", "png", "gif"]);

const JPEG_QUALITY = 90;

/** sharp format name for a buffer, or null when it can't be decoded. */
async function sniffFormat(buffer) {
  try {
    const meta = await sharp(buffer).metadata();
    return meta.format || null;
  } catch {
    return null;
  }
}

/** Transcode any decodable image to a Meta-safe JPEG (alpha → white). */
async function toJpegBuffer(buffer) {
  return sharp(buffer)
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

/** Swap/append a .jpg extension so Meta's filename hint matches the bytes. */
function jpegFilename(name) {
  const base = String(name || "image").replace(/\.[A-Za-z0-9]{2,5}$/, "");
  return `${base}.jpg`;
}

/**
 * Make image bytes WhatsApp-uploadable. Returns
 * { buffer, mime, filename, converted } — unchanged input when the format
 * is already accepted or can't be decoded (let Meta report the real error).
 */
async function ensureWhatsAppImage({ buffer, mime, filename }) {
  const format = await sniffFormat(buffer);
  if (!format || WHATSAPP_OK.has(format)) {
    return { buffer, mime, filename, converted: false };
  }
  try {
    const out = await toJpegBuffer(buffer);
    logger.info(
      { from_format: format, bytes_in: buffer.length, bytes_out: out.length },
      "outbound-image: transcoded to JPEG for WhatsApp",
    );
    return {
      buffer: out,
      mime: "image/jpeg",
      filename: jpegFilename(filename),
      converted: true,
    };
  } catch (err) {
    logger.warn(
      { err: err.message, format },
      "outbound-image: WhatsApp transcode failed — sending original bytes",
    );
    return { buffer, mime, filename, converted: false };
  }
}

/**
 * Resolve the bytes + (when local) storage key behind a media reference —
 * a bare storage key, a relative `/media/<key>` path, our own CDN URL, or
 * a genuinely external absolute URL. Mirrors collage.service's resolver.
 */
async function loadImageRef(urlOrKey) {
  const s = String(urlOrKey || "");
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    if (config.CDN_BASE_URL && s.startsWith(`${config.CDN_BASE_URL}/`)) {
      const key = s.slice(config.CDN_BASE_URL.length + 1);
      return { buffer: await storage.get(key), key };
    }
    if (config.ADMIN_BASE_URL) {
      const base = `${config.ADMIN_BASE_URL.replace(/\/+$/, "")}/media/`;
      if (s.startsWith(base)) {
        const key = s.slice(base.length);
        return { buffer: await storage.get(key), key };
      }
    }
    const res = await fetch(s);
    if (!res.ok) return null;
    return { buffer: Buffer.from(await res.arrayBuffer()), key: null };
  }
  const key = s.replace(/^\/?media\//, "").replace(/^\/+/, "");
  return { buffer: await storage.get(key), key };
}

/**
 * Make an image URL Instagram-sendable. Accepted formats pass through
 * unchanged; anything else is transcoded to JPEG, stored under a
 * deterministic derived key (so repeat shares reuse the cached copy), and
 * the derived copy's absolute URL is returned. Falls back to the original
 * URL on any failure.
 */
async function ensureInstagramImageUrl(urlOrKey) {
  if (!urlOrKey) return urlOrKey;
  try {
    // Cheap short-circuit: an extension Meta already accepts needs no fetch.
    const path = String(urlOrKey).split(/[?#]/)[0].toLowerCase();
    if (/\.(jpe?g|png|gif)$/.test(path)) return urlOrKey;

    const ref = await loadImageRef(urlOrKey);
    if (!ref || !ref.buffer) return urlOrKey;
    const format = await sniffFormat(ref.buffer);
    if (!format || INSTAGRAM_OK.has(format)) return urlOrKey;

    const derivedKey = ref.key
      ? `${ref.key}.ig.jpg`
      : `ig-transcode/${crypto.createHash("sha1").update(String(urlOrKey)).digest("hex")}.jpg`;

    // Cached from an earlier share? Reuse it.
    let cached = null;
    try {
      cached = await storage.get(derivedKey);
    } catch {
      cached = null;
    }
    if (!cached) {
      const out = await toJpegBuffer(ref.buffer);
      await storage.put(out, { key: derivedKey, contentType: "image/jpeg" });
      logger.info(
        { from_format: format, key: derivedKey },
        "outbound-image: transcoded to JPEG for Instagram",
      );
    }
    return storage.absoluteUrl(derivedKey) || urlOrKey;
  } catch (err) {
    logger.warn(
      { err: err.message, urlOrKey: String(urlOrKey).slice(0, 200) },
      "outbound-image: Instagram transcode failed — sending original URL",
    );
    return urlOrKey;
  }
}

module.exports = {
  ensureWhatsAppImage,
  ensureInstagramImageUrl,
  // exported for unit tests
  sniffFormat,
  toJpegBuffer,
  jpegFilename,
};
