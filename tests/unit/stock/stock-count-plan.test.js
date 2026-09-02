"use strict";

/**
 * The planning half of `scripts/import-stock-count.js` — matched rows + the
 * current shelf → the lines of a `count` adjustment.
 *
 * This is the code that can do damage: every line becomes a stock movement
 * once the adjustment is posted, and under `unlisted: 'zero'` a product the
 * sheet never named is written down to nil. So the tests below pin the
 * fail-closed behaviour rather than the happy path:
 *   · a counted number REPLACES the system's, it is never added to it;
 *   · anything ambiguous (two stocked variants, two stocked locations) is
 *     reported, never resolved by guesswork;
 *   · an unmatched row blocks the whole run, because with unlisted=zero it
 *     would otherwise read as "we hold none of this".
 */

const {
  resolveVariant,
  resolveLocation,
  buildLines,
  summarise,
  blockers,
} = require("../../../scripts/lib/stock-count-plan");

const variant = (sku, on_hand, extra = {}) => ({
  variant_id: `var-${sku}`,
  sku,
  variant_name: sku,
  on_hand,
  reserved: 0,
  is_active: true,
  ...extra,
});

const location = (display_name, on_hand, extra = {}) => ({
  location_id: `loc-${display_name.toLowerCase().replace(/\W/g, "")}`,
  display_name,
  on_hand,
  is_default: false,
  is_active: true,
  ...extra,
});

const hit = (product_id, units, row = 2) => ({
  row,
  units,
  product: { product_id, name: product_id },
});

// ── variant resolution ───────────────────────────────────

describe("resolveVariant", () => {
  test("takes the one variant holding stock", () => {
    const r = resolveVariant([variant("A", 0), variant("B", 5)]);
    expect(r.variant.sku).toBe("B");
  });

  test("falls back to the first variant when nothing is on the shelf", () => {
    const r = resolveVariant([variant("A", 0), variant("B", 0)]);
    expect(r.variant.sku).toBe("A");
  });

  test("refuses to choose when stock is spread across variants", () => {
    const r = resolveVariant([variant("A", 3), variant("B", 5)]);
    expect(r.variant).toBeUndefined();
    expect(r.error).toMatch(/spread across 2 variants/);
  });

  test("reports a base product that cannot hold stock at all", () => {
    expect(resolveVariant([]).error).toMatch(/no stock-bearing variant/);
  });
});

// ── location resolution ──────────────────────────────────

describe("resolveLocation", () => {
  const warehouse = location("Main Warehouse", 300, { is_default: true });
  const showroom = location("Showroom", 40);

  test("uses the only location holding stock", () => {
    expect(
      resolveLocation([warehouse, location("Showroom", 0)], null, "zero")
        .display_name,
    ).toBe("Main Warehouse");
  });

  test("refuses to guess between two stocked locations when zeroing", () => {
    expect(() => resolveLocation([warehouse, showroom], null, "zero")).toThrow(
      /Stock sits at 2 locations/,
    );
  });

  test("two stocked locations are fine when nothing gets zeroed", () => {
    expect(
      resolveLocation([warehouse, showroom], null, "skip").display_name,
    ).toBe("Main Warehouse");
  });

  test("an explicitly named location wins, by name or by id", () => {
    expect(
      resolveLocation([warehouse, showroom], "showroom", "zero").display_name,
    ).toBe("Showroom");
    expect(
      resolveLocation([warehouse, showroom], showroom.location_id, "zero")
        .display_name,
    ).toBe("Showroom");
  });

  test("a name that matches nothing is an error, not a fallback", () => {
    expect(() => resolveLocation([warehouse], "Lagos Annex", "zero")).toThrow(
      /No stock location matching/,
    );
  });
});

// ── line building ────────────────────────────────────────

