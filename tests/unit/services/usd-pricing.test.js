"use strict";

// The USD pricing engine: one set of rules for every dollar figure a sale
// shows or charges (src/services/usd-pricing.service.js).

const mockRows = {};

jest.mock("../../../src/config/database", () => ({
  query: jest.fn(async (sql, params) => {
    const s = String(sql);
    if (s.includes("styled_products")) return { rows: mockRows.styled[params[0]] ? [mockRows.styled[params[0]]] : [] };
    if (s.includes("product_variants")) return { rows: mockRows.variants[params[0]] ? [mockRows.variants[params[0]]] : [] };
    if (s.includes("service_offerings")) return { rows: mockRows.services[params[0]] ? [mockRows.services[params[0]]] : [] };
    if (s.includes("bundle_offers")) return { rows: mockRows.bundles[params[0]] ? [mockRows.bundles[params[0]]] : [] };
    return { rows: [] };
  }),
}));
jest.mock("../../../src/config/brands", () => ({
  assertBrand: (b) => b,
  VALID: new Set(["pixiegirl", "faitlynhair"]),
}));

const usd = require("../../../src/services/usd-pricing.service");

const RATE = 1500;

describe("lineUsd — per-product dollar price", () => {
  test("sold at list price → the catalogue USD price, cents and all", () => {
    const u = usd.lineUsd({ unit_ngn: 380000, catalogue_ngn: 380000, catalogue_usd: 249.99, rate: RATE });
    expect(u.toFixed(2)).toBe("249.99");
  });

  test("sold below list (campaign price) → same proportion off in dollars", () => {
    // ₦342,000 is 90% of ₦380,000 → 90% of $249.99 = $224.991 → $224.99
    const u = usd.lineUsd({ unit_ngn: 342000, catalogue_ngn: 380000, catalogue_usd: 249.99, rate: RATE });
    expect(u.toFixed(2)).toBe("224.99");
  });

  test("no catalogue USD price → ₦ ÷ catalogue rate, rounded up to the dollar", () => {
    const u = usd.lineUsd({ unit_ngn: 380000, catalogue_ngn: 380000, catalogue_usd: null, rate: RATE });
    expect(u.toFixed(2)).toBe("254.00"); // 253.33 → $254
  });

  test("no USD price and no rate → cannot be priced", () => {
    expect(usd.lineUsd({ unit_ngn: 380000, rate: null })).toBeNull();
  });
});

describe("orderUsd — the whole order", () => {
  test("goods + delivery; effective rate settles the Naira total exactly", () => {
    const r = usd.orderUsd({
      lines: [{ unit_ngn: 380000, quantity: 1, catalogue_ngn: 380000, catalogue_usd: 249.99 }],
      total_ngn: 385000,
      delivery_ngn: 5000,
      rate: RATE,
    });
    expect(r.goods_usd).toBe("249.99");
    expect(r.delivery_usd).toBe("4.00"); // 3.33 → $4
    expect(r.usd_total).toBe("253.99");
    // ₦385,000 ÷ $253.99 — dividing back gives the dollar total to the cent.
    expect(Number((385000 / Number(r.fx_rate)).toFixed(2))).toBe(253.99);
  });

  test("an order-level discount scales at the goods' own dollar ratio", () => {
    // 10% deal discount on a ₦380,000 / $249.99 wig → $25.00 off
    const r = usd.orderUsd({
      lines: [{ unit_ngn: 380000, quantity: 1, catalogue_ngn: 380000, catalogue_usd: 249.99 }],
      total_ngn: 342000,
      rate: RATE,
    });
    expect(r.adjustments_usd).toBe("-25.00");
    expect(r.usd_total).toBe("224.99");
  });

  test("mixed lines: a priced product and one without a USD price", () => {
    const r = usd.orderUsd({
      lines: [
        { unit_ngn: 380000, quantity: 2, catalogue_ngn: 380000, catalogue_usd: 249.99 },
        { unit_ngn: 10000, quantity: 1 },
      ],
      total_ngn: 770000,
      rate: RATE,
    });
    // 2 × 249.99 + ceil(10000/1500 = 6.67) = 499.98 + 7
    expect(r.usd_total).toBe("506.98");
    expect(r.lines.map((l) => l.unit_price_usd)).toEqual(["249.99", "7.00"]);
  });

  test("a line that can't be priced makes the order unpriceable", () => {
    expect(
      usd.orderUsd({ lines: [{ unit_ngn: 10000, quantity: 1 }], total_ngn: 10000, rate: null }),
    ).toBeNull();
  });
});

describe("orderUsdFromLines — an existing order turning USD (Quick Sale)", () => {
  beforeEach(() => {
    mockRows.styled = { "sty-1": { retail_price_ngn: "380000", retail_price_usd: "249.99" } };
    mockRows.variants = {
      "var-1": {
        price_storefront_ngn: "20000", price_storefront_usd: "14.99",
        price_pos_ngn: "18000", price_pos_usd: "12.99",
      },
    };
    mockRows.services = { "svc-1": { base_price_ngn: "15000", base_price_usd: null } };
    mockRows.bundles = {};
  });

  test("styled, POS-priced variant and service lines each resolve their own pair", async () => {
    const r = await usd.orderUsdFromLines({
      brand: "faitlynhair",
      rate: RATE,
      order: {
        total_ngn: "413000.00",
        shipping_fee_ngn: "0.00",
        lines: [
          { line_kind: "styled", styled_id: "sty-1", variant_id: "base-1", unit_price_ngn: "380000.00", quantity: 1 },
          { line_kind: "product", variant_id: "var-1", unit_price_ngn: "18000.00", quantity: 1 },
          { line_kind: "service", service_offering_id: "svc-1", unit_price_ngn: "15000.00", quantity: 1 },
        ],
      },
    });
    // 249.99 + POS twin 12.99 + ceil(15000/1500 = 10) = 272.98
    expect(r.lines.map((l) => l.unit_price_usd)).toEqual(["249.99", "12.99", "10.00"]);
    expect(r.usd_total).toBe("272.98");
  });
});

describe("bundlePair — only fixed-price bundles carry a USD price", () => {
  test("pct_off bundle converts at the rate", async () => {
    mockRows.bundles = { "b-1": { pricing_model: "pct_off", bundle_price_ngn: null, bundle_price_usd: null } };
    expect(await usd.bundlePair({ brand: "faitlynhair", bundle_id: "b-1" })).toEqual({
      catalogue_ngn: null,
      catalogue_usd: null,
    });
  });

  test("fixed-price bundle uses its own USD price", async () => {
    mockRows.bundles = { "b-2": { pricing_model: "fixed_bundle_price", bundle_price_ngn: "700000", bundle_price_usd: "459.99" } };
    expect(await usd.bundlePair({ brand: "faitlynhair", bundle_id: "b-2" })).toEqual({
      catalogue_ngn: "700000",
      catalogue_usd: "459.99",
    });
  });
});
