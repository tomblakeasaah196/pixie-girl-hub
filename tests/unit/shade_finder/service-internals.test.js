"use strict";

// Pure internals only — no Redis/Gemini/DB. The config module needs env to
// parse, so reuse whatever the test setup provides (jest.setup sets the
// required vars for the rest of the unit suite).
const {
  _internal,
} = require("../../../src/modules/shade_finder/shade-finder.service");

describe("shade finder service internals", () => {
  test("lagosDay pins the calendar day to UTC+1", () => {
    // 23:30 UTC on Jan 1 is already Jan 2 in Lagos.
    const t = Date.UTC(2026, 0, 1, 23, 30, 0);
    expect(_internal.lagosDay(t)).toBe("2026-01-02");
    // 22:30 UTC is still Jan 1 in Lagos.
    expect(_internal.lagosDay(Date.UTC(2026, 0, 1, 22, 30, 0))).toBe(
      "2026-01-01",
    );
  });

  test("secondsToLagosMidnight counts down to the Lagos reset", () => {
    // 22:00 UTC = 23:00 Lagos → one hour to midnight.
    const t = Date.UTC(2026, 0, 1, 22, 0, 0);
    expect(_internal.secondsToLagosMidnight(t)).toBe(3600);
  });

  test("parseModelJson tolerates fenced output", () => {
    expect(_internal.parseModelJson('{"a":1}')).toEqual({ a: 1 });
    expect(_internal.parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(_internal.parseModelJson("no json here")).toBeNull();
  });

  test("hydrate maps enum slugs to catalogue rows and deeplinks", () => {
    const shades = [
      { shade_id: "s1", name: "Espresso", slug: "espresso", swatches: [] },
      { shade_id: "s2", name: "Icy", slug: "icy", swatches: [] },
    ];
    const products = [
      { styled_id: "p1", shade_id: "s1", name: "Wig A", slug: "wig-a", colours: [] },
      { styled_id: "p2", shade_id: "s1", name: "Wig B", slug: "wig-b", colours: [] },
    ];
    const out = _internal.hydrate({
      advice: {
        message: "You are an espresso woman.",
        recommended_shade_slug: "espresso",
        alternate_shade_slugs: ["icy", "espresso"],
        product_slugs: ["wig-b", "ghost-slug"],
        confidence: "high",
      },
      shades,
      products,
    });
    expect(out.shade.slug).toBe("espresso");
    expect(out.shade.deeplink).toBe("/shades/espresso");
    // the recommended shade never repeats in alternates; ghosts are dropped
    expect(out.alternates.map((a) => a.slug)).toEqual(["icy"]);
    expect(out.products.map((p) => p.slug)).toEqual(["wig-b"]);
    expect(out.products[0].deeplink).toBe("/product/wig-b");
  });

  test("hydrate falls back to the shade's own styles when picks are unusable", () => {
    const shades = [{ shade_id: "s1", name: "Espresso", slug: "espresso", swatches: [] }];
    const products = [
      { styled_id: "p1", shade_id: "s1", name: "Wig A", slug: "wig-a", colours: [] },
    ];
    const out = _internal.hydrate({
      advice: {
        message: "…",
        recommended_shade_slug: "espresso",
        product_slugs: ["ghost"],
        confidence: "medium",
      },
      shades,
      products,
    });
    expect(out.products.map((p) => p.slug)).toEqual(["wig-a"]);
  });
});
