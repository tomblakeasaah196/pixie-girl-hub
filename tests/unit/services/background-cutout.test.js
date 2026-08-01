"use strict";

/**
 * Background cut-out (services/background-cutout.service).
 *
 * The self-hosted AI engine (@imgly/background-removal-node) is intentionally
 * not a committed dependency, so in CI these exercise the fallback paths:
 *   • a flat, solid backdrop is keyed out to transparency (engine 'keyer'),
 *   • an image that already carries alpha is respected untouched ('alpha'),
 * and the output is always a transparent PNG within the size cap.
 */

const sharp = require("sharp");
const {
  isolateSubject,
  tryAiCutout,
  CUTOUT_MAX_EDGE,
} = require("../../../src/services/background-cutout.service");

/** A white canvas (keyable corners) with a red block subject, as a JPEG so it
 *  carries no alpha channel — forcing the keyer path when no AI engine exists. */
async function flatBackdropJpeg() {
  const subject = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "#ff0000" },
  })
    .png()
    .toBuffer();
  return sharp({
    create: { width: 48, height: 48, channels: 3, background: "#ffffff" },
  })
    .composite([{ input: subject, top: 16, left: 16 }])
    .jpeg()
    .toBuffer();
}

test("tryAiCutout returns null when the AI engine is not installed", async () => {
  const input = await flatBackdropJpeg();
  await expect(tryAiCutout(input)).resolves.toBeNull();
});

test("isolateSubject keys out a flat backdrop to a transparent PNG", async () => {
  const res = await isolateSubject(await flatBackdropJpeg());

  expect(res.engine).toBe("keyer");
  expect(res.keyed).toBe(true);
  expect(res.warning).toEqual(expect.any(String));

  const { data, info } = await sharp(res.buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(info.channels).toBe(4);
  // Top-left corner was the white backdrop → now fully transparent.
  expect(data[3]).toBe(0);
});

test("isolateSubject respects an image that already has transparency", async () => {
  const png = await sharp({
    create: {
      width: 24,
      height: 24,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();

  const res = await isolateSubject(png);
  expect(["ai", "alpha"]).toContain(res.engine);
  expect(res.keyed).toBe(false);
});

test("isolateSubject caps the cut-out to the max edge", async () => {
  const big = await sharp({
    create: {
      width: CUTOUT_MAX_EDGE + 800,
      height: CUTOUT_MAX_EDGE + 400,
      channels: 3,
      background: "#ffffff",
    },
  })
    .jpeg()
    .toBuffer();

  const res = await isolateSubject(big);
  expect(Math.max(res.width, res.height)).toBeLessThanOrEqual(CUTOUT_MAX_EDGE);
});

test("isolateSubject rejects empty input", async () => {
  await expect(isolateSubject(Buffer.alloc(0))).rejects.toThrow();
});
