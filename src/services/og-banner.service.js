/**
 * OG share-banner composer.
 *
 * Turns a single uploaded photo (usually 4:5 or square — the shapes phones
 * shoot) into a correctly-sized 1200×630 Open Graph / Twitter share card:
 * the photo is centred as a "panel", a brand gradient fills the space around
 * it, and — optionally — the brand logo and a short headline are laid over a
 * bottom scrim so the card reads as a designed share image rather than a
 * cropped snapshot.
 *
 * The exact same layout maths runs in the Storefront Studio → Branding preview
 * (apps/admin) so what the operator sees is what this produces. Composition is
 * done here (server-side, with sharp) so the output is a real, correctly-sized,
 * same-origin hosted file — social scrapers need an absolute 1200×630 image,
 * not a client canvas that a cross-origin source would taint.
 *
 * Re-editable: the (normalised) source photo is stored under its own key and
 * returned, so a later crop/gradient tweak recomposes from the original rather
 * than from the already-composed banner.
 */

"use strict";

const sharp = require("sharp");
const crypto = require("crypto");
const storage = require("./storage.service");
const { AppError } = require("../utils/errors");
const { normalizeImageInput } = require("./media-compression.service");

const OG_W = 1200;
const OG_H = 630;

function num(v, lo, hi, dflt) {
  const x = Number(v);
  if (!Number.isFinite(x)) return dflt;
  return Math.min(hi, Math.max(lo, x));
}

function hex(v, dflt) {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(String(v || "")) ? String(v) : dflt;
}

