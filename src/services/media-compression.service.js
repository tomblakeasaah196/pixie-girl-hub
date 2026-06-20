/**
 * Media compression (catalogue uploads).
 *
 * Images are re-encoded with sharp to keep top-notch visual quality while
 * trimming bytes: oversized images are downscaled to a sane max edge (never
 * upscaled), then re-encoded at high quality in their own format. If the
 * "compressed" result is somehow larger, or the type isn't a raster we
 * handle (SVG, GIF), the original buffer is returned untouched — compression
 * must never degrade or corrupt an upload.
 *
 * Video is handled separately by the FFmpeg processing queue (W-13); this
 * service is image-only by design.
 */

"use strict";

const sharp = require("sharp");
const { logger } = require("../config/logger");

// Longest-edge cap. Storefront galleries never need more than this, and it
// keeps a phone-camera 6000px shot from sitting in the DB/CDN at full size.
const MAX_EDGE = 2400;
// High enough that re-encode is visually lossless for product photography.
const QUALITY = 85;

const RASTER = new Set(["image/jpeg", "image/png", "image/webp"]);

function isCompressibleImage(mime) {
  return RASTER.has(String(mime || "").toLowerCase());
}

/**
 * Compress a raster image buffer, preserving its format and aspect ratio.
 * Returns { buffer, mime_type, compressed }. On any failure or non-raster
 * input, returns the original buffer with compressed:false.
 */
async function compressImage(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || !isCompressibleImage(mime)) {
    return { buffer, mime_type: mime, compressed: false };
  }
  try {
    const img = sharp(buffer, { failOn: "none" }).rotate(); // honour EXIF orientation
    const meta = await img.metadata();
    if (
      meta.width &&
      meta.height &&
      Math.max(meta.width, meta.height) > MAX_EDGE
    ) {
      img.resize({
        width: meta.width >= meta.height ? MAX_EDGE : undefined,
        height: meta.height > meta.width ? MAX_EDGE : undefined,
        withoutEnlargement: true,
      });
    }

    const fmt = String(mime).toLowerCase();
    let out;
    if (fmt === "image/png") {
      out = await img.png({ compressionLevel: 9, palette: true }).toBuffer();
    } else if (fmt === "image/webp") {
      out = await img.webp({ quality: QUALITY }).toBuffer();
    } else {
      out = await img.jpeg({ quality: QUALITY, mozjpeg: true }).toBuffer();
    }

    // Never hand back something larger than we received.
    if (out.length >= buffer.length) {
      return { buffer, mime_type: mime, compressed: false };
    }
    return { buffer: out, mime_type: mime, compressed: true };
  } catch (err) {
    logger.warn({ err: err.message }, "image compression skipped");
    return { buffer, mime_type: mime, compressed: false };
  }
}

module.exports = { compressImage, isCompressibleImage, MAX_EDGE, QUALITY };
