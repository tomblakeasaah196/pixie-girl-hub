#!/usr/bin/env node

/**
 * Bulk-compress existing branding images to high-quality WEBP.
 *
 * Usage:  node scripts/compress-branding-images.js [--dry-run]
 *
 * Scans STORAGE_LOCAL_ROOT/branding for PNG/JPEG images and converts them to
 * WEBP at quality 85, keeping the original dimensions (capped at 2048px).
 * Originals are backed up to {filename}.orig before overwriting. Files that
 * are already WEBP or smaller than 10KB are skipped.
 *
 * The icon-pipeline output (logo.png, favicon*, icon-*) is left untouched
 * since those are purpose-generated at exact sizes and formats.
 */

"use strict";

const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");

const STORAGE_ROOT = process.env.STORAGE_LOCAL_ROOT || "./media";
const BRANDING_DIR = path.join(STORAGE_ROOT, "branding");
const MAX_DIM = 2048;
const QUALITY = 85;
const SKIP_NAMES = new Set([
  "logo.png",
  "favicon.ico",
  "favicon-64.png",
  "icon-192.png",
  "icon-512.png",
  "maskable-512.png",
  "apple-touch-icon.png",
]);

const DRY_RUN = process.argv.includes("--dry-run");

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (e.isFile()) {
      files.push(full);
    }
  }
  return files;
}

function isCompressible(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath);
  if (SKIP_NAMES.has(name)) return false;
  return [".png", ".jpg", ".jpeg"].includes(ext);
}

function formatBytes(b) {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / (1024 * 1024)).toFixed(2)}MB`;
}

async function main() {
  console.log(`Scanning ${BRANDING_DIR} …`);
  if (DRY_RUN) console.log("(dry run — no files will be modified)\n");

  let files;
  try {
    files = await walk(BRANDING_DIR);
  } catch (err) {
    if (err.code === "ENOENT") {
      console.log("Branding directory does not exist. Nothing to compress.");
      return;
    }
    throw err;
  }

  const targets = files.filter(isCompressible);
  if (targets.length === 0) {
    console.log("No compressible images found.");
    return;
  }

  let totalBefore = 0;
  let totalAfter = 0;
  let compressed = 0;
  let skipped = 0;

  for (const filePath of targets) {
    const stat = await fs.stat(filePath);
    if (stat.size < 10 * 1024) {
      skipped++;
      continue;
    }

    const buf = await fs.readFile(filePath);
    const img = sharp(buf);
    const meta = await img.metadata();

    const pipeline =
      (meta.width && meta.width > MAX_DIM) ||
      (meta.height && meta.height > MAX_DIM)
        ? img.resize(MAX_DIM, MAX_DIM, {
            fit: "inside",
            withoutEnlargement: true,
          })
        : img;

    const webp = await pipeline.webp({ quality: QUALITY, effort: 4 }).toBuffer();

    const ratio = ((1 - webp.length / buf.length) * 100).toFixed(1);
    const rel = path.relative(BRANDING_DIR, filePath);
    console.log(
      `  ${rel}: ${formatBytes(buf.length)} → ${formatBytes(webp.length)} (${ratio}% saved)`,
    );

    totalBefore += buf.length;
    totalAfter += webp.length;

    if (!DRY_RUN) {
      await fs.writeFile(`${filePath}.orig`, buf);
      const newPath = filePath.replace(/\.(png|jpe?g)$/i, ".webp");
      await fs.writeFile(newPath, webp);
      if (newPath !== filePath) await fs.unlink(filePath);
    }
    compressed++;
  }

  console.log(
    `\nDone: ${compressed} compressed, ${skipped} skipped (< 10KB)`,
  );
  if (compressed > 0) {
    console.log(
      `Total: ${formatBytes(totalBefore)} → ${formatBytes(totalAfter)} (${((1 - totalAfter / totalBefore) * 100).toFixed(1)}% saved)`,
    );
  }
  if (!DRY_RUN && compressed > 0) {
    console.log(
      "\n⚠  Originals backed up as .orig files. Update DB URLs if extensions changed (.png/.jpg → .webp).",
    );
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
