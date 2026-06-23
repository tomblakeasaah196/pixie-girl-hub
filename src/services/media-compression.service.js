/**
 * Media compression (image uploads).
 *
 * Images are re-encoded with sharp to keep top-notch visual quality while
 * trimming bytes: oversized images are downscaled to a sane max edge (never
 * upscaled), then re-encoded at high quality in their own format. If the
 * "compressed" result is somehow larger, or the type isn't a raster we
 * handle (SVG, GIF), the original buffer is returned untouched — compression
 * must never degrade or corrupt an upload.
 *
 * HEIC/HEIF (the default iPhone camera format) is special: browsers can't
 * render it, and sharp's bundled libvips decodes only AVIF from the HEIF
 * family — not the HEVC-coded HEIC that phones produce. So we decode HEIC up
 * front with the pure-JS libheif (heic-convert), then hand the pixels to
 * sharp and emit a normal JPEG. The upshot: a user can drop a `.heic` photo
 * anywhere images are accepted and it lands as a compressed, viewable image.
 *
 * Video is handled separately by the FFmpeg processing queue (W-13); this
 * service is image-only by design.
 */

"use strict";

const path = require("path");
const sharp = require("sharp");
const { logger } = require("../config/logger");
const { AppError } = require("../utils/errors");

// Longest-edge cap. Storefront galleries never need more than this, and it
// keeps a phone-camera 6000px shot from sitting in the DB/CDN at full size.
const MAX_EDGE = 2400;
// High enough that re-encode is visually lossless for product photography.
const QUALITY = 85;

const RASTER = new Set(["image/jpeg", "image/png", "image/webp"]);

// HEIC/HEIF — accepted by mime, by extension (browsers often send an empty or
// generic mime for .heic), or by sniffing the ISO-BMFF "ftyp" major brand.
const HEIC_MIME = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);
const HEIC_EXT = new Set([".heic", ".heif"]);
// Major brands libheif can decode (mirrors heic-decode's own allow-list).
const HEIC_BRANDS = new Set(["mif1", "msf1", "heic", "heix", "hevc", "hevx"]);

function isCompressibleImage(mime) {
  return RASTER.has(String(mime || "").toLowerCase());
}

/** Sniff the first bytes for a HEIC/HEIF "ftyp" box with a libheif-decodable
 *  brand. Lets us catch `.heic` files the browser mislabels as octet-stream. */
function looksLikeHeic(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (buffer.toString("latin1", 4, 8) !== "ftyp") return false;
  const brand = buffer.toString("latin1", 8, 12).replace(/\0/g, " ").trim();
  return HEIC_BRANDS.has(brand);
}

/** True when this upload is a HEIC/HEIF image, by mime, extension or magic. */
function isHeic(mime, filename, buffer) {
  if (HEIC_MIME.has(String(mime || "").toLowerCase())) return true;
  if (filename && HEIC_EXT.has(path.extname(filename).toLowerCase())) {
    return true;
  }
  return looksLikeHeic(buffer);
}

/**
 * Decode a HEIC/HEIF buffer to a high-quality JPEG buffer via libheif (wasm).
 * Throws a clean AppError on failure — we must never persist a HEIC the rest
 * of the platform (and browsers) can't read.
 */
async function decodeHeicToJpeg(buffer) {
  try {
    // Lazy-require: only pull the wasm decoder when a HEIC actually arrives.
    const convert = require("heic-convert");
    // quality 1 ≈ lossless intermediate; sharp does the real q85 re-encode.
    return await convert({ buffer, format: "JPEG", quality: 1 });
  } catch (err) {
    logger.warn({ err: err.message }, "HEIC decode failed");
    throw new AppError(
      "IMAGE_PROCESSING_FAILED",
      "Could not read that HEIC image",
      422,
      {
        user_message:
          "We couldn't process that HEIC photo. Try exporting it as JPEG and uploading again.",
      },
    );
  }
}

/**
 * Compress a raster image buffer, preserving its format and aspect ratio.
 * HEIC/HEIF is decoded first and emitted as JPEG. Returns
 * { buffer, mime_type, compressed, converted }. On any failure or non-image
 * input, returns the original buffer with compressed:false (HEIC decode
 * failures throw, since the original is unusable downstream).
 *
 * @param {Buffer} buffer
 * @param {string} mime
 * @param {string} [filename] original filename (helps detect HEIC by extension)
 */
