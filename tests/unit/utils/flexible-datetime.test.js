/**
 * flexDatetime / parseFlexDatetime — the shapes that used to 400.
 *
 * The CoS emits Lagos offsets ("+01:00"), the admin modals emit UTC ("Z"),
 * models sometimes drop the zone entirely, and bare dates arrive from
 * "due Friday" phrasing. All must parse to the same UTC instant; garbage
 * must still fail loudly.
 */

"use strict";

// Pin the business timezone so assertions hold on any CI machine.
process.env.TZ = "Africa/Lagos";

const { z } = require("zod");
const {
  flexDatetime,
  parseFlexDatetime,
} = require("../../../src/utils/validation");

describe("parseFlexDatetime", () => {
  test("accepts UTC (Z)", () => {
    expect(parseFlexDatetime("2026-07-17T18:00:00Z")).toBe(
      "2026-07-17T18:00:00.000Z",
    );
  });

  test("accepts a +01:00 offset (the CoS failure case) and normalises to UTC", () => {
    expect(parseFlexDatetime("2026-07-17T18:00:00+01:00")).toBe(
      "2026-07-17T17:00:00.000Z",
    );
  });

  test("accepts a negative offset", () => {
    expect(parseFlexDatetime("2026-07-17T12:00:00-05:00")).toBe(
      "2026-07-17T17:00:00.000Z",
    );
  });

  test("accepts zoneless local datetimes as Lagos wall clock", () => {
    // Africa/Lagos is UTC+1 year-round (no DST).
    expect(parseFlexDatetime("2026-07-17T18:00")).toBe(
      "2026-07-17T17:00:00.000Z",
    );
    expect(parseFlexDatetime("2026-07-17T18:00:30")).toBe(
      "2026-07-17T17:00:30.000Z",
    );
  });

  test("accepts a space separator between date and time", () => {
    expect(parseFlexDatetime("2026-07-17 18:00")).toBe(
      "2026-07-17T17:00:00.000Z",
    );
  });

  test("bare dates need dateOnlyTime and land at that Lagos wall-clock time", () => {
    expect(parseFlexDatetime("2026-07-17")).toBeNull();
    expect(
      parseFlexDatetime("2026-07-17", { dateOnlyTime: "17:00:00" }),
    ).toBe("2026-07-17T16:00:00.000Z");
  });

  test("rejects garbage", () => {
    expect(parseFlexDatetime("not a date")).toBeNull();
    expect(parseFlexDatetime("2026-13-45T99:99:99Z")).toBeNull();
    expect(parseFlexDatetime("18:00")).toBeNull();
    expect(parseFlexDatetime(1234)).toBeNull();
    expect(parseFlexDatetime(null)).toBeNull();
  });
});

describe("flexDatetime (Zod schema)", () => {
  const schema = flexDatetime({ dateOnlyTime: "17:00:00" });

  test("parses every accepted shape to a UTC ISO string", () => {
    expect(schema.parse("2026-07-17T18:00:00+01:00")).toBe(
      "2026-07-17T17:00:00.000Z",
    );
    expect(schema.parse("2026-07-17")).toBe("2026-07-17T16:00:00.000Z");
  });

  test("throws a helpful message on garbage", () => {
    const r = schema.safeParse("whenever");
    expect(r.success).toBe(false);
    expect(r.error.issues[0].message).toMatch(/ISO 8601/);
  });

  test("composes with .nullable().optional() like the task validator uses it", () => {
    const s = z.object({ due_at: schema.nullable().optional() }).strict();
    expect(s.parse({})).toEqual({});
    expect(s.parse({ due_at: null })).toEqual({ due_at: null });
    expect(s.parse({ due_at: "2026-07-17T18:00:00+01:00" })).toEqual({
      due_at: "2026-07-17T17:00:00.000Z",
    });
  });
});
