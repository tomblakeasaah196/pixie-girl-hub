"use strict";

// Pure internals only — no Redis/Gemini/DB, mirrors
// tests/unit/shade_finder/service-internals.test.js's approach for the same
// kind of stateless-turn AI feature.
const {
  _internal,
} = require("../../../src/modules/storefront/ai-search.service");

describe("shop ai search internals", () => {
  test("lagosDay pins the calendar day to UTC+1", () => {
    const t = Date.UTC(2026, 0, 1, 23, 30, 0);
    expect(_internal.lagosDay(t)).toBe("2026-01-02");
    expect(_internal.lagosDay(Date.UTC(2026, 0, 1, 22, 30, 0))).toBe(
      "2026-01-01",
    );
  });

  test("secondsToLagosMidnight counts down to the Lagos reset", () => {
    const t = Date.UTC(2026, 0, 1, 22, 0, 0);
    expect(_internal.secondsToLagosMidnight(t)).toBe(3600);
  });

  test("parseModelJson tolerates fenced output and rejects prose", () => {
    expect(_internal.parseModelJson('{"a":1}')).toEqual({ a: 1 });
    expect(_internal.parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(_internal.parseModelJson("no json here")).toBeNull();
  });

  test("publicMatch resolves an enum value to its catalogue row, or null", () => {
    const shades = [{ slug: "honey-blonde", name: "Honey Blonde" }];
    expect(_internal.publicMatch(shades, "slug", "honey-blonde")).toEqual(
      shades[0],
    );
    expect(_internal.publicMatch(shades, "slug", "")).toBeNull();
    expect(_internal.publicMatch(shades, "slug", undefined)).toBeNull();
    // The model can only emit enum values, but a ghost slug still resolves
    // to null rather than throwing.
    expect(_internal.publicMatch(shades, "slug", "ghost")).toBeNull();
  });

  test("deviceKeyFrom hashes device_id when present, else falls back to ip", () => {
    const a = _internal.deviceKeyFrom({ device_id: "abc", ip: "1.2.3.4" });
    const b = _internal.deviceKeyFrom({ device_id: "abc", ip: "9.9.9.9" });
    const c = _internal.deviceKeyFrom({ device_id: "", ip: "1.2.3.4" });
    expect(a).toBe(b); // device_id wins over ip when present
    expect(a).not.toBe(c); // no device_id → falls back to ip, so keys differ
    expect(a).toHaveLength(32);
  });
});
