"use strict";

const { roundUsd } = require("../../../src/modules/catalogue/usd-reprice.service");
const { roundExpr } = require("../../../src/modules/catalogue/usd-reprice.repo");

describe("USD reprice — roundUsd (NGN ÷ rate)", () => {
  test("exact: 2 decimal places, half-up", () => {
    expect(roundUsd(165000, 1650, "exact")).toBe(100);
    expect(roundUsd(165050, 1650, "exact")).toBe(100.03);
    expect(roundUsd(164175, 1650, "exact")).toBe(99.5);
  });

  test("whole: nearest dollar (half-up)", () => {
    expect(roundUsd(165050, 1650, "whole")).toBe(100);
    expect(roundUsd(164175, 1650, "whole")).toBe(100); // 99.5 → 100
    expect(roundUsd(163350, 1650, "whole")).toBe(99); // 99.0 → 99
  });

  test("ninety_nine: charm price (floor + .99)", () => {
    expect(roundUsd(165000, 1650, "ninety_nine")).toBe(100.99); // 100 → 100.99
    expect(roundUsd(165050, 1650, "ninety_nine")).toBe(100.99); // 100.03 → 100.99
    expect(roundUsd(164175, 1650, "ninety_nine")).toBe(99.99); // 99.5 → 99.99
  });

  test("defaults to exact when rounding omitted", () => {
    expect(roundUsd(165050, 1650)).toBe(100.03);
  });

  test("null / undefined NGN → null (no USD invented)", () => {
    expect(roundUsd(null, 1650, "exact")).toBeNull();
    expect(roundUsd(undefined, 1650, "whole")).toBeNull();
  });
});

describe("USD reprice — roundExpr (SQL) mirrors roundUsd", () => {
  // Structural guard: the SQL the apply path runs must use the same rounding
  // shape as roundUsd. If one changes, this test fails to flag the drift.
  test("exact → ROUND(x, 2)", () => {
    expect(roundExpr("price_ngn", "$1", "exact")).toBe(
      "ROUND((price_ngn::numeric / $1), 2)",
    );
  });
  test("whole → ROUND(x, 0)", () => {
    expect(roundExpr("price_ngn", "$1", "whole")).toBe(
      "ROUND((price_ngn::numeric / $1), 0)",
    );
  });
  test("ninety_nine → FLOOR(x) + 0.99", () => {
    expect(roundExpr("price_ngn", "$1", "ninety_nine")).toBe(
      "(FLOOR((price_ngn::numeric / $1)) + 0.99)",
    );
  });
});
