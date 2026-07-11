"use strict";

/**
 * Chief of Staff adaptive nudge timing (cos.adaptive.js) + wall-clock helpers
 * (cos.time.js) — PR6. Pure, DB-free.
 */

const adaptive = require("../../../src/modules/chief_of_staff/cos.adaptive");
const time = require("../../../src/modules/chief_of_staff/cos.time");

describe("adaptive.preferredHour", () => {
  test("returns the default when there aren't enough samples", () => {
    expect(
      adaptive.preferredHour([9, 10], { defaultHour: 18, workStart: 8, workEnd: 18 }),
    ).toBe(18);
  });

  test("drifts toward the median engaged hour once there's evidence", () => {
    const hours = [16, 16, 17, 16, 17, 16];
    expect(
      adaptive.preferredHour(hours, { defaultHour: 18, workStart: 8, workEnd: 18 }),
    ).toBe(16);
  });

  test("never returns an hour outside work hours (clamps up)", () => {
    const hours = [5, 6, 5, 6, 5]; // pre-work engagements
    const h = adaptive.preferredHour(hours, { defaultHour: 18, workStart: 8, workEnd: 18 });
    expect(h).toBeGreaterThanOrEqual(8);
    expect(h).toBeLessThanOrEqual(18);
  });

  test("clamps down past the end of the work day", () => {
    const hours = [22, 23, 22, 23, 22];
    const h = adaptive.preferredHour(hours, { defaultHour: 18, workStart: 8, workEnd: 18 });
    expect(h).toBe(18);
  });

  test("floorHour ignores morning engagements for an evening review", () => {
    // Morning noise + a few afternoon engagements → only the afternoon counts,
    // but there aren't minSamples afternoon ones, so it falls back to default.
    const hours = [8, 9, 9, 8, 15, 15];
    expect(
      adaptive.preferredHour(hours, { defaultHour: 18, workStart: 8, workEnd: 18, floorHour: 12 }),
    ).toBe(18);
  });

  test("ignores invalid hour values", () => {
    const hours = [16, -1, 99, 16, 16, 16, null, "x"];
    expect(
      adaptive.preferredHour(hours, { defaultHour: 18, workStart: 8, workEnd: 18 }),
    ).toBe(16);
  });

  test("median helper handles odd and even counts", () => {
    expect(adaptive.median([1, 3, 2])).toBe(2);
    expect(adaptive.median([2, 4])).toBe(3);
    expect(adaptive.median([])).toBeNull();
  });
});

describe("time helpers", () => {
  test("parseHour extracts the hour from HH:MM[:SS]", () => {
    expect(time.parseHour("18:00")).toBe(18);
    expect(time.parseHour("07:30:00")).toBe(7);
    expect(time.parseHour("00:00")).toBe(0);
  });

  test("parseHour falls back on garbage", () => {
    expect(time.parseHour("nope", 9)).toBe(9);
    expect(time.parseHour(null, 6)).toBe(6);
    expect(time.parseHour("99:00", 8)).toBe(8);
  });

  test("isQuietHour handles a midnight-wrapping window (21→06)", () => {
    expect(time.isQuietHour(22, 21, 6)).toBe(true);
    expect(time.isQuietHour(3, 21, 6)).toBe(true);
    expect(time.isQuietHour(6, 21, 6)).toBe(false); // end is exclusive
    expect(time.isQuietHour(12, 21, 6)).toBe(false);
  });

  test("isQuietHour handles a same-day window (13→14)", () => {
    expect(time.isQuietHour(13, 13, 14)).toBe(true);
    expect(time.isQuietHour(14, 13, 14)).toBe(false);
    expect(time.isQuietHour(9, 13, 14)).toBe(false);
  });

  test("localHour returns a valid 0–23 hour and tolerates a bad tz", () => {
    const h = time.localHour("Not/AZone", new Date("2026-07-11T10:00:00Z"));
    expect(h).toBe(11); // UTC+1 Lagos fallback
    const lagos = time.localHour("Africa/Lagos", new Date("2026-07-11T23:30:00Z"));
    expect(lagos).toBeGreaterThanOrEqual(0);
    expect(lagos).toBeLessThanOrEqual(23);
  });
});
