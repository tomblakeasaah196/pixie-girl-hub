"use strict";

/**
 * Image compression (catalogue uploads). Generates real raster bytes with
 * sharp so the re-encode path is exercised end to end; non-raster and
 * non-buffer inputs must pass through untouched.
 */

const sharp = require("sharp");
const {
  compressImage,
  isCompressibleImage,
} = require("../../../src/services/media-compression.service");

describe("isCompressibleImage", () => {
  test("accepts jpeg/png/webp, rejects svg/gif/undefined", () => {
    expect(isCompressibleImage("image/jpeg")).toBe(true);
    expect(isCompressibleImage("image/PNG")).toBe(true);
    expect(isCompressibleImage("image/webp")).toBe(true);
    expect(isCompressibleImage("image/svg+xml")).toBe(false);
    expect(isCompressibleImage("image/gif")).toBe(false);
    expect(isCompressibleImage(undefined)).toBe(false);
  });
});

describe("compressImage", () => {
  test("downscales an oversized JPEG and reports compressed", async () => {
    // 3000px noisy image → must shrink past the 2400 max edge.
    const big = await sharp({
      create: {
        width: 3000,
        height: 2000,
        channels: 3,
        background: { r: 120, g: 40, b: 40 },
      },
    })
      .jpeg({ quality: 100 })
      .toBuffer();

    const out = await compressImage(big, "image/jpeg");
    expect(out.compressed).toBe(true);
    expect(out.mime_type).toBe("image/jpeg");
    expect(out.buffer.length).toBeLessThan(big.length);

    const meta = await sharp(out.buffer).metadata();
    expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(2400);
  });

  test("passes non-raster mime through untouched", async () => {
    const svg = Buffer.from("<svg/>");
    const out = await compressImage(svg, "image/svg+xml");
    expect(out.compressed).toBe(false);
    expect(out.buffer).toBe(svg);
  });

  test("passes non-buffer input through untouched", async () => {
    const out = await compressImage(null, "image/jpeg");
    expect(out.compressed).toBe(false);
    expect(out.buffer).toBeNull();
  });
});
