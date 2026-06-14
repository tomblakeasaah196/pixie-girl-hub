"use strict";

/**
 * Bundle quantity-discount unit tests (§6.23.4 / F-2 remainder). The
 * buy_x_get_y + tiered_qty math is pure; the DB-touching deps are mocked so the
 * money logic is verified in isolation (decimal.js, never float).
 */

jest.mock("../../../src/modules/retention/bundle.repo", () => ({}));
jest.mock("../../../src/config/database", () => ({ transaction: jest.fn() }));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));

const {
  quantityBundleDiscount,
} = require("../../../src/modules/retention/bundle.service");

const D = (d) => d.toFixed(2);

describe("quantityBundleDiscount — buy_x_get_y", () => {
  test("buy 2 get 1 free discounts the cheapest unit in the group", () => {
    const d = quantityBundleDiscount({
      pricing_model: "buy_x_get_y",
      bundle: { buy_quantity: 2, get_quantity: 1, get_discount_pct: 1 },
      lines: [
        { quantity: 1, unit_price_ngn: 300 },
        { quantity: 1, unit_price_ngn: 100 },
        { quantity: 1, unit_price_ngn: 200 },
      ],
      component_subtotal_ngn: 600,
    });
    expect(D(d)).toBe("100.00"); // cheapest of the 3
  });

  test("scales with groups (6 units → 2 cheapest free); pct given as 100", () => {
    const d = quantityBundleDiscount({
      pricing_model: "buy_x_get_y",
      bundle: { buy_quantity: 2, get_quantity: 1, get_discount_pct: 100 },
      lines: [
        { quantity: 2, unit_price_ngn: 100 },
        { quantity: 2, unit_price_ngn: 200 },
        { quantity: 2, unit_price_ngn: 300 },
      ],
      component_subtotal_ngn: 1200,
    });
    expect(D(d)).toBe("200.00");
  });

  test("buy 1 get 1 at 50% off", () => {
    const d = quantityBundleDiscount({
      pricing_model: "buy_x_get_y",
      bundle: { buy_quantity: 1, get_quantity: 1, get_discount_pct: 0.5 },
      lines: [
        { quantity: 2, unit_price_ngn: 100 },
        { quantity: 2, unit_price_ngn: 200 },
      ],
      component_subtotal_ngn: 600,
    });
    expect(D(d)).toBe("100.00"); // cheapest 2 units * 50%
  });

  test("not enough units for a full group → no discount", () => {
    const d = quantityBundleDiscount({
      pricing_model: "buy_x_get_y",
      bundle: { buy_quantity: 2, get_quantity: 1, get_discount_pct: 1 },
      lines: [{ quantity: 2, unit_price_ngn: 100 }],
      component_subtotal_ngn: 200,
    });
    expect(D(d)).toBe("0.00");
  });
});

describe("quantityBundleDiscount — tiered_qty", () => {
  const bundle = {
    qty_tiers: [
      { min_quantity: 3, discount_pct: 0.1 },
      { min_quantity: 5, discount_pct: 0.2 },
    ],
  };

  test("picks the highest satisfied tier", () => {
    expect(
      D(
        quantityBundleDiscount({
          pricing_model: "tiered_qty",
          bundle,
          lines: [{ quantity: 5, unit_price_ngn: 200 }],
          component_subtotal_ngn: 1000,
        }),
      ),
    ).toBe("200.00");
    expect(
      D(
        quantityBundleDiscount({
          pricing_model: "tiered_qty",
          bundle,
          lines: [{ quantity: 4, unit_price_ngn: 250 }],
          component_subtotal_ngn: 1000,
        }),
      ),
    ).toBe("100.00");
    expect(
      D(
        quantityBundleDiscount({
          pricing_model: "tiered_qty",
          bundle,
          lines: [{ quantity: 2, unit_price_ngn: 500 }],
          component_subtotal_ngn: 1000,
        }),
      ),
    ).toBe("0.00");
  });

  test("discount is capped at the component subtotal", () => {
    const d = quantityBundleDiscount({
      pricing_model: "tiered_qty",
      bundle: { qty_tiers: [{ min_quantity: 1, discount_amount_ngn: 99999 }] },
      lines: [{ quantity: 1, unit_price_ngn: 500 }],
      component_subtotal_ngn: 500,
    });
    expect(D(d)).toBe("500.00");
  });
});
