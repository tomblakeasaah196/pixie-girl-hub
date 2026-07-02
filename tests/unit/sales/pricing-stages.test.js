"use strict";

/**
 * Sales pricing stages (modules/sales/pricing/*) — pure-function tests.
 * These pin the §6.25 allocation semantics extracted from createOrderTx:
 * proportional headroom allocation with remainder-to-last, floor clamps,
 * coupon best-of decision, points conversion, bundle models, VAT totals.
 */

const { money } = require("../../../src/utils/money");
const {
  createDiscountAllocator,
} = require("../../../src/modules/sales/pricing/allocator");
const {
  clampToMarginFloor,
} = require("../../../src/modules/sales/pricing/margin-floor");
const {
  resolveCouponApplication,
  campaignDiscountTotal,
} = require("../../../src/modules/sales/pricing/coupon");
const {
  computePointsRedemption,
} = require("../../../src/modules/sales/pricing/points");
const {
  assertBundleComplete,
  computeBundleDiscount,
} = require("../../../src/modules/sales/pricing/bundle");
const {
  exitIntentMatches,
} = require("../../../src/modules/sales/pricing/exit-intent");
const {
  computeTotalsAndLines,
  computeDepositPolicy,
} = require("../../../src/modules/sales/pricing/totals");
const {
  channelPrice,
} = require("../../../src/modules/sales/pricing/channel-price");

/** Build a line: unit price, qty, min_price floor (null = no floor). */
function line(unit, qty, min = null, extraCtx = {}, extraLi = {}) {
  return {
    unit: money(unit),
    perUnitDiscount: money(0),
    li: { quantity: qty, variant_id: extraLi.variant_id || "v-x", ...extraLi },
    ctx: { min_price_ngn: min, product_id: "p-x", ...extraCtx },
  };
}

const n = (d) => d.toFixed(2);

describe("allocator", () => {
  it("computes preNet from clamped per-unit discounts × qty", () => {
    const built = [line("100", 2), line("50", 1)];
    built[0].perUnitDiscount = money("10");
    const a = createDiscountAllocator(built);
    expect(n(a.preNet)).toBe("230.00"); // (100-10)*2 + 50
    expect(n(a.preNetByIdx[0])).toBe("180.00");
  });

  it("allocates proportionally to headroom, remainder to the last line", () => {
    // Headroom: line0 = 100 (floorless → full preNet), line1 = 50.
    const built = [line("100", 1), line("100", 1, "50")];
    const a = createDiscountAllocator(built);
    const applied = a.applyOrderDiscount(money("30"));
    expect(n(applied)).toBe("30.00");
    // 30 × 100/150 = 20 to line0; last line takes the exact remainder (10).
    expect(n(a.extraShareByIdx[0])).toBe("20.00");
    expect(n(a.extraShareByIdx[1])).toBe("10.00");
    // Allocated total always equals the applied amount exactly.
    expect(
      n(a.extraShareByIdx.reduce((s, x) => s.plus(x), money(0))),
    ).toBe("30.00");
  });

  it("caps at available headroom (never sells below floor)", () => {
    const built = [line("100", 1, "80")]; // headroom 20
    const a = createDiscountAllocator(built);
    expect(n(a.applyOrderDiscount(money("500")))).toBe("20.00");
    expect(n(a.headroomLeft())).toBe("0.00");
    // A second floor-respecting discount now applies nothing.
    expect(n(a.applyOrderDiscount(money("5")))).toBe("0.00");
  });

  it("floor-free allocation keeps going after headroom is exhausted", () => {
    const built = [line("100", 1, "80")]; // headroom 20, net 100
    const a = createDiscountAllocator(built);
    a.applyOrderDiscount(money("20")); // exhaust headroom
    // Deal ladder ignores the floor: remaining net = 100 - 20 = 80.
    expect(n(a.applyFloorFreeDiscount(money("80")))).toBe("80.00");
    expect(n(a.extraShareByIdx[0])).toBe("100.00");
    // …but never goes negative.
    expect(n(a.applyFloorFreeDiscount(money("1")))).toBe("0.00");
  });

  it("returns 0 for a non-positive request", () => {
    const a = createDiscountAllocator([line("100", 1)]);
    expect(n(a.applyOrderDiscount(money("0")))).toBe("0.00");
    expect(n(a.applyFloorFreeDiscount(money("-5")))).toBe("0.00");
  });
});

describe("clampToMarginFloor", () => {
  it("caps the per-unit discount at unit − floor", () => {
    const b = line("100", 1, "70");
    b.perUnitDiscount = money("40");
    clampToMarginFloor([b]);
    expect(n(b.perUnitDiscount)).toBe("30.00");
  });

  it("zeroes the discount when the floor exceeds the unit price", () => {
    const b = line("100", 1, "120");
    b.perUnitDiscount = money("10");
    clampToMarginFloor([b]);
    expect(n(b.perUnitDiscount)).toBe("0.00");
  });

  it("leaves floor-less lines untouched", () => {
    const b = line("100", 1, null);
    b.perUnitDiscount = money("99");
    clampToMarginFloor([b]);
    expect(n(b.perUnitDiscount)).toBe("99.00");
  });
});

