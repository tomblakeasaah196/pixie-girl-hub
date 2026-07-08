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

  test("parsePriceConstraint reads an upper bound and its currency", () => {
    const p = _internal.parsePriceConstraint;
    expect(p("Any I can get less than 280 dollars?")).toEqual({
      currency: "USD",
      max: 280,
    });
    expect(p("anything below $280")).toEqual({ currency: "USD", max: 280 });
    expect(p("under ₦200k")).toEqual({ currency: "NGN", max: 200000 });
    expect(p("cheaper than 150000 naira")).toEqual({
      currency: "NGN",
      max: 150000,
    });
    // No explicit currency → magnitude decides (USD is the small-number range).
    expect(p("under 300")).toEqual({ currency: "USD", max: 300 });
    expect(p("below 250000")).toEqual({ currency: "NGN", max: 250000 });
    // Not a price ceiling at all.
    expect(p("something warmer please")).toBeNull();
    expect(p("")).toBeNull();
  });

  test("withinBudget filters by the constraint's currency and excludes unpriced", () => {
    const w = _internal.withinBudget;
    const prod = { effective_price_usd: 281, effective_price_ngn: 420000 };
    expect(w(prod, { currency: "USD", max: 280 })).toBe(false);
    expect(w(prod, { currency: "USD", max: 300 })).toBe(true);
    expect(w({ effective_price_ngn: "199000" }, { currency: "NGN", max: 200000 })).toBe(true);
    // Unpriced in the requested currency is excluded from a budget query.
    expect(w({ effective_price_ngn: 100 }, { currency: "USD", max: 500 })).toBe(false);
    // No constraint → everything passes.
    expect(w(prod, null)).toBe(true);
  });

  test("isRefinement detects requests to move off the current shade", () => {
    const r = _internal.isRefinement;
    expect(r("Could we try something warmer?")).toBe(true);
    expect(r("anything different")).toBe(true);
    expect(r("show me a cooler one")).toBe(true);
    expect(r("What do you suggest for my skin tone?")).toBe(false);
    expect(r("thanks!")).toBe(false);
  });

  test("resolveBudget remembers, replaces and releases a stated budget", () => {
    const rb = _internal.resolveBudget;
    const saved = { currency: "NGN", max: 200000 };
    // A fresh bound is applied AND saved.
    expect(rb({ text: "under ₦200k please", saved: null })).toEqual({
      constraint: saved,
      save: saved,
    });
    // A later turn without a price keeps honouring the saved bound.
    expect(rb({ text: "okay show me the braids", saved })).toEqual({
      constraint: saved,
      save: saved,
    });
    // A new bound replaces the old one.
    expect(rb({ text: "make it under $150", saved }).constraint).toEqual({
      currency: "USD",
      max: 150,
    });
    // An explicit release clears both.
    expect(rb({ text: "actually any price is fine", saved })).toEqual({
      constraint: null,
      save: null,
    });
    expect(rb({ text: "forget the budget", saved }).save).toBeNull();
    // Nothing stated, nothing saved → no constraint.
    expect(rb({ text: "hello", saved: null })).toEqual({
      constraint: null,
      save: null,
    });
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

  describe("toWhatsAppDigits", () => {
    const wa = _internal.toWhatsAppDigits;

    test("converts a local Nigerian number (leading 0) to wa.me digits", () => {
      expect(wa("08061987874")).toBe("2348061987874");
    });

    test("strips punctuation from an already-international number", () => {
      expect(wa("+234 806 198 7874")).toBe("2348061987874");
    });

    test("strips spaces/dashes without a leading zero or +", () => {
      expect(wa("234-806-198-7874")).toBe("2348061987874");
    });

    test("returns null for empty/missing input", () => {
      expect(wa("")).toBeNull();
      expect(wa(null)).toBeNull();
      expect(wa(undefined)).toBeNull();
      expect(wa("no digits here")).toBeNull();
    });
  });
});