function xmlEscape(s) {
  return String(s || "").replace(
    /[<>&'"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&#39;", '"': "&quot;" })[c],
  );
}

/** Resolve a stored-media reference (bare key, `/media/<key>`, or an absolute
 *  URL whose path is `/media/<key>`) back to a storage key so we can read the
 *  bytes locally — never fetches an arbitrary URL, so there's no SSRF surface. */
function keyFromMediaRef(ref) {
  const s = String(ref || "");
  if (!s) return null;
  if (s.startsWith("/media/")) return s.slice("/media/".length);
  const m = /^https?:\/\/[^/]+\/media\/(.+)$/.exec(s);
  if (m) return m[1];
  if (!/^https?:\/\//i.test(s) && !s.startsWith("/")) return s; // already a bare key
  return null;
}

/** Normalise the parameters coming off a multipart form (all strings) or JSON
 *  into a clamped, typed shape — the single source of truth the preview mirrors. */
function normalizeParams(raw = {}) {
  const p = raw && typeof raw === "object" ? raw : {};
  const truthy = (v) => v === true || v === "true" || v === "1" || v === 1;
  return {
    zoom: num(p.zoom, 1, 3, 1),
    focusX: num(p.focusX, 0, 1, 0.5),
    focusY: num(p.focusY, 0, 1, 0.5),
    photoWidthPct: num(p.photoWidthPct, 0.3, 1, 0.62),
    gradFrom: hex(p.gradFrom, "#3a0d0d"),
    gradTo: hex(p.gradTo, "#120708"),
    showBranding: truthy(p.showBranding),
    headline: String(p.headline || "").slice(0, 80),
  };
}

async function loadSourceBuffer({ file, source_key }) {
  if (file && Buffer.isBuffer(file.buffer) && file.buffer.length) {
    const norm = await normalizeImageInput(file); // HEIC → JPEG, else passthrough
    return Buffer.isBuffer(norm.buffer) ? norm.buffer : file.buffer;
  }
  if (source_key) return storage.get(source_key);
  throw new AppError("NO_FILE", "No image was provided for the banner", 400, {
    user_message: "Upload a photo to build a share banner from.",
  });
}

/**
 * Compose (or recompose) the OG banner.
 *
 * @param {object} args
 * @param {string} args.brand
 * @param {object} [args.file]        multer memory file (new source upload)
 * @param {string} [args.source_key]  storage key of a previously-stored source (re-edit)
 * @param {string} [args.logo_url]    brand logo (only used when showBranding)
 * @param {object} [args.params]      composition params (see normalizeParams)
 * @returns {Promise<{banner_url, source_url, source_key, params}>}
 */
async function composeOgBanner({ brand, file, source_key, logo_url, params }) {
  if (!brand) throw new AppError("NO_BRAND", "Missing brand context", 400);
  const p = normalizeParams(params);
  const srcBuf = await loadSourceBuffer({ file, source_key });

  // Persist the (normalised) source on a fresh upload so later tweaks recompose
  // from the original, not from an already-composed banner.
  let storedSource = null;
  if (file && Buffer.isBuffer(file.buffer) && file.buffer.length) {
    try {
      const jpeg = await sharp(srcBuf)
        .rotate()
        .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer();
      storedSource = await storage.put(jpeg, {
        key: `storefront/${brand}/ogsrc-${crypto.randomBytes(10).toString("hex")}.jpg`,
        contentType: "image/jpeg",
      });
    } catch {
      throw new AppError("OG_IMAGE_FAILED", "Could not read that image", 422, {
        user_message: "We couldn't read that image. Try another photo (JPEG or PNG).",
      });
    }
  }

  // 1. Brand-gradient background (top-left → bottom-right).
  const gradSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}">` +
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${p.gradFrom}"/>` +
      `<stop offset="1" stop-color="${p.gradTo}"/>` +
      `</linearGradient></defs>` +
      `<rect width="${OG_W}" height="${OG_H}" fill="url(#g)"/></svg>`,
  );

  const composites = [];

  // 2. Centred photo panel — cover-fit with zoom + focus (so a portrait/square
  //    photo sits as a tall centred band with gradient on the sides).
  const panelW = Math.min(OG_W, Math.max(1, Math.round(OG_W * p.photoWidthPct)));
  const panelH = OG_H;
  const panelX = Math.round((OG_W - panelW) / 2);
  const scaledW = Math.max(panelW, Math.round(panelW * p.zoom));
  const scaledH = Math.max(panelH, Math.round(panelH * p.zoom));
  try {
    const covered = await sharp(srcBuf)
      .rotate()
      .resize(scaledW, scaledH, { fit: "cover", position: "centre" })
      .toBuffer();
    const meta = await sharp(covered).metadata();
    const cw = meta.width || scaledW;
    const ch = meta.height || scaledH;
    const left = Math.max(0, Math.min(cw - panelW, Math.round((cw - panelW) * p.focusX)));
    const top = Math.max(0, Math.min(ch - panelH, Math.round((ch - panelH) * p.focusY)));
    const panelBuf = await sharp(covered)
      .extract({ left, top, width: panelW, height: panelH })
      .toBuffer();
    composites.push({ input: panelBuf, left: panelX, top: 0 });
  } catch {
    throw new AppError("OG_IMAGE_FAILED", "Could not process that image", 422, {
      user_message: "We couldn't build a banner from that image. Try another photo.",
    });
  }

  // 3. Optional branding overlay: a bottom scrim for legibility, then the logo
  //    (top-left) and headline (bottom-left). Each step is best-effort — a
  //    missing logo or an SVG-text/font hiccup must never fail the compose.
  if (p.showBranding) {
    const scrim = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}">` +
        `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">` +
        `<stop offset="0" stop-color="#000" stop-opacity="0"/>` +
        `<stop offset="1" stop-color="#000" stop-opacity="0.72"/>` +
        `</linearGradient></defs>` +
        `<rect x="0" y="${OG_H - 240}" width="${OG_W}" height="240" fill="url(#s)"/></svg>`,
    );
    composites.push({ input: scrim, left: 0, top: 0 });

    const logoKey = keyFromMediaRef(logo_url);
    if (logoKey) {
      try {
        const logoBuf = await storage.get(logoKey);
        const logoPng = await sharp(logoBuf)
          .resize({ height: 60, fit: "inside", withoutEnlargement: true })
          .png()
          .toBuffer();
        composites.push({ input: logoPng, left: 56, top: 44 });
      } catch {
        /* logo is optional */
      }
    }

    if (p.headline) {
      const textSvg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}">` +
          `<text x="56" y="${OG_H - 62}" font-size="46" font-weight="700" ` +
          `font-family="'DejaVu Sans','Helvetica Neue',Arial,sans-serif" fill="#ffffff">` +
          `${xmlEscape(p.headline)}</text></svg>`,
      );
      composites.push({ input: textSvg, left: 0, top: 0 });
    }
  }

  const bannerBuf = await sharp(gradSvg)
    .composite(composites)
    .jpeg({ quality: 88 })
    .toBuffer();
  const stored = await storage.put(bannerBuf, {
    key: `storefront/${brand}/og-${crypto.randomBytes(10).toString("hex")}.jpg`,
    contentType: "image/jpeg",
  });

  return {
    banner_url: stored.public_url,
    source_url: storedSource
      ? storedSource.public_url
      : source_key
        ? storage.publicUrl(source_key)
        : null,
    source_key: storedSource ? storedSource.key : source_key || null,
    params: p,
  };
}

module.exports = { composeOgBanner, normalizeParams, keyFromMediaRef, OG_W, OG_H };
