"use strict";

// A $ order link (staff chose "Pay in $" when sharing it) prices each item at
// its catalogue USD price and locks the order's dollar total from the SAME
// figures the /o page showed — so the customer pays exactly what they saw.

let mockResolved = [];

jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(),
  query: jest.fn(async (sql) => {
    const s = String(sql);
    if (s.includes("catalogue_config")) return { rows: [{ usd_fx_rate: 1500 }] };
    if (s.includes("product_variants"))
      return {
        rows: [
          {
            price_storefront_ngn: "20000",
            price_storefront_usd: "14.99",
            price_pos_ngn: null,
            price_pos_usd: null,
          },
        ],
      };
    return { rows: [] };
  }),
}));
jest.mock("../../../src/modules/smartcomm/smartcomm.order-links.resolvers", () => ({
  resolveItems: jest.fn(async () => mockResolved),
}));
jest.mock("../../../src/modules/catalogue/styled_variants.repo", () => ({
  listVariants: jest.fn(async () => [
    {
      styled_variant_id: "sv-1",
      effective_price_ngn: "380000",
      effective_price_usd: "249.99",
    },
  ]),
}));

const orderLinks = require("../../../src/modules/smartcomm/smartcomm.order-links.service");

beforeEach(() => {
  mockResolved = [
    {
      kind: "styled",
      ref_id: "sty-1",
      styled_variant_id: "sv-1",
      qty: 1,
      price_ngn: "380000",
      lines: [{ variant_id: "base-1", quantity: 1 }],
    },
    {
      kind: "retail",
      ref_id: "var-1",
      variant_id: "var-1",
      qty: 2,
      price_ngn: "20000",
      lines: [{ variant_id: "var-1", quantity: 2 }],
    },
    // Can't be sold → no dollar price.
    { kind: "base", ref_id: "p-x", qty: 1, price_ngn: "5000", lines: [] },
  ];
});

test("each item is priced at its own catalogue USD price", async () => {
  const lines = await orderLinks.linkUsdLines("faitlynhair", mockResolved);
  expect(lines[0]).toMatchObject({ catalogue_usd: "249.99", quantity: 1 });
  expect(lines[1]).toMatchObject({ catalogue_usd: "14.99", quantity: 2 });
  expect(lines[2]).toBeNull();
});

test("the order locks the dollar total the page showed, at the customer's picks", async () => {
  const usd = await orderLinks.lockUsdForLinkOrder({
    brand: "faitlynhair",
    link_items: [],
    // The customer kept the wig and bumped the care item from 2 to 3.
    picks: [
      { idx: 0, qty: 1 },
      { idx: 1, qty: 3 },
    ],
    // ₦380,000 + 3 × ₦20,000 + ₦6,000 delivery
    order: { total_ngn: "446000.00", shipping_fee_ngn: "6000.00" },
  });
  // $249.99 + 3 × $14.99 + ceil(6000/1500 = 4) = $298.96
  expect(usd.usd_total).toBe("298.96");
  expect(usd.fx_rate).not.toBeNull();
});

test("an unticked item is left out of the lock", async () => {
  const usd = await orderLinks.lockUsdForLinkOrder({
    brand: "faitlynhair",
    link_items: [],
    picks: [{ idx: 1, qty: 2 }],
    order: { total_ngn: "40000.00", shipping_fee_ngn: "0.00" },
  });
  expect(usd.usd_total).toBe("29.98");
});
