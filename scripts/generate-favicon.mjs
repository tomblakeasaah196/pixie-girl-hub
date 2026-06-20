#!/usr/bin/env node
/**
 * generate-favicon — turn a brand logo into the public sales site's favicon
 * set (favicon.ico + PNG fallbacks + apple-touch + PWA icons).
 *
 * This is the "logo → favicon.ico" pipeline for apps/landing (the sales
 * subdomain). It's a build step — run it whenever a brand's master logo
 * changes — so the committed icons are deterministic and we never do image
 * work on the request path. (The Landing Studio can also set a per-brand
 * favicon URL at runtime, which overrides these defaults via the page's
 * generateMetadata.)
 *
 * Usage:
 *   node scripts/generate-favicon.mjs <source-logo> [--out <dir>] [--flatten]
 *
 *   <source-logo>  PNG/SVG/WEBP master (ideally square, already transparent).
 *   --out <dir>    Output dir (default: apps/landing/public).
 *   --flatten      Best-effort: key out a solid corner background to transparent.
 *
 * Emits into <out>: favicon.ico (16/32/48), favicon-16.png, favicon-32.png,
 *   apple-touch-icon.png (180, padded, opaque), icon-192.png, icon-512.png,
 *   and favicon.svg (copied through when the source is an SVG).
 *
 * Requires: sharp (already a backend dependency).
 */

"use strict";

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, dirname, resolve, extname } from "node:path";
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

/** Fit the mark into a square canvas with a little breathing room, on a fully
 *  transparent background. */
function squareTransparent(input, size, paddingRatio = 0) {
  const inner = Math.round(size * (1 - paddingRatio));
  return sharp(input)
    .ensureAlpha()
    .trim({ threshold: 10 })
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: Math.floor((size - inner) / 2),
      bottom: Math.ceil((size - inner) / 2),
      left: Math.floor((size - inner) / 2),
      right: Math.ceil((size - inner) / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png();
}

/** Key out a flat background by sampling the top-left pixel. Best-effort —
 *  only sound for solid, flat backdrops. */
async function flattenToTransparent(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
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
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .png()
    .toBuffer();
}

/** Minimal PNG-in-ICO encoder (supported by every modern browser). */
function encodeIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const entries = [];
  const images = [];
  let offset = 6 + count * 16;
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
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

async function main() {
  const { source, out, flatten } = parseArgs(process.argv.slice(2));
  if (!source) {
    console.error("Usage: node scripts/generate-favicon.mjs <source-logo> [--out <dir>] [--flatten]");
    process.exit(1);
  }
  const outDir = out ? resolve(out) : join(repoRoot, "apps/landing/public");
  await mkdir(outDir, { recursive: true });

  const src = flatten ? await flattenToTransparent(source) : source;

  // PWA icons referenced by apps/landing/app/manifest.webmanifest.
  await writeFile(join(outDir, "icon-192.png"), await squareTransparent(src, 192).toBuffer());
  await writeFile(join(outDir, "icon-512.png"), await squareTransparent(src, 512).toBuffer());

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

  // Pass an SVG master straight through so crisp vector favicons are available.
  if (typeof source === "string" && extname(source).toLowerCase() === ".svg") {
    await writeFile(join(outDir, "favicon.svg"), await readFile(source));
  }

  console.log(`✓ Favicon set written to ${outDir}`);
  console.log("  favicon.ico, favicon-16/32.png, apple-touch-icon.png, icon-192/512.png");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
