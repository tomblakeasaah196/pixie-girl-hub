"use strict";

/**
 * Styled-bundle checkout pricing (revenue-critical regression).
 *
 * The bug: the public checkout + quote skipped styled bundle components
 * (`if (!bi.variant_id) continue`) because, post-migration, styled products carry
 * `styled_id` and NOT `variant_id`. A styled-wig bundle therefore resolved to ZERO
 * line items, quoted at ₦0, and never applied `campaign_bundle_price_ngn`.
 *
 * These tests drive the ACTUAL resolution + pricing logic with the data layer
 * mocked, so they run without a database and would have caught the bug:
 *   - computeBundleDiscount: the pure money math (sum-of-parts, campaign-price
 *     discount, never a markup).
 *   - resolveBundleForCheckout: that styled components resolve to a sellable base
 *     variant line (NOT skipped) and the campaign price lands as an order discount.
 */

// Mock the data layer BEFORE requiring the service under test.
jest.mock("../../../src/config/database", () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));
jest.mock("../../../src/modules/sales_campaigns/campaigns.bundles.repo", () => ({
  listBundleItems: jest.fn(),
  getCampaignBundle: jest.fn(),
}));

const { query } = require("../../../src/config/database");
const bundleRepo = require("../../../src/modules/sales_campaigns/campaigns.bundles.repo");
const { toCurrencyString } = require("../../../src/utils/money");
const {
  computeBundleDiscount,
  resolveBundleForCheckout,
} = require("../../../src/modules/sales_campaigns/campaigns.public.service");
const {
  liveBundlePriceFromSource,
} = require("../../../src/modules/sales_campaigns/campaigns.bundles.service");

const fmt = (m) => toCurrencyString(m);

afterEach(() => jest.clearAllMocks());

describe("liveBundlePriceFromSource (live Catalogue pricing)", () => {
  it("pct_off: subtotal × (1 − discount_value) (unit count irrelevant)", () => {
    expect(
      liveBundlePriceFromSource(
        { src_pricing_model: "pct_off", src_discount_value: "0.2" },
        500000,
        6,
      ),
    ).toBe(400000);
  });

  it("amount_off: ₦ off EACH unit — discount × unit count, clamped ≥ 0", () => {
    // ₦35k off each of 6 units = ₦210k off → price ₦290k (the owner's case).
    expect(
      liveBundlePriceFromSource(
        { src_pricing_model: "amount_off", src_discount_value: "35000" },
        500000,
        6,
      ),
    ).toBe(290000);
    // One unit → just the per-unit amount off.
    expect(
      liveBundlePriceFromSource(
        { src_pricing_model: "amount_off", src_discount_value: "35000" },
        500000,
        1,
      ),
    ).toBe(465000);
    // Total discount can't exceed the subtotal (price floors at 0).
    expect(
      liveBundlePriceFromSource(
        { src_pricing_model: "amount_off", src_discount_value: "200000" },
        500000,
        6,
      ),
    ).toBe(0);
  });

  it("fixed_bundle_price: the offer's set price", () => {
    expect(
      liveBundlePriceFromSource(
        { src_pricing_model: "fixed_bundle_price", src_bundle_price_ngn: "350000" },
        500000,
        6,
      ),
    ).toBe(350000);
  });

  it("returns null for quantity models and when there is no source", () => {
    expect(
      liveBundlePriceFromSource(
        { src_pricing_model: "buy_x_get_y", src_discount_value: "0.3" },
        500000,
        6,
      ),
    ).toBeNull();
    expect(liveBundlePriceFromSource({}, 500000, 6)).toBeNull();
    expect(liveBundlePriceFromSource(null, 500000, 6)).toBeNull();
  });
});

