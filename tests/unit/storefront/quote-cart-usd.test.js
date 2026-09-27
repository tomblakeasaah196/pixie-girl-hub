"use strict";

// The website bag prices dollars through the USD engine (usd-pricing): each
// item's catalogue USD price, not "Naira ÷ rate". The same pass (priceCartItems)
// feeds checkout's locked dollar total, so the bag's $ is the $ charged.

let mockCartItems = [];

jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(),
  query: jest.fn(async (sql) => {
    const s = String(sql);
    if (s.includes("styled_product_variants")) return { rows: [{ styled_id: "sty-1" }] };
    if (s.includes("catalogue_config")) return { rows: [{ usd_fx_rate: 1500 }] };
    if (s.includes("bundle_offers"))
      return {
        rows: [{ pricing_model: "fixed_bundle_price", bundle_price_ngn: "700000", bundle_price_usd: "459.99" }],
      };
    return { rows: [] };
  }),
}));
jest.mock("../../../src/modules/storefront/cart.repo", () => ({
  findCartById: jest.fn(async () => ({ cart_id: "cart-1", business: "faitlynhair", status: "active" })),
  listCartItems: jest.fn(async () => mockCartItems),
}));
jest.mock("../../../src/modules/catalogue/styled.repo", () => ({
  getById: jest.fn(async () => ({
    styled_id: "sty-1",
    name: "Bone Straight 24\"",
    status: "live",
    is_deleted: false,
    retail_price_ngn: "350000",
    retail_price_usd: "229.99",
    base_variant_id: "base-1",
    base_product_id: "prod-1",
  })),
}));
jest.mock("../../../src/modules/catalogue/styled_variants.repo", () => ({
  listVariants: jest.fn(async () => [
    {
      styled_variant_id: "sv-1",
      effective_price_ngn: "380000",
      effective_price_usd: "249.99",
      colour_name: "Natural",
      size_label: "M",
    },
  ]),
}));
jest.mock("../../../src/modules/catalogue/rewig.service", () => ({
  pickRewigDonorProductId: jest.fn(async () => null),
}));
jest.mock("../../../src/modules/retention/bundle.service", () => ({
  getBundle: jest.fn(async () => ({ effective_price_ngn: 700000 })),
}));
jest.mock("../../../src/modules/catalogue/retail-resolver", () => ({
  resolveSellableVariants: jest.fn(async () => new Map()),
}));

const storefront = require("../../../src/modules/storefront/storefront.service");

beforeEach(() => {
  mockCartItems = [
    { cart_item_id: "ci-1", styled_variant_id: "sv-1", quantity: 2, product_name_snapshot: "Bone Straight" },
    { cart_item_id: "ci-2", bundle_id: "b-1", quantity: 1, product_name_snapshot: "Starter Bundle" },
  ];
});

test("USD bag: catalogue USD prices per item, not ₦ ÷ rate", async () => {
  const q = await storefront.quoteCart({
    brand: "faitlynhair",
    cart_id: "cart-1",
    display_currency: "USD",
  });
  // ₦380,000 styled variant → its catalogue $249.99 (₦ ÷ 1,500 would be $254)
  expect(q.lines[0].unit_price_usd).toBe("249.99");
  expect(q.lines[0].line_total_usd).toBe("499.98");
  // Fixed-price bundle → its own catalogue $459.99
  expect(q.lines[1].unit_price_usd).toBe("459.99");
  expect(q.subtotal_display).toBe("959.97");
  expect(q.total_display).toBe("959.97");
  expect(q.goods_total_display).toBe("959.97");
  expect(q.fx_rate_used).toBe(1500);
});

test("any foreign display prices in USD (₦ and $ only)", async () => {
  const q = await storefront.quoteCart({
    brand: "faitlynhair",
    cart_id: "cart-1",
    display_currency: "GBP",
  });
  expect(q.display_currency).toBe("USD");
  expect(q.total_display).toBe("959.97");
});

test("NGN bag carries no dollar figures", async () => {
  const q = await storefront.quoteCart({
    brand: "faitlynhair",
    cart_id: "cart-1",
    display_currency: "NGN",
  });
  expect(q.total_ngn).toBe("1460000.00");
  expect(q.total_display).toBeNull();
  expect(q.lines[0].unit_price_usd).toBeUndefined();
});
