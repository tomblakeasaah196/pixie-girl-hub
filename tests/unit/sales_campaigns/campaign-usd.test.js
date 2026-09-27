"use strict";

// Campaigns price dollars through the same USD engine as the website: each
// line's catalogue USD price at the LIVE catalogue ₦/$ rate — not the static
// per-campaign rate the builder used to hold.

jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(),
  query: jest.fn(async (sql) => {
    if (String(sql).includes("catalogue_config"))
      return { rows: [{ usd_fx_rate: 1500 }] };
    return { rows: [] };
  }),
}));

const svc = require("../../../src/modules/sales_campaigns/campaigns.public.service");

describe("styledUsdPair — the composer's NULL-safe USD price", () => {
  const sv = {
    retail_price_ngn: "350000",
    retail_price_usd: "229.99",
    colour_premium_usd: "10",
    size_premium_usd: "10",
    lace_premium_usd: null,
    price_override_usd: null,
  };

  test("styled: anchor + premiums in dollars", () => {
    expect(svc.styledUsdPair(sv, "380000", false)).toEqual({
      catalogue_ngn: "380000.00",
      catalogue_usd: "249.99",
    });
  });

  test("a USD override wins", () => {
    expect(
      svc.styledUsdPair({ ...sv, price_override_usd: "239.00" }, "380000", false)
        .catalogue_usd,
    ).toBe("239.00");
  });

  test("no USD anchor and no override → no USD price (never a partial sum)", () => {
    expect(
      svc.styledUsdPair({ ...sv, retail_price_usd: null }, "380000", false)
        .catalogue_usd,
    ).toBeNull();
  });

  test("unstyled → the anchor pair", () => {
    expect(svc.styledUsdPair(sv, "350000", true)).toEqual({
      catalogue_ngn: "350000",
      catalogue_usd: "229.99",
    });
  });
});

describe("campaignUsd — the cart in dollars", () => {
  test("catalogue USD per line, the deal discount at the goods' dollar ratio", async () => {
    const usd = await svc.campaignUsd({
      brand: "faitlynhair",
      dealLines: [
        {
          unit_price_ngn: "380000.00",
          quantity: 2,
          usd_pair: { catalogue_ngn: "380000.00", catalogue_usd: "249.99" },
        },
      ],
      // ₦760,000 goods − ₦76,000 multi-wig discount (10%)
      total_ngn: "684000.00",
    });
    expect(usd.rate).toBe(1500); // the live catalogue rate
    expect(usd.lines).toEqual(["249.99"]);
    expect(usd.goods_usd).toBe("499.98");
    expect(usd.adjustments_usd).toBe("-50.00"); // 10% of $499.98, to the cent
    expect(usd.total_usd).toBe("449.98");
    // The landing converts each ₦ discount row at this ratio.
    expect(Number(usd.ratio) * 76000).toBeCloseTo(50.0, 2);
  });

  test("a line with no USD price converts at the catalogue rate, whole dollars", async () => {
    const usd = await svc.campaignUsd({
      brand: "faitlynhair",
      dealLines: [{ unit_price_ngn: "10000.00", quantity: 1, usd_pair: null }],
      total_ngn: "10000.00",
    });
    expect(usd.total_usd).toBe("7.00"); // 6.67 → $7
  });
});