describe("resolveCouponApplication", () => {
  const base = {
    coupon: { discount_type: "fixed" },
    discount_ngn: "30",
    preNet: money("200"),
  };

  it("free_shipping is orthogonal to item pricing", () => {
    const d = resolveCouponApplication({
      ...base,
      coupon: { discount_type: "free_shipping" },
      campaignActive: true,
      allowStacking: false,
      campaignDiscountTotal: money("100"),
    });
    expect(d.kind).toBe("free_shipping");
  });

  it("applies fully when stacking is allowed (capped at preNet)", () => {
    const d = resolveCouponApplication({
      ...base,
      discount_ngn: "999",
      campaignActive: true,
      allowStacking: true,
      campaignDiscountTotal: money("100"),
    });
    expect(d.kind).toBe("apply");
    expect(n(d.requested)).toBe("200.00");
  });

  it("non-stacking sale: tops up when the coupon beats the sale", () => {
    const d = resolveCouponApplication({
      ...base,
      campaignActive: true,
      allowStacking: false,
      campaignDiscountTotal: money("10"),
    });
    expect(d.kind).toBe("top_up");
    expect(n(d.requested)).toBe("20.00"); // 30 − 10 already given by the sale
    expect(d.notice.code).toBe("COUPON_APPLIED_BEST");
  });

  it("non-stacking sale: keeps the sale when it is the bigger saving", () => {
    const d = resolveCouponApplication({
      ...base,
      campaignActive: true,
      allowStacking: false,
      campaignDiscountTotal: money("50"),
    });
    expect(d.kind).toBe("keep_sale");
    expect(d.notice.code).toBe("SALE_PRICE_KEPT");
  });

  it("sums the per-line campaign discount", () => {
    const built = [line("100", 2), line("50", 1)];
    built[0].perUnitDiscount = money("5");
    expect(n(campaignDiscountTotal(built))).toBe("10.00");
  });
});

describe("computePointsRedemption", () => {
  it("converts at naira_per_point within headroom", () => {
    const r = computePointsRedemption({
      points: 100,
      nairaPerPoint: "10",
      headroomAvailable: money("5000"),
    });
    expect(r.usePts).toBe(100);
    expect(n(r.value)).toBe("1000.00");
  });

  it("shrinks the redemption to fit remaining headroom (whole points)", () => {
    const r = computePointsRedemption({
      points: 100,
      nairaPerPoint: "10",
      headroomAvailable: money("955"),
    });
    expect(r.usePts).toBe(95);
    expect(n(r.value)).toBe("950.00");
  });

  it("defaults the rate to ₦10/point", () => {
    const r = computePointsRedemption({
      points: 3,
      nairaPerPoint: undefined,
      headroomAvailable: money("1000"),
    });
    expect(n(r.value)).toBe("30.00");
  });
});

describe("bundle", () => {
  const CORE = { product_id: "p-a", quantity: 2, role: "core" };
  const bundleOf = (model, extra = {}) => ({
    pricing_model: model,
    components: [CORE],
    ...extra,
  });
  const cart = () => [
    line("100", 2, null, { product_id: "p-a" }),
    line("40", 1, null, { product_id: "p-z" }),
  ];

  it("throws BUNDLE_INCOMPLETE when a core component is short", () => {
    const built = [line("100", 1, null, { product_id: "p-a" })]; // needs 2
    expect(() =>
      assertBundleComplete(bundleOf("pct_off"), built),
    ).toThrow("Bundle components missing");
  });

  it("passes when core quantities are met", () => {
    expect(() =>
      assertBundleComplete(bundleOf("pct_off"), cart()),
    ).not.toThrow();
  });

  it.each([
    ["fixed_bundle_price", { bundle_price_ngn: "150" }, "50.00"], // 200 − 150
    ["pct_off", { discount_value: "0.10" }, "20.00"], // 10% of 200
    ["amount_off", { discount_value: "500" }, "200.00"], // capped at subtotal
  ])("computes %s on the component subtotal", (model, extra, expected) => {
    const d = computeBundleDiscount({
      bundle: bundleOf(model, extra),
      built: cart(),
      preNetByIdx: [money("200"), money("40")],
      quantityBundleDiscount: () => money("0"),
    });
    expect(n(d)).toBe(expected);
  });

  it("delegates quantity models to the injected function", () => {
    const spy = jest.fn(() => money("33"));
    const d = computeBundleDiscount({
      bundle: bundleOf("buy_x_get_y"),
      built: cart(),
      preNetByIdx: [money("200"), money("40")],
      quantityBundleDiscount: spy,
    });
    expect(n(d)).toBe("33.00");
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        pricing_model: "buy_x_get_y",
        component_subtotal_ngn: expect.anything(),
      }),
    );
  });
});

