"use strict";

/**
 * Outbound image compatibility (services/outbound-image.service).
 *
 * WhatsApp Cloud API accepts only jpeg/png images and Instagram DMs only
 * jpeg/png/gif — WebP (the bundle collage cover format) bounced every
 * bundle share with an opaque "media upload error". These tests pin the
 * transcode boundary: WebP converts to JPEG, accepted formats pass
 * through untouched, and undecodable bytes fall through unchanged (Meta
 * reports the real error).
 */

const sharp = require("sharp");

jest.mock("../../../src/services/storage.service", () => ({
  get: jest.fn(),
  put: jest.fn(async (buf, { key }) => ({ key })),
  absoluteUrl: jest.fn((key) => `https://cdn.example.com/${key}`),
}));

const storage = require("../../../src/services/storage.service");
const outboundImage = require("../../../src/services/outbound-image.service");

async function makeImage(format) {
  const base = sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: { r: 105, g: 9, b: 9 },
    },
  });
  if (format === "webp") return base.webp().toBuffer();
  if (format === "png") return base.png().toBuffer();
  return base.jpeg().toBuffer();
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ensureWhatsAppImage", () => {
  test("transcodes WebP (bundle collage format) to JPEG", async () => {
    const webp = await makeImage("webp");
    const out = await outboundImage.ensureWhatsAppImage({
      buffer: webp,
      mime: "image/webp",
      filename: "classic-trio.webp",
    });
    expect(out.converted).toBe(true);
    expect(out.mime).toBe("image/jpeg");
    expect(out.filename).toBe("classic-trio.jpg");
    expect(await outboundImage.sniffFormat(out.buffer)).toBe("jpeg");
  });

  test("passes JPEG and PNG through untouched", async () => {
    for (const fmt of ["jpeg", "png"]) {
      const buf = await makeImage(fmt);
      const out = await outboundImage.ensureWhatsAppImage({
        buffer: buf,
        mime: `image/${fmt}`,
        filename: `photo.${fmt}`,
      });
      expect(out.converted).toBe(false);
      expect(out.buffer).toBe(buf);
    }
  });

  test("undecodable bytes fall through unchanged (Meta reports the real error)", async () => {
    const junk = Buffer.from("not an image at all");
    const out = await outboundImage.ensureWhatsAppImage({
      buffer: junk,
      mime: "application/octet-stream",
      filename: "x.bin",
    });
    expect(out.converted).toBe(false);
    expect(out.buffer).toBe(junk);
  });
});

describe("ensureInstagramImageUrl", () => {
  test("re-hosts a stored WebP as JPEG and returns the derived URL", async () => {
    const webp = await makeImage("webp");
    storage.get
      .mockResolvedValueOnce(webp) // the source key
      .mockRejectedValueOnce(new Error("ENOENT")); // no cached derived copy yet
    const url = await outboundImage.ensureInstagramImageUrl(
      "/media/bundles/classic-trio.webp",
    );
    expect(storage.put).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        key: "bundles/classic-trio.webp.ig.jpg",
        contentType: "image/jpeg",
      }),
    );
    expect(url).toBe("https://cdn.example.com/bundles/classic-trio.webp.ig.jpg");
  });

  test("reuses the cached derived copy on repeat shares", async () => {
    const webp = await makeImage("webp");
    storage.get
      .mockResolvedValueOnce(webp) // source
      .mockResolvedValueOnce(Buffer.from("cached-jpeg")); // derived copy exists
    const url = await outboundImage.ensureInstagramImageUrl(
      "/media/bundles/classic-trio.webp",
    );
    expect(storage.put).not.toHaveBeenCalled();
    expect(url).toBe("https://cdn.example.com/bundles/classic-trio.webp.ig.jpg");
  });

  test("URLs with an accepted extension short-circuit without a fetch", async () => {
    const url = "https://cdn.example.com/products/wig.jpg";
    expect(await outboundImage.ensureInstagramImageUrl(url)).toBe(url);
    expect(storage.get).not.toHaveBeenCalled();
  });

  test("falls back to the original URL when the bytes can't be loaded", async () => {
    storage.get.mockRejectedValueOnce(new Error("ENOENT"));
    const url = await outboundImage.ensureInstagramImageUrl(
      "/media/bundles/missing.webp",
    );
    expect(url).toBe("/media/bundles/missing.webp");
  });
});