describe("computeBundleDiscount (pure)", () => {
  it("sums component prices — styled components are PRICED, not skipped", () => {
    // Two styled components (no variant_id in real data); the bug dropped them.
    const r = computeBundleDiscount({
      components: [
        { unit_price_ngn: "250000", quantity: 1 },
        { unit_price_ngn: "250000", quantity: 1 },
      ],
      campaignBundlePrice: null,
    });
    expect(fmt(r.sumOfParts)).toBe("500000.00");
    expect(fmt(r.effectivePrice)).toBe("500000.00"); // no campaign price → sum of parts
    expect(fmt(r.discountPerBundle)).toBe("0.00");
  });

  it("applies the campaign bundle price as a discount (sum-of-parts − price)", () => {
    const r = computeBundleDiscount({
      components: [
        { unit_price_ngn: "250000", quantity: 1 },
        { unit_price_ngn: "250000", quantity: 1 },
      ],
      campaignBundlePrice: "400000",
    });
    expect(fmt(r.sumOfParts)).toBe("500000.00");
    expect(fmt(r.effectivePrice)).toBe("400000.00");
    expect(fmt(r.discountPerBundle)).toBe("100000.00");
  });

  it("multiplies component price by component quantity", () => {
    const r = computeBundleDiscount({
      components: [{ unit_price_ngn: "150000", quantity: 3 }],
      campaignBundlePrice: "400000",
    });
    expect(fmt(r.sumOfParts)).toBe("450000.00");
    expect(fmt(r.discountPerBundle)).toBe("50000.00");
  });

  it("never marks a bundle UP: a campaign price above sum-of-parts is ignored", () => {
    const r = computeBundleDiscount({
      components: [{ unit_price_ngn: "250000", quantity: 1 }],
      campaignBundlePrice: "300000", // higher than the ₦250k sum-of-parts
    });
    expect(fmt(r.effectivePrice)).toBe("250000.00");
    expect(fmt(r.discountPerBundle)).toBe("0.00");
  });

  it("keeps effectivePrice === sumOfParts − discount (quote and till agree)", () => {
    const r = computeBundleDiscount({
      components: [
        { unit_price_ngn: "250000", quantity: 1 },
        { unit_price_ngn: "180000", quantity: 2 },
      ],
      campaignBundlePrice: "500000",
    });
    expect(fmt(r.sumOfParts)).toBe("610000.00");
    expect(fmt(r.effectivePrice)).toBe("500000.00");
    expect(fmt(r.discountPerBundle)).toBe("110000.00");
    expect(fmt(r.sumOfParts.minus(r.discountPerBundle))).toBe(
      fmt(r.effectivePrice),
    );
  });

  it("treats empty/missing components as ₦0", () => {
    const r = computeBundleDiscount({ components: [], campaignBundlePrice: null });
    expect(fmt(r.sumOfParts)).toBe("0.00");
    expect(fmt(r.discountPerBundle)).toBe("0.00");
  });
});

