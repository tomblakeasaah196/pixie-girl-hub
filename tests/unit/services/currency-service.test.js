"use strict";

// Unit guard for the parametric currency SSOT (src/services/currency.service).
//
// Anchors the two rules the storefront + settlement rely on:
//   1. systemFxRate resolves NGN-per-unit from ONE authority per currency —
//      USD from the catalogue tool (a currency_rates USD row is only a fallback
//      when it was never set), everything else from shared.currency_rates
//      (manual > auto), and null when nothing is configured (never guess).
//   2. resolveSettlementCurrency: NGN→NGN, any foreign display→USD (see the
//      currency, pay USD). Nomba settles NGN + USD only, so an is_settlement
//      flag on another currency no longer routes a charge in it.

let mockScenario = {};

jest.mock("../../../src/config/database", () => ({
  query: jest.fn(async (sql, params) => {
    const s = String(sql);
    if (s.includes("catalogue_config"))
      return {
        rows:
          mockScenario.usd_fx_rate != null
            ? [{ usd_fx_rate: mockScenario.usd_fx_rate }]
            : [],
      };
    if (s.includes("shared.currency_rates")) {
      const cur = params[0];
      const manualOnly = s.includes("is_manual_override = true");
      const rec = (mockScenario.rates || {})[cur];
      if (!rec) return { rows: [] };
      if (manualOnly)
        return { rows: rec.manual != null ? [{ rate: rec.manual }] : [] };
      const best = rec.manual != null ? rec.manual : rec.auto;
      return { rows: best != null ? [{ rate: best }] : [] };
    }
    if (s.includes("shared.currencies"))
      return { rows: mockScenario.currencies || [] };
    return { rows: [] };
  }),
}));

jest.mock("../../../src/config/brands", () => ({
  VALID: new Set(["pixiegirl", "faitlynhair"]),
}));

const currency = require("../../../src/services/currency.service");
const BRAND = "faitlynhair";

describe("systemFxRate — one authority per currency", () => {
  test("NGN is always 1 (the anchor)", async () => {
    mockScenario = {};
    expect(await currency.systemFxRate({ brand: BRAND, currency: "NGN" })).toBe(1);
  });

  test("USD uses the catalogue tool rate when no manual override exists", async () => {
    mockScenario = { usd_fx_rate: 1300, rates: {} };
    expect(await currency.systemFxRate({ brand: BRAND, currency: "USD" })).toBe(1300);
  });

  test("the catalogue rate beats a manual currency_rates USD override", async () => {
    mockScenario = { usd_fx_rate: 1300, rates: { USD: { manual: 1350 } } };
    expect(await currency.systemFxRate({ brand: BRAND, currency: "USD" })).toBe(1300);
  });

  test("a currency_rates USD row is only a fallback when the catalogue rate is unset", async () => {
    mockScenario = { rates: { USD: { manual: 1350 } } };
    expect(await currency.systemFxRate({ brand: BRAND, currency: "USD" })).toBe(1350);
  });

  test("GBP prefers a manual override over an auto-refreshed rate", async () => {
    mockScenario = { rates: { GBP: { manual: 1750, auto: 1700 } } };
    expect(await currency.systemFxRate({ brand: BRAND, currency: "GBP" })).toBe(1750);
  });

  test("GBP falls back to the auto rate when no override is set", async () => {
    mockScenario = { rates: { GBP: { auto: 1700 } } };
    expect(await currency.systemFxRate({ brand: BRAND, currency: "GBP" })).toBe(1700);
  });

  test("an unconfigured currency resolves to null (never guessed)", async () => {
    mockScenario = { rates: {} };
    expect(await currency.systemFxRate({ brand: BRAND, currency: "EUR" })).toBeNull();
  });
});

describe("resolveSettlementCurrency — display vs charge", () => {
  beforeEach(() => {
    mockScenario = {
      currencies: [
        { currency_code: "NGN", is_settlement: true },
        { currency_code: "USD", is_settlement: true },
        { currency_code: "GBP", is_settlement: false },
      ],
    };
  });

  test("NGN settles NGN", async () => {
    expect(await currency.resolveSettlementCurrency({ displayCurrency: "NGN" })).toBe("NGN");
  });

  test("USD settles USD", async () => {
    expect(await currency.resolveSettlementCurrency({ displayCurrency: "USD" })).toBe("USD");
  });

  test("a non-settlement currency (GBP) is seen but charged in USD", async () => {
    expect(await currency.resolveSettlementCurrency({ displayCurrency: "GBP" })).toBe("USD");
  });

  test("GBP flagged is_settlement still charges USD (Nomba: NGN + USD only)", async () => {
    mockScenario = { currencies: [{ currency_code: "GBP", is_settlement: true }] };
    expect(await currency.resolveSettlementCurrency({ displayCurrency: "GBP" })).toBe("USD");
  });

  test("the settlement set is exactly NGN + USD", () => {
    expect(currency.SETTLEMENT_CURRENCIES).toEqual(["NGN", "USD"]);
  });
});
