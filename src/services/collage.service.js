/**
 * Bundle collage generator (Catalogue → Bundles).
 *
 * Builds a beautiful PORTRAIT (4:5, 1080×1350) WebP cover from a bundle's
 * component photos — an editorial "feature" layout that adapts to the piece
 * count (bundles run 3–6), on the brand's Maroon-Noir palette, with floating
 * rounded tiles, hairline accent borders, a bottom gradient scrim and an
 * editable badge (eyebrow + title) typeset in a curated serif.
 *
 * Typography is rendered with fontkit → exact vector glyph paths from the
 * TTFs bundled in assets/fonts (no fontconfig/system-font dependency, so the
 * output is byte-deterministic across hosts). Image compositing is sharp.
 *
 * The chosen font + text + palette live in the bundle's collage_settings so a
 * cover can be re-edited and the whole set restyled in one go.
 */

"use strict";

const path = require("path");
const fontkit = require("fontkit");
const sharp = require("sharp");
const storage = require("./storage.service");
const { config } = require("../config/env");
const { logger } = require("../config/logger");

// ── Canvas geometry ─────────────────────────────────────────
const W = 1080;
const H = 1350; // 4:5 portrait (Instagram-native)
const PAD = 40; // outer margin
const GUT = 18; // gutter between tiles
const RADIUS = 22; // tile corner radius
const SCRIM_H = 380; // bottom gradient height (bottom-weighted — see stops)

// ── Curated fonts (the picker's options; Playfair intentionally excluded) ──
// family → bundled TTF. Mirrors the seeded shared.font_catalog / landing-kit
// CURATED_FONTS so the collage offers the same faces the rest of the platform
// already uses. Title faces are serifs; the eyebrow is always Montserrat.
const FONT_DIR = path.join(__dirname, "..", "..", "assets", "fonts");
const TITLE_FONTS = {
  "Cormorant Garamond": "cormorant-garamond-600.ttf",
  Marcellus: "marcellus-400.ttf",
  Italiana: "italiana-400.ttf",
  "DM Serif Display": "dm-serif-display-400.ttf",
};
const DEFAULT_TITLE_FONT = "Cormorant Garamond";
const EYEBROW_FONT = "montserrat-500.ttf";

/** List the families the collage editor may offer (server is the boundary —
 *  only faces we can actually render are exposed). */
function curatedTitleFonts() {
  return Object.keys(TITLE_FONTS);
}

const _fontCache = new Map();
function loadFont(file) {
  if (!_fontCache.has(file)) {
    _fontCache.set(file, fontkit.openSync(path.join(FONT_DIR, file)));
  }
  return _fontCache.get(file);
}
function titleFontFile(family) {
  return TITLE_FONTS[family] || TITLE_FONTS[DEFAULT_TITLE_FONT];
}

// ── Colour helpers ──────────────────────────────────────────
function clampByte(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}
function hexToRgb(hex) {
  const h = String(hex || "").replace("#", "");
  if (h.length !== 6) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}
