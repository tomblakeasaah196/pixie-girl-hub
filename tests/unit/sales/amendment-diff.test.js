"use strict";

// Change Order diffing (§6.2). The three answers this module owns are the ones
// the rest of the amendment is built on:
//   • what changed, line by line;
//   • the NET stock movement per variant — the only figure the reconciler is
//     allowed to act on;
//   • what the customer is told.
// Everything here is pure, so each branch is pinned without a database.

const {
  buildLineChanges,
  netVariantDelta,
  summariseChanges,
  describeLine,
  deliveryChanged,
} = require("../../../src/modules/sales/pricing/amendment-diff");

const before = (over = {}) => ({
  line_id: "line-A",
  variant_id: "var-A",
  product_name_snapshot: "Classic Full Frontal",
  variant_label_snapshot: "Black · Medium",
  quantity: 1,
  unit_price_ngn: "389000.00",
  ...over,
});
const after = (over = {}) => ({
  _source_line_id: "line-A",
  variant_id: "var-A",
  product_name_snapshot: "Classic Full Frontal",
  variant_label_snapshot: "Black · Medium",
  quantity: 1,
  unit_price_ngn: "389000.00",
  ...over,
});

describe("describeLine", () => {
  test("joins the product and its variant spec", () => {
    expect(describeLine(before())).toBe(
      "Classic Full Frontal — Black · Medium",
    );
  });
  test("falls back to the product name alone", () => {
    expect(describeLine(before({ variant_label_snapshot: null }))).toBe(
      "Classic Full Frontal",
    );
  });
});

describe("buildLineChanges", () => {
  test("an untouched order produces no changes at all", () => {
    expect(buildLineChanges([before()], [after()])).toEqual([]);
  });

  test("the wrong-product swap reads as one removal and one addition", () => {
    const changes = buildLineChanges(
      [before()],
      [
        after({
          _source_line_id: null,
          variant_id: "var-B",
          product_name_snapshot: "Styled Bodywave",
          variant_label_snapshot: "Copper · Medium",
          unit_price_ngn: "520000.00",
        }),
      ],
    );
    expect(changes.map((c) => c.action)).toEqual(["removed", "added"]);
    expect(changes[0].name).toBe("Classic Full Frontal — Black · Medium");
    expect(changes[1].name).toBe("Styled Bodywave — Copper · Medium");
  });

  test("a quantity change keeps the line and reports from → to", () => {
    const changes = buildLineChanges([before()], [after({ quantity: 3 })]);
    expect(changes).toEqual([
      {
        action: "quantity",
        line_id: "line-A",
        name: "Classic Full Frontal — Black · Medium",
        from: 1,
        to: 3,
      },
    ]);
  });

  test("a price change is reported separately from quantity", () => {
    const changes = buildLineChanges(
      [before()],
      [after({ quantity: 2, unit_price_ngn: "400000.00" })],
    );
    expect(changes.map((c) => c.action)).toEqual(["quantity", "price"]);
  });

  test("'389000' and '389000.00' are the same price, not a change", () => {
    // The stored column is NUMERIC(14,2) and the client posts a plain number;
    // a string comparison here would flag every untouched line as re-priced.
    const changes = buildLineChanges(
      [before({ unit_price_ngn: "389000.00" })],
      [after({ unit_price_ngn: "389000" })],
    );
    expect(changes).toEqual([]);
  });
});

describe("netVariantDelta", () => {
  test("a swap is one variant down and another up", () => {
    const d = netVariantDelta(
      [before()],
      [after({ _source_line_id: null, variant_id: "var-B" })],
    );
    expect(d.get("var-A")).toBe(-1);
    expect(d.get("var-B")).toBe(1);
  });

  test("bumping the same variant nets to the difference, not a churn", () => {
    // The reason the reconciler works per VARIANT: releasing 1 and re-reserving
    // 3 would fail on the last unit in stock, when all the order actually needs
    // is 2 more.
    const d = netVariantDelta([before()], [after({ quantity: 3 })]);
    expect(d.get("var-A")).toBe(2);
    expect(d.size).toBe(1);
  });

  test("swapping one size of a base for another of the SAME variant is a no-op", () => {
    const d = netVariantDelta(
      [before({ line_id: "line-A" })],
      [after({ _source_line_id: null })], // re-added as a new line, same variant
    );
    expect(d.size).toBe(0);
  });

  test("service lines carry no stock and never appear", () => {
    const d = netVariantDelta(
      [before({ variant_id: null, line_id: "svc" })],
      [],
    );
    expect(d.size).toBe(0);
  });

  test("removing everything returns the whole order to stock", () => {
    const d = netVariantDelta(
      [before(), before({ line_id: "line-B", variant_id: "var-B", quantity: 2 })],
      [],
    );
    expect(d.get("var-A")).toBe(-1);
    expect(d.get("var-B")).toBe(-2);
  });
});

describe("summariseChanges — what the customer is told", () => {
  test("names the item that went and the one that came", () => {
    const changes = buildLineChanges(
      [before()],
      [
        after({
          _source_line_id: null,
          variant_id: "var-B",
          product_name_snapshot: "Styled Bodywave",
          variant_label_snapshot: "Copper · Medium",
        }),
      ],
    );
    const text = summariseChanges(changes);
    expect(text).toContain("Removed: Classic Full Frontal — Black · Medium ×1");
    expect(text).toContain("Added: Styled Bodywave — Copper · Medium ×1");
  });

  test("a delivery-only amendment summarises to nothing, so the caller can word it", () => {
    expect(summariseChanges([])).toBe("");
  });

  test("never leaks a price figure for a re-price", () => {
    // The customer sees the new total; quoting the old unit price back at her
    // invites an argument the sales rep hasn't had yet.
    const changes = buildLineChanges(
      [before()],
      [after({ unit_price_ngn: "400000.00" })],
    );
    const text = summariseChanges(changes);
    expect(text).toBe("Price updated: Classic Full Frontal — Black · Medium.");
    expect(text).not.toContain("389000");
    expect(text).not.toContain("400000");
  });
});

describe("deliveryChanged", () => {
  const addr = {
    line1: "12 Admiralty Way",
    city: "Lekki",
    state: "Lagos",
    country: "Nigeria",
  };
  test("no patch at all is not a change", () => {
    expect(deliveryChanged(addr, null)).toBe(false);
  });
  test("re-submitting the same address is not a change", () => {
    expect(deliveryChanged(addr, { ...addr })).toBe(false);
  });
  test("a moved street is a change", () => {
    expect(deliveryChanged(addr, { ...addr, line1: "4 Ozumba Mbadiwe" })).toBe(
      true,
    );
  });
  test("a partial patch only compares the fields it carries", () => {
    expect(deliveryChanged(addr, { city: "Lekki" })).toBe(false);
    expect(deliveryChanged(addr, { city: "Ikeja" })).toBe(true);
  });
});
