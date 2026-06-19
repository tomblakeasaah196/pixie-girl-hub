"use strict";

/**
 * Pricing advisor pure helpers (pricing PR): clean-figure rounding and the
 * "VAT only when the business actually charges it" rule. DB/infra deps are
 * mocked so the math is verified in isolation.
 */

jest.mock("../../../src/modules/pricing/pricing_advisor.repo", () => ({}));
jest.mock("../../../src/modules/pricing/pricing.repo", () => ({}));
jest.mock("../../../src/modules/pricing/pricing.service", () => ({}));
jest.mock("../../../src/modules/catalogue/cost_vault.service", () => ({}));
jest.mock("../../../src/modules/pricing/pricing.events", () => ({
  emit: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/config/database", () => ({ transaction: jest.fn() }));

const {
  roundTo,
  effectiveVat,
} = require("../../../src/modules/pricing/pricing_advisor.service");

describe("roundTo (clean/charm pricing)", () => {
  test("rounds to the nearest step", () => {
    expect(roundTo(118750, 500).toString()).toBe("119000");
    expect(roundTo(118740, 500).toString()).toBe("118500");
  });
  test("a step of 0 leaves the price untouched", () => {
    expect(roundTo(118737, 0).toString()).toBe("118737");
  });
  test("rounds to thousands", () => {
    expect(roundTo(111111.11, 1000).toString()).toBe("111000");
  });
});

describe("effectiveVat (VAT only when set in Settings)", () => {
  test("taxable product + business VAT → applies", () => {
    expect(
      effectiveVat(
        { vat_rate: 0.075 },
        { taxable: true, product_vat_rate: null },
      ),
    ).toEqual({
      rate: 0.075,
      applies: true,
    });
  });
  test("a no-VAT business stays no-VAT even for a taxable product", () => {
    expect(
      effectiveVat({ vat_rate: 0 }, { taxable: true, product_vat_rate: null }),
    ).toEqual({
      rate: 0,
      applies: false,
    });
  });
  test("a non-taxable product never gets VAT", () => {
    expect(
      effectiveVat(
        { vat_rate: 0.075 },
        { taxable: false, product_vat_rate: null },
      ),
    ).toEqual({
      rate: 0,
      applies: false,
    });
  });
  test("a product VAT override wins over the business default", () => {
    expect(
      effectiveVat(
        { vat_rate: 0.075 },
        { taxable: true, product_vat_rate: 0.05 },
      ),
    ).toEqual({
      rate: 0.05,
      applies: true,
    });
  });
});