describe("exitIntentMatches", () => {
  const row = {
    exit_intent_enabled: true,
    exit_intent_code: " stay10 ",
    exit_intent_discount_ngn: "1000",
  };

  it("matches a live campaign's code case/whitespace-insensitively", () => {
    expect(exitIntentMatches(row, "STAY10", "live")).toBe(true);
  });

  it.each([
    ["not live", row, "STAY10", "scheduled"],
    ["disabled", { ...row, exit_intent_enabled: false }, "STAY10", "live"],
    ["wrong code", row, "OTHER", "live"],
    ["zero discount", { ...row, exit_intent_discount_ngn: "0" }, "STAY10", "live"],
    ["null row", null, "STAY10", null],
  ])("rejects when %s", (_label, r, code, state) => {
    expect(exitIntentMatches(r, code, state)).toBe(false);
  });
});

describe("computeTotalsAndLines", () => {
  it("taxes the post-discount base and folds order-level shares per line", () => {
    const built = [
      line("100", 2, null, {
        product_name: "Wig A",
        sku: "SKU-A",
        cost_price_ngn: "60.00",
      }),
    ];
    built[0].perUnitDiscount = money("10");
    const { subtotal, discountTotal, taxTotal, lineRows } =
      computeTotalsAndLines({
        built,
        extraShareByIdx: [money("30")], // order-level share for this line
        defaultVat: money("0.075"),
      });
    expect(n(subtotal)).toBe("200.00");
    expect(n(discountTotal)).toBe("50.00"); // 10×2 + 30
    expect(n(taxTotal)).toBe("11.25"); // (200−50) × 7.5%
    expect(lineRows[0].line_discount_ngn).toBe("50.00");
    expect(lineRows[0]._campaign_resolve_discount_ngn).toBe("20.00");
    expect(lineRows[0].line_total_ngn).toBe("161.25");
    expect(lineRows[0].tax_rate).toBe("0.0750");
  });

  it("honours per-product VAT override and non-taxable contexts", () => {
    const built = [
      line("100", 1, null, { product_vat: "0.05" }),
      line("100", 1, null, { taxable: false }),
    ];
    const { taxTotal, lineRows } = computeTotalsAndLines({
      built,
      extraShareByIdx: [money(0), money(0)],
      defaultVat: money("0.075"),
    });
    expect(n(taxTotal)).toBe("5.00");
    expect(lineRows[1].tax_amount_ngn).toBe("0.00");
  });

  it("classifies line_kind for service / styled / product lines", () => {
    const built = [
      line("100", 1, null, {}, { service_offering_id: "s-1" }),
      line("100", 1, null, {}, { styled_id: "st-1" }),
      line("100", 1),
    ];
    const { lineRows } = computeTotalsAndLines({
      built,
      extraShareByIdx: [money(0), money(0), money(0)],
      defaultVat: money(0),
    });
    expect(lineRows.map((l) => l.line_kind)).toEqual([
      "service",
      "styled",
      "product",
    ]);
  });
});

describe("computeDepositPolicy", () => {
  it("snapshots the deposit for deposit_triggered orders (default 50%)", () => {
    const built = [line("100", 1, null, { payment_model: "deposit_triggered" })];
    const p = computeDepositPolicy({
      built,
      installmentSettings: {},
      input: {},
      total: money("1000"),
    });
    expect(p.paymentModel).toBe("deposit_triggered");
    expect(p.requiredDepositPct.toFixed(2)).toBe("50.00");
    expect(n(p.requiredDepositNgn)).toBe("500.00");
  });

  it("prefers the input override, then business settings", () => {
    const built = [line("100", 1, null, { payment_model: "deposit_triggered" })];
    const withInput = computeDepositPolicy({
      built,
      installmentSettings: { default_deposit_pct_for_deposit_triggered: 30 },
      input: { required_deposit_pct: 70 },
      total: money("1000"),
    });
    expect(n(withInput.requiredDepositNgn)).toBe("700.00");
    const withSettings = computeDepositPolicy({
      built,
      installmentSettings: { default_deposit_pct_for_deposit_triggered: 30 },
      input: {},
      total: money("1000"),
    });
    expect(n(withSettings.requiredDepositNgn)).toBe("300.00");
  });

  it("defaults to layaway with no deposit snapshot", () => {
    const p = computeDepositPolicy({
      built: [line("100", 1)],
      installmentSettings: {},
      input: {},
      total: money("1000"),
    });
    expect(p.paymentModel).toBe("layaway");
    expect(p.requiredDepositPct).toBeNull();
    expect(p.requiredDepositNgn).toBeNull();
  });
});

describe("channelPrice", () => {
  const ctx = {
    price_storefront_ngn: "100",
    price_pos_ngn: "90",
    price_wholesale_ngn: "70",
    price_partner_ngn: "80",
  };

  it.each([
    ["pos", "90"],
    ["wholesale", "70"],
    ["intercompany", "70"],
    ["partner", "80"],
    ["stylist_routed", "80"],
    ["storefront", "100"],
  ])("picks the %s tier", (channel, expected) => {
    expect(channelPrice(ctx, channel)).toBe(expected);
  });

  it("falls back to the storefront tier when a tier is missing", () => {
    expect(channelPrice({ price_storefront_ngn: "100" }, "pos")).toBe("100");
  });
});
