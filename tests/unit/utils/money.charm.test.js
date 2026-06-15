"use strict";

/**
 * Additional money-helper tests (V2.2 §5.1 / §6.25) covering charm rounding,
 * gateway-fee gross-up with a cap, and currency validation. Complements the
 * existing money.test.js. All amounts are Decimal — zero float arithmetic.
 */

const {
  charmRound,
  grossUpForGatewayFee,
  isSupportedCurrency,
  toCurrencyString,
} = require("../../../src/utils/money");

describe("charmRound", () => {
  test("NGN rounds up to the next thousand minus 100", () => {
    expect(charmRound(119001, "NGN").toString()).toBe("119900");
    expect(charmRound(100500, "NGN").toString()).toBe("100900");
  });

  test("USD/CAD/GHS round up to the next .99", () => {
    expect(charmRound("74.32", "USD").toString()).toBe("74.99");
    expect(charmRound("10.01", "GHS").toString()).toBe("10.99");
  });

  test("GBP/EUR round up to the next .95", () => {
    expect(charmRound("74.32", "GBP").toString()).toBe("74.95");
    expect(charmRound("9.10", "EUR").toString()).toBe("9.95");
  });
});

describe("grossUpForGatewayFee", () => {
  test("inverts a percentage + fixed fee", () => {
    const gross = grossUpForGatewayFee("100", { pct: "0.02", fixed: "0" });
    expect(gross.toFixed(2)).toBe("102.04");
  });

  test("respects the fee cap when the implied fee exceeds it", () => {
    const gross = grossUpForGatewayFee("1000000", {
      pct: "0.015",
      fixed: "0",
      cap: "2000",
    });
    expect(gross.toFixed(2)).toBe("1002000.00"); // net + capped fee
  });

  test("rejects a fee pct >= 100%", () => {
    expect(() =>
      grossUpForGatewayFee("100", { pct: "1", fixed: "0" }),
    ).toThrow();
  });
});

describe("isSupportedCurrency", () => {
  test("accepts supported codes case-insensitively", () => {
    expect(isSupportedCurrency("ngn")).toBe(true);
    expect(isSupportedCurrency("USD")).toBe(true);
  });
  test("rejects unsupported or non-string input", () => {
    expect(isSupportedCurrency("JPY")).toBe(false);
    expect(isSupportedCurrency(123)).toBe(false);
  });
});

describe("toCurrencyString", () => {
  test("rounds half-up to 2dp", () => {
    expect(toCurrencyString("10.005")).toBe("10.01");
    expect(toCurrencyString("10.004")).toBe("10.00");
  });
});
