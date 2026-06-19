/**
 * Icon pipeline — turn an uploaded brand logo into a clean favicon + PWA
 * icon set with a transparent background.
 *
 * Transparency policy (agreed with product):
 *   • Default: respect the source. If it already has an alpha channel
 *     (PNG / WEBP / GIF), we only trim + centre — never key out pixels,
 *     so anti-aliased edges and intentional fills stay intact.
 *   • Fallback: a source with no alpha (e.g. JPEG) cannot be transparent.
 *     We best-effort key out the corner colour so the mark doesn't sit on
 *     a hard rectangle, and return a `warning` the UI surfaces so the
 *     admin knows the risks and can re-upload a transparent master.
 *
 * Pure-ish: takes a buffer, returns buffers + metadata. Storage and DB
 * wiring live in the caller (platform-settings.service).
 */

"use strict";

const sharp = require("sharp");

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/** Trim solid/transparent borders, fit into a square of `size` on a fully
 *  transparent canvas, with optional safe-zone padding (for maskable). */
function squareTransparent(input, size, paddingRatio = 0) {
  const inner = Math.round(size * (1 - paddingRatio));
  const pad = (size - inner) / 2;
  return sharp(input)
    .ensureAlpha()
    .trim({ threshold: 10 })
    .resize(inner, inner, { fit: "contain", background: TRANSPARENT })
    .extend({
      top: Math.floor(pad),
      bottom: Math.ceil(pad),
      left: Math.floor(pad),
      right: Math.ceil(pad),
      background: TRANSPARENT,
    })
    .png();
}

/** Trim borders and cap the longest edge, preserving aspect ratio, on a
 *  transparent canvas. Used for the display logo (logos are often wide,
 *  so we must NOT force them square the way icons are). */
function cleanTransparent(input, maxDim = 1024) {
  return sharp(input)
    .ensureAlpha()
    .trim({ threshold: 10 })
    .resize(maxDim, maxDim, {
      fit: "inside",
      withoutEnlargement: true,
      background: TRANSPARENT,
    })
    .png();
}

/** Does the source carry meaningful transparency already? */
async function hasAlpha(buffer) {
  const meta = await sharp(buffer).metadata();
  return Boolean(meta.hasAlpha);
}

/** Key out the corner colour to transparent. Best-effort — only sound for
 *  solid, flat backdrops. Returns a fresh PNG buffer. */
async function keyOutBackground(buffer, tolerance = 18) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const [kr, kg, kb] = [data[0], data[1], data[2]];
  for (let i = 0; i < data.length; i += info.channels) {
    if (
      Math.abs(data[i] - kr) <= tolerance &&
      Math.abs(data[i + 1] - kg) <= tolerance &&
      Math.abs(data[i + 2] - kb) <= tolerance
    ) {
      data[i + 3] = 0;
    }
  }
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .png()
    .toBuffer();
}

/** Minimal ICO encoder embedding PNG entries (PNG-in-ICO; supported by
 *  every modern browser and Windows Vista+). No external dependency. */
function encodeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);

  const entries = [];
  const images = [];
  let offset = 6 + pngs.length * 16;
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    images.push(data);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...images]);
}

/**
 * Build the full icon set from a source logo buffer.
 *
 * @param {Buffer} buffer        Source image bytes.
 * @param {object} opts
 * @param {boolean} [opts.allowKeyOut=true]  Permit corner-keying when the
 *        source has no alpha. Set false to never alter pixels.
 * @returns {Promise<{
 *   logo: Buffer, faviconIco: Buffer, favicon64: Buffer,
 *   icon192: Buffer, icon512: Buffer, maskable512: Buffer, apple180: Buffer,
 *   transparency: { hadAlpha: boolean, keyed: boolean, warning: string|null }
 * }>}
 */
async function generateIconSet(buffer, { allowKeyOut = true } = {}) {
  const hadAlpha = await hasAlpha(buffer);
  let source = buffer;
  let keyed = false;
  let warning = null;

  if (!hadAlpha) {
    if (allowKeyOut) {
      source = await keyOutBackground(buffer);
      keyed = true;
      warning =
        "The uploaded image had no transparency, so its background colour was " +
        "removed automatically. This is best-effort and can leave faint edges " +
        "or halos. For a clean result, upload a PNG/WEBP with a real " +
        "transparent background.";
    } else {
      warning =
        "The uploaded image has no transparent background; it will appear on a " +
        "solid rectangle. Upload a transparent PNG/WEBP for a clean icon.";
    }
  }

  const [
    logo,
    favicon64,
    f16,
    f32,
    f48,
    icon192,
    icon512,
    maskable512,
    appleSquare,
  ] = await Promise.all([
    cleanTransparent(source, 1024).toBuffer(),
    squareTransparent(source, 64).toBuffer(),
    squareTransparent(source, 16).toBuffer(),
    squareTransparent(source, 32).toBuffer(),
    squareTransparent(source, 48).toBuffer(),
    squareTransparent(source, 192).toBuffer(),
    squareTransparent(source, 512).toBuffer(),
    squareTransparent(source, 512, 0.2).toBuffer(),
    squareTransparent(source, 180, 0.12).toBuffer(),
  ]);

  // iOS wants an opaque, padded square.
  const apple180 = await sharp(appleSquare)
    .flatten({ background: "#0f0809" })
    .png()
    .toBuffer();

  const faviconIco = encodeIco([
    { size: 16, data: f16 },
    { size: 32, data: f32 },
    { size: 48, data: f48 },
  ]);

  return {
    logo,
    faviconIco,
    favicon64,
    icon192,
    icon512,
    maskable512,
    apple180,
    transparency: { hadAlpha, keyed, warning },
  };
}

module.exports = {
  generateIconSet,
  // exported for unit tests
  encodeIco,
  squareTransparent,
  cleanTransparent,
  keyOutBackground,
  hasAlpha,
};
