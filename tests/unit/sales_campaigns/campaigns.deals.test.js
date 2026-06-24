"use strict";

const {
  computeDeals,
} = require("../../../src/modules/sales_campaigns/campaigns.deals.service");

// Faith's spec, verbatim:
//   position ladder: 1st 16k, 2nd 25k, 3rd 28k, 4th 30k, 5th 32k (SUMMED)
//   stacking bonus:  2 distinct bundles ⇒ ₦120,000
//   bulk/reseller:   12+ raw wigs ⇒ ₦67,000/wig, 20+ ⇒ ₦90,000/wig
const campaign = {
  position_ladder: [
    { position: 1, discount_ngn: 16000, label: "1st wig" },
    { position: 2, discount_ngn: 25000, label: "2nd wig" },
    { position: 3, discount_ngn: 28000, label: "3rd wig" },
    { position: 4, discount_ngn: 30000, label: "4th wig" },
    { position: 5, discount_ngn: 32000, label: "5th wig" },
  ],
  stacking_bonus: {
    min_distinct_bundles: 2,
    discount_ngn: 120000,
    label: "Combine 2 bundles",
  },
  bulk_tiers: [
    { min_qty: 12, discount_per_item_ngn: 67000, label: "Reseller" },
    { min_qty: 20, discount_per_item_ngn: 90000, label: "Wholesale" },
  ],
};

const styled = (qty, price = 200000) => ({
  kind: "styled",
  unit_price_ngn: price,
  quantity: qty,
});
const raw = (qty, price = 150000) => ({
  kind: "raw",
  unit_price_ngn: price,
  quantity: qty,
});
const bundle = (id, qty = 1, price = 300000, wig_units = 1) => ({
  kind: "bundle",
  bundle_id: id,
  unit_price_ngn: price,
  quantity: qty,
  wig_units,
});

describe("position ladder (summed per filled position)", () => {
  it("sums discounts for each wig position", () => {
    const r = computeDeals({ campaign, lines: [styled(3)] });
    // 16k + 25k + 28k = 69,000
    expect(r.components.position_ladder.discount_ngn).toBe("69000.00");
    expect(r.components.position_ladder.filled_positions).toBe(3);
  });

  it("a single wig earns only the first rung", () => {
    const r = computeDeals({ campaign, lines: [styled(1)] });
    expect(r.components.position_ladder.discount_ngn).toBe("16000.00");
  });

  it("wigs beyond the last defined rung add nothing more", () => {
    const r = computeDeals({ campaign, lines: [styled(7)] });
    // 16+25+28+30+32 = 131,000 (5 rungs only)
    expect(r.components.position_ladder.discount_ngn).toBe("131000.00");
    expect(r.components.position_ladder.filled_positions).toBe(5);
  });

  it("surfaces the next rung as a nudge", () => {
    const r = computeDeals({ campaign, lines: [styled(2)] });
    expect(r.components.position_ladder.next).toMatchObject({
      position: 3,
      add_wigs: 1,
      extra_discount_ngn: "28000.00",
    });
  });
});

describe("bundle stacking bonus", () => {
  it("unlocks the bonus at N distinct bundles", () => {
    const r = computeDeals({
      campaign,
      lines: [bundle("A"), bundle("B")],
    });
    expect(r.components.stacking_bonus.applied).toBe(true);
    expect(r.components.stacking_bonus.discount_ngn).toBe("120000.00");
  });

  it("does NOT unlock from quantity of the same bundle", () => {
    const r = computeDeals({ campaign, lines: [bundle("A", 2)] });
    expect(r.components.stacking_bonus.applied).toBe(false);
    expect(r.components.stacking_bonus.next.add_bundles).toBe(1);
  });
});

