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

  // Gemini 400s on degenerate enums (empty-string members / empty lists) —
  // the schema must stay as clean as shade-finder's advise schema, which is
  // the known-working contract in production.
  describe("searchSchema", () => {
    test("omits facet matchers whose catalogue list is empty", () => {
      const s = _internal.searchSchema({
        slugs: ["wig-a"],
        collectionSlugs: [],
        bundleCodes: [],
        shadeSlugs: ["icy"],
      });
      expect(s.properties.matched_collection_slug).toBeUndefined();
      expect(s.properties.matched_bundle_code).toBeUndefined();
      expect(s.properties.matched_shade_slug.enum).toEqual(["icy"]);
      expect(s.required).toEqual(["message", "product_slugs"]);
    });

    test("never embeds empty-string enum members", () => {
      const s = _internal.searchSchema({
        slugs: ["wig-a"],
        collectionSlugs: ["bridal"],
        bundleCodes: ["GLOW-3PC"],
        shadeSlugs: ["icy"],
      });
      for (const key of [
        "matched_collection_slug",
        "matched_bundle_code",
        "matched_shade_slug",
      ]) {
        expect(s.properties[key].enum).not.toContain("");
        expect(s.properties[key].enum.length).toBeGreaterThan(0);
      }
      expect(s.properties.product_slugs.items.enum).toEqual(["wig-a"]);
    });
  });
});