describe("resolveBundleForCheckout (styled components → sellable lines)", () => {
  it("resolves a STYLED component to its base variant line instead of skipping it", async () => {
    bundleRepo.listBundleItems.mockResolvedValue([
      {
        styled_id: "sty-1",
        variant_id: null, // styled products have no variant_id post-migration
        product_id: null,
        styled_base_variant_id: "var-base-1",
        styled_base_product_id: "prod-base-1",
        styled_name: "Pixie Bob — Honey",
        display_name: "Pixie Bob — Honey",
        quantity: 1,
        unit_price_ngn: "250000",
      },
      {
        styled_id: "sty-2",
        variant_id: null,
        product_id: null,
        styled_base_variant_id: "var-base-2",
        styled_base_product_id: "prod-base-2",
        styled_name: "Pixie Bob — Black",
        display_name: "Pixie Bob — Black",
        quantity: 1,
        unit_price_ngn: "250000",
      },
    ]);
    bundleRepo.getCampaignBundle.mockResolvedValue({
      campaign_bundle_price_ngn: "400000",
    });

    const res = await resolveBundleForCheckout({
      brand: "pixiegirl",
      campaign_id: "camp-1",
      bundle_id: "bun-1",
      units: 1,
    });

    // The crux: BOTH styled components produced a sellable, priced order line.
    expect(res.orderLines).toHaveLength(2);
    expect(res.orderLines[0]).toMatchObject({
      variant_id: "var-base-1",
      quantity: 1,
      unit_price_ngn: "250000.00",
      product_name_snapshot: "Pixie Bob — Honey",
    });
    expect(res.orderLines[1].variant_id).toBe("var-base-2");

    expect(fmt(res.sumOfParts)).toBe("500000.00");
    expect(fmt(res.effectivePrice)).toBe("400000.00");
    expect(fmt(res.discountNgn)).toBe("100000.00");
    // base_variant_id was present → no default-variant DB lookup needed.
    expect(query).not.toHaveBeenCalled();
  });

  it("falls back to the base product's default variant when base_variant_id is unset", async () => {
    bundleRepo.listBundleItems.mockResolvedValue([
      {
        styled_id: "sty-1",
        variant_id: null,
        product_id: null,
        styled_base_variant_id: null,
        styled_base_product_id: "prod-base-1",
        styled_name: "Pixie Bob",
        quantity: 1,
        unit_price_ngn: "250000",
      },
    ]);
    bundleRepo.getCampaignBundle.mockResolvedValue(null); // no campaign price set
    query.mockResolvedValue({ rows: [{ variant_id: "var-default-1" }] });

    const res = await resolveBundleForCheckout({
      brand: "pixiegirl",
      campaign_id: "camp-1",
      bundle_id: "bun-1",
      units: 1,
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(res.orderLines[0].variant_id).toBe("var-default-1");
    // No campaign price → bundle charged at sum-of-parts, no discount.
    expect(fmt(res.discountNgn)).toBe("0.00");
    expect(fmt(res.effectivePrice)).toBe("250000.00");
  });

  it("multiplies quantities and the discount by the number of bundles bought", async () => {
    bundleRepo.listBundleItems.mockResolvedValue([
      {
        styled_id: "sty-1",
        variant_id: null,
        styled_base_variant_id: "var-base-1",
        styled_name: "Styled wig",
        quantity: 1,
        unit_price_ngn: "250000",
      },
      {
        styled_id: null,
        variant_id: "var-raw-1", // a plain base-variant component
        styled_base_variant_id: null,
        quantity: 2,
        unit_price_ngn: "150000",
      },
    ]);
    bundleRepo.getCampaignBundle.mockResolvedValue({
      campaign_bundle_price_ngn: "500000",
    });

    const res = await resolveBundleForCheckout({
      brand: "pixiegirl",
      campaign_id: "camp-1",
      bundle_id: "bun-1",
      units: 2, // buyer takes two of this bundle
    });

    // per bundle: 250000 + 150000*2 = 550000; campaign price 500000 → 50000 off.
    expect(fmt(res.sumOfParts)).toBe("550000.00");
    expect(fmt(res.discountNgn)).toBe("100000.00"); // 50000 × 2 bundles
    // line quantities scale by units.
    expect(res.orderLines[0]).toMatchObject({ variant_id: "var-base-1", quantity: 2 });
    expect(res.orderLines[1]).toMatchObject({ variant_id: "var-raw-1", quantity: 4 });
  });

  it("throws on an empty bundle rather than checking out an empty order", async () => {
    bundleRepo.listBundleItems.mockResolvedValue([]);
    await expect(
      resolveBundleForCheckout({
        brand: "pixiegirl",
        campaign_id: "camp-1",
        bundle_id: "bun-1",
        units: 1,
      }),
    ).rejects.toThrow(/no items/i);
  });

  it("charges the LIVE Catalogue discount, overriding a stale snapshot", async () => {
    bundleRepo.listBundleItems.mockResolvedValue([
      {
        styled_id: "sty-1",
        variant_id: null,
        styled_base_variant_id: "var-base-1",
        styled_name: "Styled wig",
        quantity: 1,
        unit_price_ngn: "300000",
      },
      {
        styled_id: "sty-2",
        variant_id: null,
        styled_base_variant_id: "var-base-2",
        styled_name: "Styled wig 2",
        quantity: 1,
        unit_price_ngn: "200000",
      },
    ]);
    // The stored snapshot is stale (₦480k). The Catalogue offer now says 30% off
    // → the till must charge 30% off the ₦500k live sum-of-parts = ₦350k.
    bundleRepo.getCampaignBundle.mockResolvedValue({
      campaign_bundle_price_ngn: "480000",
      src_pricing_model: "pct_off",
      src_discount_value: "0.3",
    });

    const res = await resolveBundleForCheckout({
      brand: "pixiegirl",
      campaign_id: "camp-1",
      bundle_id: "bun-1",
      units: 1,
    });

    expect(fmt(res.sumOfParts)).toBe("500000.00");
    expect(fmt(res.effectivePrice)).toBe("350000.00"); // live, not the ₦480k snapshot
    expect(fmt(res.discountNgn)).toBe("150000.00");
  });

  it("charges amount_off PER UNIT (₦35k off each × 6 = ₦210k) at the till", async () => {
    // A 6-piece bundle, each component a styled wig priced ₦100k → ₦600k parts.
    bundleRepo.listBundleItems.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => ({
        styled_id: `sty-${i}`,
        variant_id: null,
        styled_base_variant_id: `var-base-${i}`,
        styled_name: `Wig ${i}`,
        quantity: 1,
        unit_price_ngn: "100000",
      })),
    );
    // The source Catalogue offer says "₦35,000 off each unit".
    bundleRepo.getCampaignBundle.mockResolvedValue({
      campaign_bundle_price_ngn: null,
      src_pricing_model: "amount_off",
      src_discount_value: "35000",
    });

    const res = await resolveBundleForCheckout({
      brand: "faitlynhair",
      campaign_id: "camp-1",
      bundle_id: "bun-mix-01",
      units: 1,
    });

    expect(fmt(res.sumOfParts)).toBe("600000.00");
    expect(fmt(res.discountNgn)).toBe("210000.00"); // 35,000 × 6 units
    expect(fmt(res.effectivePrice)).toBe("390000.00");
  });
});