describe("reseller / bulk tier (per-item × qty, raw wigs only)", () => {
  it("applies ₦67k/wig at 12 raw wigs", () => {
    const r = computeDeals({ campaign, lines: [raw(12)] });
    expect(r.components.bulk_tier.applied).toBe(true);
    expect(r.components.bulk_tier.discount_ngn).toBe("804000.00"); // 67k × 12
  });

  it("upgrades to ₦90k/wig at 20 raw wigs", () => {
    const r = computeDeals({ campaign, lines: [raw(20)] });
    expect(r.components.bulk_tier.discount_ngn).toBe("1800000.00"); // 90k × 20
  });

  it("ignores styled wigs for the bulk tier", () => {
    const r = computeDeals({ campaign, lines: [styled(12)] });
    expect(r.components.bulk_tier.applied).toBe(false);
  });

  it("raw wigs do NOT feed the per-wig position ladder", () => {
    const r = computeDeals({ campaign, lines: [raw(3)] });
    expect(r.components.position_ladder.applied).toBe(false);
    expect(r.components.position_ladder.discount_ngn).toBe("0.00");
  });

  it("mixed cart: styled feeds the ladder, raw feeds bulk", () => {
    const r = computeDeals({
      campaign,
      lines: [styled(2, 300000), raw(12, 150000)],
    });
    // position ladder on 2 styled wigs: 16k + 25k = 41k
    expect(r.components.position_ladder.discount_ngn).toBe("41000.00");
    // bulk on 12 raw wigs: 67k × 12 = 804k
    expect(r.components.bulk_tier.discount_ngn).toBe("804000.00");
  });
});

describe("quantity-tier ladder", () => {
  const tiers = [
    { tier_id: "t1", min_quantity: 2, fixed_discount_ngn: 10000, is_active: true },
    { tier_id: "t2", min_quantity: 5, fixed_discount_ngn: 50000, is_active: true },
    { tier_id: "t3", min_quantity: 10, fixed_discount_ngn: 100000, is_active: true },
  ];
  it("picks the highest qualifying tier", () => {
    const r = computeDeals({ campaign, lines: [styled(10)], tiers });
    expect(r.components.quantity_tier.discount_ngn).toBe("100000.00");
    expect(r.components.quantity_tier.tier_id).toBe("t3");
  });
  it("nudges toward the next tier", () => {
    const r = computeDeals({ campaign, lines: [styled(3)], tiers });
    expect(r.components.quantity_tier.discount_ngn).toBe("10000.00");
    expect(r.components.quantity_tier.next.add_quantity).toBe(2);
  });
});

describe("stacking + floor clamp", () => {
  it("stacks all rules additively", () => {
    const tiers = [
      { tier_id: "t1", min_quantity: 2, fixed_discount_ngn: 10000, is_active: true },
    ];
    // 2 distinct bundles, each 1 wig, priced high so nothing clamps.
    const r = computeDeals({
      campaign,
      lines: [bundle("A", 1, 500000), bundle("B", 1, 500000)],
      tiers,
    });
    // position: 2 wig units ⇒ 16k+25k = 41k
    // stacking: 120k
    // quantity tier (qty 2): 10k
    // bulk: 0 (no raw)
    // total = 171,000
    expect(r.gross_discount_ngn).toBe("171000.00");
    expect(r.total_discount_ngn).toBe("171000.00");
    expect(r.clamped).toBe(false);
  });

  it("clamps the total at the margin floor", () => {
    // One styled wig priced 200k with a 190k floor ⇒ only 10k of headroom,
    // but the position ladder alone wants 16k off.
    const r = computeDeals({
      campaign,
      lines: [{ kind: "styled", unit_price_ngn: 200000, quantity: 1, floor_ngn: 190000 }],
    });
    expect(r.gross_discount_ngn).toBe("16000.00");
    expect(r.total_discount_ngn).toBe("10000.00");
    expect(r.clamped).toBe(true);
    expect(r.final_total_ngn).toBe("190000.00");
  });
});

describe("empty / no-config carts", () => {
  it("returns zero discount for a campaign with no deal config", () => {
    const r = computeDeals({ campaign: {}, lines: [styled(3)] });
    expect(r.total_discount_ngn).toBe("0.00");
  });
  it("handles an empty cart", () => {
    const r = computeDeals({ campaign, lines: [] });
    expect(r.total_discount_ngn).toBe("0.00");
    expect(r.final_total_ngn).toBe("0.00");
  });
});