function rgbToHex({ r, g, b }) {
  const h = (n) => clampByte(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}
/** Mix a hex toward white (amt>0) or black (amt<0), amt in [-1,1]. */
function mix(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  const t = amt < 0 ? 0 : 255;
  const k = Math.abs(amt);
  return rgbToHex({
    r: r + (t - r) * k,
    g: g + (t - g) * k,
    b: b + (t - b) * k,
  });
}

// ── Brand palette (Maroon-Noir defaults, brand accent layered on) ──
function defaultPalette(brand, brandRow) {
  // brandRow: { accent_colour, brand_theme:{ accent, accent_deep } } | null
  const theme = (brandRow && brandRow.brand_theme) || {};
  const accent =
    theme.accent || (brandRow && brandRow.accent_colour) || "#690909";
  const accentDeep = theme.accent_deep || mix(accent, -0.45);
  // A near-black tint of the accent reads as the Maroon-Noir ground.
  const bg = mix(accentDeep, -0.55);
  return {
    bg,
    accent,
    accentGlow: mix(accent, 0.34),
    cream: "#F4E9D9",
    muted: "#B3A49B",
  };
}

// ── Typography → SVG vector path ────────────────────────────
/**
 * Lay out `text` with fontkit and return a single SVG path `d` (origin at the
 * baseline of the first glyph) plus its rendered width, honouring optional
 * letter-spacing (em). The caller positions it with a translate().
 */
function textPath(font, text, fontSize, letterSpacingEm = 0) {
  const scale = fontSize / font.unitsPerEm;
  const tracking = letterSpacingEm * font.unitsPerEm;
  const run = font.layout(String(text));
  let pen = 0;
  const parts = [];
  for (let i = 0; i < run.glyphs.length; i++) {
    const glyph = run.glyphs[i];
    const pos = run.positions[i];
    // Font coords are y-up; flip to SVG's y-down with d = -scale.
    const p = glyph.path.transform(
      scale,
      0,
      0,
      -scale,
      (pen + pos.xOffset) * scale,
      0,
    );
    const d = p.toSVG();
    if (d) parts.push(d);
    pen += pos.xAdvance + tracking;
  }
  return { d: parts.join(" "), width: Math.max(0, (pen - tracking) * scale) };
}

/** A centred `<path>` element, auto-shrunk so it never exceeds maxWidth. */
function centredText(font, text, fontSize, cx, baselineY, color, opts = {}) {
  const { letterSpacingEm = 0, maxWidth = W } = opts;
  let size = fontSize;
  let tp = textPath(font, text, size, letterSpacingEm);
  if (tp.width > maxWidth && tp.width > 0) {
    size = size * (maxWidth / tp.width);
    tp = textPath(font, text, size, letterSpacingEm);
  }
  const x = cx - tp.width / 2;
  return `<path d="${tp.d}" transform="translate(${x.toFixed(2)},${baselineY})" fill="${color}"/>`;
}

// ── Layout: tile rectangles for a given piece count (3–6) ───
function layout(count) {
  const x0 = PAD;
  const y0 = PAD;
  const cw = W - PAD * 2; // content width
  const ch = H - PAD * 2; // content height
  const half = (cw - GUT) / 2;
  const rects = [];

  if (count === 3) {
    const heroH = Math.round(ch * 0.58);
    const botH = ch - heroH - GUT;
    rects.push({ x: x0, y: y0, w: cw, h: heroH });
    rects.push({ x: x0, y: y0 + heroH + GUT, w: half, h: botH });
    rects.push({ x: x0 + half + GUT, y: y0 + heroH + GUT, w: half, h: botH });
  } else if (count === 4) {
    const cellH = (ch - GUT) / 2;
    for (let r = 0; r < 2; r++)
      for (let c = 0; c < 2; c++)
        rects.push({
          x: x0 + c * (half + GUT),
          y: y0 + r * (cellH + GUT),
          w: half,
          h: cellH,
        });
  } else if (count === 5) {
    const heroH = Math.round(ch * 0.4);
    const gridH = ch - heroH - GUT;
    const cellH = (gridH - GUT) / 2;
    rects.push({ x: x0, y: y0, w: cw, h: heroH });
    const gy = y0 + heroH + GUT;
    for (let r = 0; r < 2; r++)
      for (let c = 0; c < 2; c++)
        rects.push({
          x: x0 + c * (half + GUT),
          y: gy + r * (cellH + GUT),
          w: half,
          h: cellH,
        });
  } else {
    // 6 → 2 columns × 3 rows (keeps each tile portrait-ish, best for faces)
    const cellH = (ch - GUT * 2) / 3;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 2; c++)
        rects.push({
          x: x0 + c * (half + GUT),
          y: y0 + r * (cellH + GUT),
          w: half,
          h: cellH,
        });
  }
  return rects.map((r) => ({
    x: Math.round(r.x),
    y: Math.round(r.y),
    w: Math.round(r.w),
    h: Math.round(r.h),
  }));
}