describe("buildLines", () => {
  const levels = () =>
    new Map([
      ["wig-a", [variant("A", 9)]],
      ["wig-b", [variant("B", 2)]],
      ["wig-c", [variant("C", 4)]],
    ]);

  test("the counted number replaces the system's — it is never added", () => {
    const { lines } = buildLines({
      matched: [hit("wig-a", 2)],
      levelsByProduct: levels(),
      unlisted: "skip",
      matchedProductIds: new Set(["wig-a"]),
    });
    expect(lines).toHaveLength(1);
    // 9 on the system, 2 counted → the adjustment moves -7 and lands on 2.
    expect(lines[0]).toMatchObject({ system_count: 9, physical_count: 2 });
    expect(lines[0].physical_count - lines[0].system_count).toBe(-7);
  });

  test("a product already at the counted number produces no line", () => {
    const { lines, unchanged } = buildLines({
      matched: [hit("wig-b", 2)],
      levelsByProduct: levels(),
      unlisted: "skip",
      matchedProductIds: new Set(["wig-b"]),
    });
    expect(lines).toHaveLength(0);
    expect(unchanged).toHaveLength(1);
  });

  test("unlisted=zero writes down every stocked product the sheet never named", () => {
    const { lines } = buildLines({
      matched: [hit("wig-a", 2)],
      levelsByProduct: levels(),
      unlisted: "zero",
      matchedProductIds: new Set(["wig-a"]),
    });
    const zeroed = lines.filter((l) => l.kind === "unlisted");
    expect(zeroed.map((l) => l.variant.sku).sort()).toEqual(["B", "C"]);
    expect(zeroed.every((l) => l.physical_count === 0)).toBe(true);
  });

  test("unlisted=skip leaves un-counted products alone", () => {
    const { lines } = buildLines({
      matched: [hit("wig-a", 2)],
      levelsByProduct: levels(),
      unlisted: "skip",
      matchedProductIds: new Set(["wig-a"]),
    });
    expect(lines.filter((l) => l.kind === "unlisted")).toHaveLength(0);
  });

  test("a product counted but blank (skipped) is not then zeroed as unlisted", () => {
    // A blank row under --blank=skip still marks the product as SEEN, so the
    // unlisted sweep must not double back and write it down to nil.
    const { lines } = buildLines({
      matched: [hit("wig-a", 2)],
      levelsByProduct: levels(),
      unlisted: "zero",
      matchedProductIds: new Set(["wig-a", "wig-b"]),
    });
    expect(lines.filter((l) => l.variant.sku === "B")).toHaveLength(0);
    expect(lines.filter((l) => l.variant.sku === "C")).toHaveLength(1);
  });

  test("a product already at zero is not given a pointless zero line", () => {
    const { lines } = buildLines({
      matched: [],
      levelsByProduct: new Map([["wig-d", [variant("D", 0)]]]),
      unlisted: "zero",
      matchedProductIds: new Set(),
    });
    expect(lines).toHaveLength(0);
  });

  test("an ambiguous product is reported, not counted", () => {
    const { lines, problems } = buildLines({
      matched: [hit("wig-x", 5)],
      levelsByProduct: new Map([
        ["wig-x", [variant("X1", 3), variant("X2", 4)]],
      ]),
      unlisted: "skip",
      matchedProductIds: new Set(["wig-x"]),
    });
    expect(lines).toHaveLength(0);
    expect(problems[0].error).toMatch(/spread across 2 variants/);
  });
});

// ── summary + interlocks ─────────────────────────────────

describe("summarise", () => {
  test("splits surplus from write-down and nets them", () => {
    expect(
      summarise([
        { system_count: 9, physical_count: 2 }, // -7
        { system_count: 1, physical_count: 4 }, // +3
      ]),
    ).toEqual({ surplus: 3, writeDown: 7, net: -4 });
  });
});

describe("blockers", () => {
  const none = { conflicts: [], badRows: [], unmatched: [], problems: [] };

  test("a clean run has nothing blocking it", () => {
    expect(blockers(none)).toEqual([]);
  });

  test("an unmatched row blocks the run", () => {
    expect(blockers({ ...none, unmatched: [{}, {}] })[0]).toMatch(
      /2 row\(s\) matched no base product/,
    );
  });

  test("every category of problem is surfaced, not just the first", () => {
    expect(
      blockers({
        conflicts: [{}],
        badRows: [{}],
        unmatched: [{}],
        problems: [{}],
      }),
    ).toHaveLength(4);
  });
});
