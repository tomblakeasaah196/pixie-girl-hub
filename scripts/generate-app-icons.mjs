#!/usr/bin/env node
/**
 * generate-app-icons — turn a single source logo into the full favicon /
 * PWA / apple-touch icon set, with a transparent background so the mark
 * sits cleanly on any theme.
 *
 * This is the "logo → favicon.ico" pipeline. It is intentionally a build
 * step (run it whenever a brand's master logo changes) so the committed
 * icons are deterministic and we don't do image work on the request path.
 * The runtime branding feed (GET /api/public/branding) still overrides
 * these at runtime per-brand and per-theme; these files are the static
 * defaults that ship in apps/admin/public and kill the cold-load 404.
 *
 * Usage:
 *   node scripts/generate-app-icons.mjs <source-logo> [--out <dir>] [--flatten]
 *
 *   <source-logo>  PNG/SVG/WEBP master (ideally square, already transparent).
 *   --out <dir>    Output dir (default: apps/admin/public).
 *   --flatten      Best-effort: make the source's corner colour transparent
 *                  (use only when the master has a solid flat background).
 *
 * Emits:           favicon.ico (16/32/48), favicon-32.png, favicon-16.png,
 *                  apple-touch-icon.png (180, padded), icons/icon-192.png,
 *                  icons/icon-512.png, icons/maskable-512.png.
 *
 * Requires: sharp (already a backend dependency).
 */

"use strict";

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function parseArgs(argv) {
  const args = { source: null, out: null, flatten: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--flatten") args.flatten = true;
    else if (a === "--out") args.out = argv[(i += 1)];
    else if (!a.startsWith("--")) args.source = a;
  }
  return args;
}

/** Trim transparent/solid borders, then fit into a square canvas with a
 *  little breathing room, on a fully transparent background. */
function squareTransparent(input, size, paddingRatio = 0) {
  const inner = Math.round(size * (1 - paddingRatio));
  return sharp(input)
    .ensureAlpha()
    .trim({ threshold: 10 })
    .resize(inner, inner, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .extend({
      top: Math.floor((size - inner) / 2),
      bottom: Math.ceil((size - inner) / 2),
      left: Math.floor((size - inner) / 2),
      right: Math.ceil((size - inner) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png();
}

/** Make a flat background transparent by sampling the top-left pixel and
 *  keying it out. Best-effort — only sound for solid, flat backdrops. */
async function flattenToTransparent(input) {
  const img = sharp(input).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const [kr, kg, kb] = [data[0], data[1], data[2]];
  const tol = 18;
  for (let i = 0; i < data.length; i += info.channels) {
    if (
      Math.abs(data[i] - kr) <= tol &&
      Math.abs(data[i + 1] - kg) <= tol &&
      Math.abs(data[i + 2] - kb) <= tol
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

/** Minimal ICO encoder that embeds PNG entries (PNG-in-ICO, supported by
 *  every modern browser and Windows Vista+). No external dependency. */
function encodeIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const entries = [];
  const images = [];
  let offset = 6 + count * 16;
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    images.push(data);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...images]);
}

async function main() {
  const { source, out, flatten } = parseArgs(process.argv.slice(2));
  if (!source) {
    console.error(
      "Usage: node scripts/generate-app-icons.mjs <source-logo> [--out <dir>] [--flatten]",
    );
    process.exit(1);
  }
  const outDir = out ? resolve(out) : join(repoRoot, "apps/admin/public");
  const iconsDir = join(outDir, "icons");
  await mkdir(iconsDir, { recursive: true });

  const src = flatten ? await flattenToTransparent(source) : source;

  // PWA icons — full-bleed for "any", padded safe-zone for "maskable".
  const i192 = await squareTransparent(src, 192).toBuffer();
  const i512 = await squareTransparent(src, 512).toBuffer();
  const maskable = await squareTransparent(src, 512, 0.2).toBuffer();
  await writeFile(join(iconsDir, "icon-192.png"), i192);
  await writeFile(join(iconsDir, "icon-512.png"), i512);
  await writeFile(join(iconsDir, "maskable-512.png"), maskable);

  // Apple touch icon — iOS prefers an opaque, padded square.
  const apple = await sharp(await squareTransparent(src, 180, 0.12).toBuffer())
    .flatten({ background: "#0f0809" })
    .png()
    .toBuffer();
  await writeFile(join(outDir, "apple-touch-icon.png"), apple);

  // Favicons.
  const f16 = await squareTransparent(src, 16).toBuffer();
  const f32 = await squareTransparent(src, 32).toBuffer();
  const f48 = await squareTransparent(src, 48).toBuffer();
  await writeFile(join(outDir, "favicon-16.png"), f16);
  await writeFile(join(outDir, "favicon-32.png"), f32);
  await writeFile(
    join(outDir, "favicon.ico"),
    encodeIco([
      { size: 16, data: f16 },
      { size: 32, data: f32 },
      { size: 48, data: f48 },
    ]),
  );

  console.log(`✓ App icons written to ${outDir}`);
  console.log(
    "  Remember to restore the maskable/192/512 PNG entries in manifest.webmanifest.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