// ── Image resolution + tile rendering ───────────────────────
/** Fetch the raw bytes behind a stored/CDN/external image URL. */
async function resolveImageBuffer(url) {
  if (!url) return null;
  try {
    if (/^https?:\/\//i.test(url)) {
      // CDN-hosted but actually local? Strip our own CDN base → storage key.
      if (config.CDN_BASE_URL && url.startsWith(config.CDN_BASE_URL)) {
        const key = url.slice(config.CDN_BASE_URL.length).replace(/^\/+/, "");
        return await storage.get(key);
      }
      const res = await fetch(url);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    }
    // Local: "/media/<key>" or a bare storage key.
    const key = url.replace(/^\/?media\//, "").replace(/^\/+/, "");
    return await storage.get(key);
  } catch (err) {
    logger.warn({ err: err.message, url }, "collage: image fetch failed");
    return null;
  }
}

/** A rounded, cover-cropped tile (crop focuses on the subject/face). */
async function roundedTile(buffer, w, h) {
  const mask = Buffer.from(
    `<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${RADIUS}" ry="${RADIUS}" fill="#fff"/></svg>`,
  );
  return sharp(buffer)
    .resize(w, h, { fit: "cover", position: sharp.strategy.attention })
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

/** Branded monogram fallback for a component with no usable photo. */
async function monogramTile(w, h, label, palette) {
  const font = loadFont(titleFontFile(DEFAULT_TITLE_FONT));
  const initials =
    String(label || "•")
      .replace(/[^A-Za-z0-9 ]/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0].toUpperCase())
      .join("") || "•";
  const size = Math.round(Math.min(w, h) * 0.34);
  const glyph = centredText(font, initials, size, w / 2, h / 2 + size * 0.34, mix(palette.accentGlow, 0.1), { maxWidth: w * 0.8 });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="${w}" height="${h}" rx="${RADIUS}" ry="${RADIUS}" fill="${mix(palette.accent, -0.5)}"/>
    ${glyph}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ── The overlay (tile borders + scrim + badge text) ─────────
function buildOverlaySvg({ rects, palette, eyebrow, title, titleFontFile: tff }) {
  const borders = rects
    .map(
      (r) =>
        `<rect x="${r.x + 0.75}" y="${r.y + 0.75}" width="${r.w - 1.5}" height="${r.h - 1.5}" rx="${RADIUS}" ry="${RADIUS}" fill="none" stroke="${palette.accentGlow}" stroke-opacity="0.35" stroke-width="1.5"/>`,
    )
    .join("");

  const titleFont = loadFont(tff);
  const eyebrowFont = loadFont(EYEBROW_FONT);

  const cx = W / 2;
  const ruleW = 64;
  const ruleY = H - 196;
  const rule = `<rect x="${cx - ruleW / 2}" y="${ruleY}" width="${ruleW}" height="2" rx="1" fill="${palette.accent}"/>`;

  const eyebrowEl = eyebrow
    ? centredText(eyebrowFont, eyebrow.toUpperCase(), 25, cx, H - 150, palette.accentGlow, {
        letterSpacingEm: 0.34,
        maxWidth: W - PAD * 2,
      })
    : "";
  const titleEl = centredText(titleFont, title, 70, cx, H - 80, palette.cream, {
    maxWidth: W - PAD * 2,
  });

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs>
        <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${palette.bg}" stop-opacity="0"/>
          <stop offset="0.45" stop-color="${palette.bg}" stop-opacity="0.12"/>
          <stop offset="0.74" stop-color="${palette.bg}" stop-opacity="0.68"/>
          <stop offset="1" stop-color="${palette.bg}" stop-opacity="0.98"/>
        </linearGradient>
      </defs>
      <rect x="0" y="${H - SCRIM_H}" width="${W}" height="${SCRIM_H}" fill="url(#scrim)"/>
      ${borders}
      ${rule}
      ${eyebrowEl}
      ${titleEl}
    </svg>`,
  );
}

/**
 * Build the collage WebP for a bundle.
 *
 * @param {object} a
 * @param {string} a.brand
 * @param {Array}  a.components  ordered components, each { image_url, name }
 * @param {object} a.settings    collage_settings overrides (title/eyebrow/font_family/bg/accent)
 * @param {object} a.brandRow    business_config row for the palette
 * @param {string} a.brandName   wordmark fallback for the eyebrow
 * @returns {Promise<{ buffer: Buffer, mime: string, count: number, settings: object }>}
 */
async function buildBundleCollage({ brand, components, settings = {}, brandRow, brandName }) {
  const usable = (components || []).slice(0, 6);
  if (usable.length < 3) {
    const err = new Error("A collage needs at least 3 products.");
    err.code = "COLLAGE_TOO_FEW";
    throw err;
  }
  const count = usable.length;
  const rects = layout(count);
  const palette = defaultPalette(brand, brandRow);
  if (settings.bg) palette.bg = settings.bg;
  if (settings.accent) {
    palette.accent = settings.accent;
    palette.accentGlow = mix(settings.accent, 0.34);
  }

  const family = TITLE_FONTS[settings.font_family]
    ? settings.font_family
    : DEFAULT_TITLE_FONT;
  const title = (settings.title || `${count}-Piece Collection`).trim();
  const eyebrow =
    settings.eyebrow !== undefined
      ? settings.eyebrow
      : `${brandName || "The Pixie Hub"} · Bundle`;

  // Resolve + render each tile (fall back to a monogram when an image is gone).
  const tiles = await Promise.all(
    usable.map(async (c, i) => {
      const buf = await resolveImageBuffer(c.image_url);
      const r = rects[i];
      const input = buf
        ? await roundedTile(buf, r.w, r.h)
        : await monogramTile(r.w, r.h, c.name || c.styled_name, palette);
      return { input, left: r.x, top: r.y };
    }),
  );

  const overlay = buildOverlaySvg({
    rects,
    palette,
    eyebrow,
    title,
    titleFontFile: titleFontFile(family),
  });

  const buffer = await sharp({
    create: {
      width: W,
      height: H,
      channels: 4,
      background: { ...hexToRgb(palette.bg), alpha: 1 },
    },
  })
    .composite([...tiles, { input: overlay, left: 0, top: 0 }])
    .webp({ quality: 82 })
    .toBuffer();

  return {
    buffer,
    mime: "image/webp",
    count,
    settings: { title, eyebrow, font_family: family },
  };
}

module.exports = {
  buildBundleCollage,
  curatedTitleFonts,
  // exported for unit tests
  layout,
  textPath,
  defaultPalette,
};
