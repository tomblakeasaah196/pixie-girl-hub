"use strict";

/**
 * Image compression (image uploads). Generates real raster bytes with sharp
 * so the re-encode path is exercised end to end; non-raster and non-buffer
 * inputs must pass through untouched. The HEIC path mocks the libheif (wasm)
 * decoder so the conversion/normalisation logic is verified deterministically
 * without needing a real iPhone photo fixture (which can't be synthesised
 * here — sharp's bundled libvips can't encode HEVC-HEIC).
 */

jest.mock("heic-convert", () => jest.fn());

const sharp = require("sharp");
const convert = require("heic-convert");
const {
  compressImage,
  compressUpload,
  normalizeImageInput,
  isCompressibleImage,
  isHeic,
  filenameForMime,
} = require("../../../src/services/media-compression.service");

// A real JPEG the mocked HEIC decoder "produces", so the sharp step downstream
// has genuine bytes to re-encode.
let DECODED_JPEG;
beforeAll(async () => {
  DECODED_JPEG = await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: { r: 105, g: 9, b: 9 },
    },
  })
    .jpeg()
    .toBuffer();
});
beforeEach(() => {
  convert.mockReset();
  convert.mockResolvedValue(DECODED_JPEG);
});

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

describe("isHeic", () => {
  test("detects by mime type", () => {
    expect(isHeic("image/heic")).toBe(true);
    expect(isHeic("image/heif")).toBe(true);
    expect(isHeic("image/jpeg")).toBe(false);
  });
  test("detects by file extension when mime is generic", () => {
    expect(isHeic("application/octet-stream", "IMG_0001.HEIC")).toBe(true);
    expect(isHeic("application/octet-stream", "photo.heif")).toBe(true);
    expect(isHeic("application/octet-stream", "photo.jpg")).toBe(false);
  });
  test("sniffs the ISO-BMFF ftyp brand as a last resort", () => {
    const buf = Buffer.alloc(16);
    buf.write("ftyp", 4, "latin1");
    buf.write("heic", 8, "latin1");
    expect(isHeic("application/octet-stream", "blob", buf)).toBe(true);
    // A JPEG buffer must NOT be mistaken for HEIC.
    expect(isHeic("application/octet-stream", "blob", DECODED_JPEG)).toBe(
      false,
    );
  });
});

describe("filenameForMime", () => {
  test("rewrites the extension to match the (converted) mime", () => {
    expect(filenameForMime("IMG_1234.HEIC", "image/jpeg")).toBe("IMG_1234.jpg");
    expect(filenameForMime("logo.heif", "image/png")).toBe("logo.png");
  });
  test("falls back to a generic name when none is given", () => {
    expect(filenameForMime(undefined, "image/jpeg")).toBe("image.jpg");
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
    expect(out.converted).toBe(false);
    expect(out.mime_type).toBe("image/jpeg");
    expect(out.buffer.length).toBeLessThan(big.length);

    const meta = await sharp(out.buffer).metadata();
    expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(2400);
    expect(convert).not.toHaveBeenCalled();
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

  test("converts a HEIC upload to a viewable, compressed JPEG", async () => {
    const fakeHeic = Buffer.from("pretend-heic-bytes");
    const out = await compressImage(fakeHeic, "image/heic", "photo.heic");
    expect(convert).toHaveBeenCalledTimes(1);
    expect(out.converted).toBe(true);
    expect(out.mime_type).toBe("image/jpeg");
    const meta = await sharp(out.buffer).metadata();
    expect(meta.format).toBe("jpeg");
  });

  test("surfaces a clean error when HEIC decoding fails", async () => {
    convert.mockRejectedValueOnce(new Error("libheif boom"));
    await expect(
      compressImage(Buffer.from("x"), "image/heic", "a.heic"),
    ).rejects.toThrow(/HEIC/i);
  });
});

describe("compressUpload", () => {
  test("renames a converted HEIC upload to .jpg", async () => {
    const out = await compressUpload({
      buffer: Buffer.from("pretend-heic"),
      mimetype: "image/heic",
      originalname: "IMG_1234.HEIC",
    });
    expect(out.converted).toBe(true);
    expect(out.mime_type).toBe("image/jpeg");
    expect(out.filename).toBe("IMG_1234.jpg");
  });

  test("keeps the original filename for a normal JPEG", async () => {
    const jpeg = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 1, g: 2, b: 3 },
      },
    })
      .jpeg()
      .toBuffer();
    const out = await compressUpload({
      buffer: jpeg,
      mimetype: "image/jpeg",
      originalname: "pic.jpg",
    });
    expect(out.converted).toBe(false);
    expect(out.filename).toBe("pic.jpg");
  });
});

describe("normalizeImageInput", () => {
  test("decodes HEIC to JPEG without the full resize/re-encode", async () => {
    const out = await normalizeImageInput({
      buffer: Buffer.from("pretend-heic"),
      mimetype: "image/heic",
      originalname: "a.heic",
    });
    expect(convert).toHaveBeenCalledTimes(1);
    expect(out.mimetype).toBe("image/jpeg");
    expect(out.originalname).toBe("a.jpg");
    expect(out.converted).toBe(true);
  });

  test("passes a non-HEIC image straight through (same buffer ref)", async () => {
    const jpeg = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 3,
        background: { r: 9, g: 9, b: 9 },
      },
    })
      .jpeg()
      .toBuffer();
    const file = {
      buffer: jpeg,
      mimetype: "image/jpeg",
      originalname: "a.jpg",
    };
    const out = await normalizeImageInput(file);
    expect(out).toBe(file);
    expect(convert).not.toHaveBeenCalled();
  });
});