async function compressImage(buffer, mime, filename) {
  const passthrough = {
    buffer,
    mime_type: mime,
    compressed: false,
    converted: false,
  };
  if (!Buffer.isBuffer(buffer)) return passthrough;

  const heic = isHeic(mime, filename, buffer);
  if (!heic && !isCompressibleImage(mime)) return passthrough;

  // HEIC decode failures propagate; everything else degrades gracefully to
  // the untouched original.
  let working = buffer;
  let outMime = String(mime || "").toLowerCase();
  let converted = false;
  if (heic) {
    working = await decodeHeicToJpeg(buffer);
    outMime = "image/jpeg";
    converted = true;
  }

  try {
    const img = sharp(working, { failOn: "none" }).rotate(); // honour EXIF
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

    let out;
    if (outMime === "image/png") {
      out = await img.png({ compressionLevel: 9, palette: true }).toBuffer();
    } else if (outMime === "image/webp") {
      out = await img.webp({ quality: QUALITY }).toBuffer();
    } else {
      out = await img.jpeg({ quality: QUALITY, mozjpeg: true }).toBuffer();
    }

    // For a converted HEIC, always keep the JPEG — the source is unusable in
    // browsers even if (rarely) the JPEG is larger. Otherwise never hand back
    // something bigger than we received.
    if (!converted && out.length >= buffer.length) {
      return passthrough;
    }
    return { buffer: out, mime_type: outMime, compressed: true, converted };
  } catch (err) {
    logger.warn({ err: err.message }, "image compression skipped");
    if (converted) {
      // We already decoded the HEIC — return the decoded JPEG even though the
      // optimise step failed, so the stored asset is still viewable.
      return {
        buffer: working,
        mime_type: "image/jpeg",
        compressed: false,
        converted: true,
      };
    }
    return passthrough;
  }
}

/** Swap a filename's extension to match a (possibly converted) mime type, so
 *  a HEIC stored as JPEG gets a `.jpg` name rather than a misleading `.heic`. */
function filenameForMime(filename, mime) {
  const map = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
  };
  const ext = map[String(mime || "").toLowerCase()];
  if (!filename) return ext ? `image${ext}` : filename;
  if (!ext) return filename;
  const base = path.basename(filename, path.extname(filename)) || "image";
  return `${base}${ext}`;
}

/**
 * Compress + normalise a multer-style upload ({ buffer, mimetype, originalname })
 * for storage. The one call sites should use: it handles HEIC conversion and
 * returns a corrected filename to store under.
 *
 * @returns {Promise<{buffer, mime_type, filename, compressed, converted}>}
 */
async function compressUpload(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    return {
      buffer: file && file.buffer,
      mime_type: file && file.mimetype,
      filename: file && file.originalname,
      compressed: false,
      converted: false,
    };
  }
  const shrunk = await compressImage(
    file.buffer,
    file.mimetype,
    file.originalname,
  );
  return {
    buffer: shrunk.buffer,
    mime_type: shrunk.mime_type,
    filename: shrunk.converted
      ? filenameForMime(file.originalname, shrunk.mime_type)
      : file.originalname,
    compressed: shrunk.compressed,
    converted: shrunk.converted,
  };
}

/**
 * Normalise an upload so downstream sharp pipelines / raster allow-lists can
 * read it, WITHOUT the full resize+re-encode. HEIC is decoded to JPEG; other
 * images pass through unchanged. Used by callers that run their own sharp
 * processing (branding logos, OG banners) and just need a decodable buffer.
 *
 * @returns {Promise<{buffer, mimetype, originalname, converted}>}
 */
async function normalizeImageInput(file) {
  if (!file || !Buffer.isBuffer(file.buffer)) return file;
  if (!isHeic(file.mimetype, file.originalname, file.buffer)) return file;
  const buffer = await decodeHeicToJpeg(file.buffer);
  return {
    ...file,
    buffer,
    mimetype: "image/jpeg",
    originalname: filenameForMime(file.originalname, "image/jpeg"),
    converted: true,
  };
}

module.exports = {
  compressImage,
  compressUpload,
  normalizeImageInput,
  isCompressibleImage,
  isHeic,
  filenameForMime,
  MAX_EDGE,
  QUALITY,
};
