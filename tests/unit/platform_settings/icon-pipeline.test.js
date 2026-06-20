"use strict";

/**
 * Icon pipeline — favicon / PWA icon generation from a brand logo.
 * Verifies the dependency-free ICO encoder and the transparency policy
 * (alpha-aware default; best-effort key-out with a warning for opaque
 * sources). Uses sharp to synthesise tiny fixtures so there are no binary
 * assets in the tree.
 */

const sharp = require("sharp");
const {
  generateIconSet,
  encodeIco,
} = require("../../../src/services/icon-pipeline.service");

// A solid red square WITH an alpha channel (already "transparent-capable").
function transparentPng() {
  return sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: { r: 200, g: 30, b: 60, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

// A flat JPEG (no alpha) — the case where we key out the background.
function opaqueJpeg() {
  return sharp({
    create: {
      width: 64,
      height: 64,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .jpeg()
    .toBuffer();
}

describe("encodeIco", () => {
  test("writes a valid ICO header for the supplied PNG entries", () => {
    const fake = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // "‰PNG"
    const ico = encodeIco([
      { size: 16, data: fake },
      { size: 32, data: fake },
    ]);
    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // type: icon
    expect(ico.readUInt16LE(4)).toBe(2); // count
    // First directory entry: width byte at offset 6.
    expect(ico.readUInt8(6)).toBe(16);
    // 256+ sizes are encoded as 0 per the ICO spec.
    const big = encodeIco([{ size: 256, data: fake }]);
    expect(big.readUInt8(6)).toBe(0);
  });
});

describe("generateIconSet", () => {
  test("respects an existing alpha channel (no key-out, no warning)", async () => {
    const set = await generateIconSet(await transparentPng());
    expect(set.transparency.hadAlpha).toBe(true);
    expect(set.transparency.keyed).toBe(false);
    expect(set.transparency.warning).toBeNull();
    // ICO magic: reserved=0, type=1.
    expect(set.faviconIco.readUInt16LE(2)).toBe(1);
    // PWA icons are real PNGs.
    expect(set.icon192.slice(1, 4).toString()).toBe("PNG");
    const meta = await sharp(set.icon512).metadata();
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
  });

  test("keys out the background for an opaque source and warns", async () => {
    const set = await generateIconSet(await opaqueJpeg(), {
      allowKeyOut: true,
    });
    expect(set.transparency.hadAlpha).toBe(false);
    expect(set.transparency.keyed).toBe(true);
    expect(typeof set.transparency.warning).toBe("string");
  });

  test("can be told never to alter pixels", async () => {
    const set = await generateIconSet(await opaqueJpeg(), {
      allowKeyOut: false,
    });
    expect(set.transparency.keyed).toBe(false);
    expect(set.transparency.warning).toMatch(/transparent/i);
  });
});
