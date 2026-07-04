"use strict";

// Unit guard for the parametric currency SSOT (src/services/currency.service).
//
// Anchors the two rules the storefront + settlement rely on:
//   1. systemFxRate resolves NGN-per-unit from ONE authority per currency —
//      USD from the catalogue tool (byte-identical to before the parametric
//      layer), everything else from shared.currency_rates (manual > auto), and
//      null when nothing is configured (never guess a rate).
//   2. resolveSettlementCurrency: NGN→NGN, a settlement-enabled currency→itself,
//      any other foreign display→USD (see the currency, pay USD).

let SCENARIO = {};

jest.mock("../../../src/config/database", () => ({
  query: jest.fn(async (sql, params) => {
    const s = String(sql);
    if (s.includes("catalogue_config"))
      return {
        rows:
          SCENARIO.usd_fx_rate != null
            ? [{ usd_fx_rate: SCENARIO.usd_fx_rate }]
            : [],
      };
    if (s.includes("shared.currency_rates")) {
      const cur = params[0];
      const manualOnly = s.includes("is_manual_override = true");
      const rec = (SCENARIO.rates || {})[cur];
      if (!rec) return { rows: [] };
      if (manualOnly)
        return { rows: rec.manual != null ? [{ rate: rec.manual }] : [] };
      const best = rec.manual != null ? rec.manual : rec.auto;
      return { rows: best != null ? [{ rate: best }] : [] };
    }
    if (s.includes("shared.currencies"))
      return { rows: SCENARIO.currencies || [] };
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
    SCENARIO = {};
    expect(await currency.systemFxRate({ brand: BRAND, currency: "NGN" })).toBe(1);
  });

  test("USD uses the catalogue tool rate when no manual override exists", async () => {
    SCENARIO = { usd_fx_rate: 1300, rates: {} };
    expect(await currency.systemFxRate({ brand: BRAND, currency: "USD" })).toBe(1300);
  });

  test("a manual currency_rates USD override wins over the catalogue rate", async () => {
    SCENARIO = { usd_fx_rate: 1300, rates: { USD: { manual: 1350 } } };
    expect(await currency.systemFxRate({ brand: BRAND, currency: "USD" })).toBe(1350);
  });

  test("GBP prefers a manual override over an auto-refreshed rate", async () => {
    SCENARIO = { rates: { GBP: { manual: 1750, auto: 1700 } } };
    expect(await currency.systemFxRate({ brand: BRAND, currency: "GBP" })).toBe(1750);
  });

  test("GBP falls back to the auto rate when no override is set", async () => {
    SCENARIO = { rates: { GBP: { auto: 1700 } } };
    expect(await currency.systemFxRate({ brand: BRAND, currency: "GBP" })).toBe(1700);
  });

  test("an unconfigured currency resolves to null (never guessed)", async () => {
    SCENARIO = { rates: {} };
    expect(await currency.systemFxRate({ brand: BRAND, currency: "EUR" })).toBeNull();
  });
});

describe("resolveSettlementCurrency — display vs charge", () => {
  beforeEach(() => {
    SCENARIO = {
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

  test("once GBP is settlement-enabled it settles in GBP", async () => {
    SCENARIO = { currencies: [{ currency_code: "GBP", is_settlement: true }] };
    expect(await currency.resolveSettlementCurrency({ displayCurrency: "GBP" })).toBe("GBP");
  });
});
