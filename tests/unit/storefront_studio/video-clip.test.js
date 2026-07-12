"use strict";

const {
  planClip,
  clampTrim,
  cropRect,
  fitScale,
  MAX_CLIP_SECONDS,
} = require("../../../src/services/video-clip.service");

describe("video-clip — clampTrim", () => {
  test("caps the window at MAX_CLIP_SECONDS", () => {
    const t = clampTrim({ duration_sec: 60, trim_start: 5, trim_end: 40 });
    expect(t.start).toBe(5);
    expect(t.duration).toBe(MAX_CLIP_SECONDS);
  });
  test("missing window falls back to the head of the video", () => {
    const t = clampTrim({ duration_sec: 47 });
    expect(t.start).toBe(0);
    expect(t.duration).toBe(MAX_CLIP_SECONDS);
  });
  test("short videos keep their full length", () => {
    const t = clampTrim({ duration_sec: 6.4 });
    expect(t.start).toBe(0);
    expect(t.duration).toBeCloseTo(6.4, 2);
  });
  test("end clamped to the source duration", () => {
    const t = clampTrim({ duration_sec: 8, trim_start: 4, trim_end: 99 });
    expect(t.start).toBe(4);
    expect(t.duration).toBe(4);
  });
  test("garbage start/end never escapes the source", () => {
    const t = clampTrim({ duration_sec: 12, trim_start: -3, trim_end: "nope" });
    expect(t.start).toBe(0);
    expect(t.duration).toBe(MAX_CLIP_SECONDS);
  });
  test("start beyond the end is pulled back inside", () => {
    const t = clampTrim({ duration_sec: 10, trim_start: 30, trim_end: 31 });
    expect(t.start).toBeLessThan(10);
    expect(t.duration).toBeGreaterThan(0);
  });
  test("unreadable duration throws the platform error", () => {
    expect(() => clampTrim({ duration_sec: NaN })).toThrow(
      "no readable duration",
    );
  });
});

describe("video-clip — cropRect", () => {
  test("original aspect means no crop", () => {
    expect(
      cropRect({ width: 1920, height: 1080, aspect: "original", focus: 0.5 }),
    ).toBeNull();
  });
  test("already at target ratio means no crop", () => {
    expect(
      cropRect({ width: 1920, height: 1080, aspect: "16:9", focus: 0.5 }),
    ).toBeNull();
  });
  test("wide source cropped square, centred", () => {
    const c = cropRect({ width: 1920, height: 1080, aspect: "1:1", focus: 0.5 });
    expect(c).toEqual({ x: 420, y: 0, w: 1080, h: 1080 });
  });
  test("focus 0 pins the crop to the left edge", () => {
    const c = cropRect({ width: 1920, height: 1080, aspect: "1:1", focus: 0 });
    expect(c.x).toBe(0);
  });
  test("focus 1 pins the crop to the right edge and stays in frame", () => {
    const c = cropRect({ width: 1920, height: 1080, aspect: "1:1", focus: 1 });
    expect(c.x + c.w).toBeLessThanOrEqual(1920);
    expect(c.x).toBe(1920 - c.w);
  });
  test("tall source (portrait phone) cropped to 16:9 crops top/bottom", () => {
    const c = cropRect({ width: 1080, height: 1920, aspect: "16:9", focus: 0.5 });
    expect(c.w).toBe(1080);
    expect(c.h).toBeLessThan(1920);
    expect(c.x).toBe(0);
    expect(c.h % 2).toBe(0);
  });
  test("all rect values are even (yuv420 requirement)", () => {
    const c = cropRect({ width: 1919, height: 1079, aspect: "4:5", focus: 0.33 });
    for (const v of [c.x, c.y, c.w, c.h]) expect(v % 2).toBe(0);
  });
});

describe("video-clip — fitScale", () => {
  test("caps the long edge, keeps aspect, even dims", () => {
    const s = fitScale({ width: 3840, height: 2160, edge: 1280 });
    expect(s).toEqual({ width: 1280, height: 720 });
  });
  test("never upscales a small source", () => {
    const s = fitScale({ width: 640, height: 360, edge: 1280 });
    expect(s).toEqual({ width: 640, height: 360 });
  });
  test("portrait video caps by height", () => {
    const s = fitScale({ width: 1080, height: 1920, edge: 720 });
    expect(s.height).toBe(720);
    expect(s.width).toBeLessThanOrEqual(406);
    expect(s.width % 2).toBe(0);
  });
});

describe("video-clip — planClip", () => {
  const source = { duration_sec: 32, width: 3840, height: 2160, fps: 60, rotation: 0 };

  test("full plan: trim, crop, two renditions, fps cap", () => {
    const p = planClip({
      source,
      trim_start: "2.5",
      trim_end: "30",
      aspect: "16:9",
      focus: "0.5",
    });
    expect(p.trim).toEqual({ start: 2.5, duration: MAX_CLIP_SECONDS });
    expect(p.crop).toBeNull(); // already 16:9
    expect(p.outputs.hd).toMatchObject({ width: 1280, height: 720 });
    expect(p.outputs.sd).toMatchObject({ width: 720, height: 404 });
    expect(p.capFps).toBe(true);
  });

  test("24fps source is not resampled", () => {
    const p = planClip({ source: { ...source, fps: 24 }, aspect: "original" });
    expect(p.capFps).toBe(false);
  });

  test("rotated phone video swaps its planning dimensions", () => {
    const p = planClip({
      source: { duration_sec: 9, width: 1920, height: 1080, fps: 30, rotation: -90 },
      aspect: "9:16",
    });
    // Display frame is 1080x1920 → already 9:16 → no crop needed.
    expect(p.crop).toBeNull();
    expect(p.outputs.hd.height).toBe(1280);
  });

  test("missing dimensions throw the platform error", () => {
    expect(() =>
      planClip({ source: { duration_sec: 5, width: null, height: null } }),
    ).toThrow("no video stream");
  });
});
