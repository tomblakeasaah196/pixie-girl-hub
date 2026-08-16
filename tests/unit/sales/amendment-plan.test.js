"use strict";

// Change Order re-pricing (§6.2). buildPlan is where an amendment decides what
// the order is now worth, and the rules it has to hold are all about NOT
// quietly changing things the operator didn't touch:
//
//   • a kept line keeps its agreed unit price, its VAT rate and its cost
//     snapshot — a swap must never re-price the wig the customer already
//     agreed to, and a VAT-rate change in settings must never reach back into
//     an order placed under the old rate;
//   • a new line prices exactly as createOrder would, off the order's own
//     sales channel;
//   • the discounts already granted are carried forward, not re-resolved
//     (coupons and points were SPENT on order.paid — re-running the engines
//     would double-redeem);
//   • per-line campaign discounts follow their line per UNIT, so a quantity
//     change scales the saving instead of duplicating or losing it.

const mockConfig = { vat_rate: "0.075" };
let mockVariants;
let mockDiscounts;
let mockOrderLevelDiscounts;

jest.mock("../../../src/modules/business_setup/business-config.repo", () => ({
  findByKey: jest.fn(async () => mockConfig),
}));

jest.mock("../../../src/modules/sales/sales.repo", () => ({
  variantContexts: jest.fn(async ({ variant_ids }) => {
    const m = new Map();
    for (const id of variant_ids) {
      if (mockVariants[id]) m.set(id, { ...mockVariants[id] });
    }
    return m;
  }),
  serviceOfferingContext: jest.fn(async () => null),
  listDiscounts: jest.fn(async () => mockDiscounts),
  findById: jest.fn(async () => null),
}));

jest.mock("../../../src/modules/sales/amendment.repo", () => ({
  listOrderLevelDiscounts: jest.fn(async () => mockOrderLevelDiscounts),
}));

const service = require("../../../src/modules/sales/amendment.service");

// Two wigs in the catalogue. VAT-free base products (taxable=false) unless a
// test says otherwise — Nigerian wig retail is the common case and it keeps the
// arithmetic in these tests readable.
const VARIANT_A = {
  variant_id: "var-A",
  sku: "PXG-A",
  variant_name: "Black · Medium",
  product_id: "prod-A",
  product_name: "Classic Full Frontal",
  price_storefront_ngn: "389000.00",
  price_pos_ngn: "389000.00",
  cost_price_ngn: "150000.00",
  min_price_ngn: "300000.00",
  taxable: false,
  product_vat: null,
  category_id: null,
};
const VARIANT_B = {
  variant_id: "var-B",
  sku: "PXG-B",
  variant_name: "Copper · Medium",
  product_id: "prod-B",
  product_name: "Styled Bodywave",
  price_storefront_ngn: "520000.00",
  price_pos_ngn: "520000.00",
  cost_price_ngn: "240000.00",
  min_price_ngn: "400000.00",
  taxable: false,
  product_vat: null,
  category_id: null,
};

const ORDER = {
  order_id: "ord-1",
  order_number: "PXG-SO-0093",
  contact_id: "contact-1",
  sales_channel: "storefront",
  order_type: "dispatch",
  status: "paid",
  subtotal_ngn: "389000.00",
  discount_amount_ngn: "0.00",
  tax_amount_ngn: "0.00",
  shipping_fee_ngn: "5000.00",
  total_ngn: "394000.00",
  amount_paid_ngn: "394000.00",
  delivery_address_snapshot: {
    line1: "12 Admiralty Way",
    city: "Lekki",
    state: "Lagos",
    country: "Nigeria",
  },
  lines: [
    {
      line_id: "line-A",
      product_id: "prod-A",
      variant_id: "var-A",
      product_name_snapshot: "Classic Full Frontal",
      variant_label_snapshot: "Black · Medium",
      sku_snapshot: "PXG-A",
      quantity: 1,
      unit_price_ngn: "389000.00",
      unit_cost_ngn: "150000.00",
      line_discount_ngn: "0.00",
      tax_rate: "0.0000",
      tax_amount_ngn: "0.00",
      line_total_ngn: "389000.00",
      display_order: 0,
      line_kind: "product",
      styled_id: null,
      service_offering_id: null,
      notes: null,
    },
  ],
};

const plan = (input, order = ORDER) =>
  service.buildPlan({ client: null, brand: "pixiegirl", order, input });

beforeEach(() => {
  mockVariants = { "var-A": VARIANT_A, "var-B": VARIANT_B };
  mockDiscounts = [];
  mockOrderLevelDiscounts = [];
});

describe("no-op", () => {
  test("re-submitting the order unchanged reports no change", async () => {
    const p = await plan({ lines: [{ line_id: "line-A", quantity: 1 }] });
    expect(p.changed).toBe(false);
    expect(p.lineChanges).toEqual([]);
    expect(p.after.total_ngn).toBe("394000.00");
    expect(p.difference.toFixed(2)).toBe("0.00");
  });

  test("a kept line sent as bare { line_id, quantity } keeps its variant", async () => {
    // The modal has no reason to re-send what it isn't changing. Losing the
    // inherited variant_id here would write a NULL over an untouched line and
    // strand its stock.
    const p = await plan({ lines: [{ line_id: "line-A", quantity: 1 }] });
    expect(p.afterLines[0].variant_id).toBe("var-A");
    expect(p.afterLines[0].product_id).toBe("prod-A");
    expect(p.afterLines[0]._source_line_id).toBe("line-A");
  });
});

describe("the wrong-product swap", () => {
  test("prices the replacement off the order's own channel and re-totals", async () => {
    const p = await plan({ lines: [{ variant_id: "var-B", quantity: 1 }] });
    expect(p.after.subtotal_ngn).toBe("520000.00");
    expect(p.after.total_ngn).toBe("525000.00"); // + the ₦5,000 shipping carried forward
    expect(p.difference.toFixed(2)).toBe("131000.00");
    expect(p.balanceAfter.toFixed(2)).toBe("131000.00"); // she owes the uplift
  });

  test("nets the stock movement per variant", async () => {
    const p = await plan({ lines: [{ variant_id: "var-B", quantity: 1 }] });
    expect(p.stockDelta.get("var-A")).toBe(-1);
    expect(p.stockDelta.get("var-B")).toBe(1);
    expect(p.removedLineIds).toEqual(["line-A"]);
  });

  test("snapshots the replacement's own name and SKU", async () => {
    const p = await plan({ lines: [{ variant_id: "var-B", quantity: 1 }] });
    expect(p.afterLines[0].product_name_snapshot).toBe("Styled Bodywave");
    expect(p.afterLines[0].sku_snapshot).toBe("PXG-B");
    expect(p.afterLines[0].unit_cost_ngn).toBe("240000.00");
  });

  test("a downgrade produces a negative difference and a credit balance", async () => {
    mockVariants["var-B"] = { ...VARIANT_B, price_storefront_ngn: "200000.00", min_price_ngn: "100000.00" };
    const p = await plan({ lines: [{ variant_id: "var-B", quantity: 1 }] });
    expect(p.difference.toFixed(2)).toBe("-189000.00");
    expect(p.balanceAfter.toFixed(2)).toBe("-189000.00");
  });
});

describe("a kept line's history is not disturbed", () => {
  test("keeps the agreed unit price even when the catalogue has moved on", async () => {
    mockVariants["var-A"] = { ...VARIANT_A, price_storefront_ngn: "450000.00" };
    const p = await plan({ lines: [{ line_id: "line-A", quantity: 1 }] });
    expect(p.afterLines[0].unit_price_ngn).toBe("389000.00");
    expect(p.difference.toFixed(2)).toBe("0.00");
  });

  test("keeps the original VAT rate even when the brand rate changed", async () => {
    // The order was placed VAT-free; business_config now says 7.5%. Re-taxing
    // it would silently add ₦29,175 to a settled order.
    const p = await plan({ lines: [{ line_id: "line-A", quantity: 2 }] });
    expect(p.afterLines[0].tax_rate).toBe("0.0000");
    expect(p.after.tax_amount_ngn).toBe("0.00");
    expect(p.after.subtotal_ngn).toBe("778000.00");
  });

  test("a VAT-bearing line keeps ITS rate through a quantity change", async () => {
    const vatOrder = {
      ...ORDER,
      lines: [{ ...ORDER.lines[0], tax_rate: "0.0750", tax_amount_ngn: "29175.00", line_total_ngn: "418175.00" }],
    };
    const p = await plan({ lines: [{ line_id: "line-A", quantity: 2 }] }, vatOrder);
    expect(p.afterLines[0].tax_rate).toBe("0.0750");
    expect(p.after.tax_amount_ngn).toBe("58350.00");
  });

  test("keeps the cost snapshot — an amendment is not a revaluation", async () => {
    mockVariants["var-A"] = { ...VARIANT_A, cost_price_ngn: "999999.00" };
    const p = await plan({ lines: [{ line_id: "line-A", quantity: 1 }] });
    expect(p.afterLines[0].unit_cost_ngn).toBe("150000.00");
  });

  test("an explicit price override is honoured", async () => {
    const p = await plan({
      lines: [{ line_id: "line-A", quantity: 1, unit_price_ngn: 350000 }],
    });
    expect(p.afterLines[0].unit_price_ngn).toBe("350000.00");
    expect(p.lineChanges.map((c) => c.action)).toEqual(["price"]);
  });
});

describe("discounts already granted are carried, not re-resolved", () => {
  test("a per-line campaign discount follows its line per UNIT", async () => {
    // ₦20,000 off one unit → doubling the quantity doubles the saving, and the
    // per-unit price the customer agreed to is preserved.
    mockDiscounts = [
      {
        applied_to_line_id: "line-A",
        source: "campaign",
        amount_ngn: "20000.00",
      },
    ];
    const p = await plan({ lines: [{ line_id: "line-A", quantity: 2 }] });
    expect(p.afterLines[0].line_discount_ngn).toBe("40000.00");
    expect(p.after.discount_amount_ngn).toBe("40000.00");
    expect(p.after.subtotal_ngn).toBe("778000.00");
    expect(p.after.total_ngn).toBe("743000.00"); // 778,000 − 40,000 + 5,000
  });

  test("a per-line discount dies with its line when the item is swapped out", async () => {
    mockDiscounts = [
      { applied_to_line_id: "line-A", source: "campaign", amount_ngn: "20000.00" },
    ];
    const p = await plan({ lines: [{ variant_id: "var-B", quantity: 1 }] });
    expect(p.after.discount_amount_ngn).toBe("0.00");
  });

  test("an order-level coupon is re-allocated onto the replacement item", async () => {
    // She was given ₦50,000 off at checkout and the coupon was already spent on
    // order.paid. Dropping it on a swap would be taking it back.
    mockOrderLevelDiscounts = [
      { source: "coupon", discount_type: "fixed", amount_ngn: "50000.00" },
    ];
    const p = await plan({ lines: [{ variant_id: "var-B", quantity: 1 }] });
    expect(p.after.discount_amount_ngn).toBe("50000.00");
    expect(p.after.total_ngn).toBe("475000.00"); // 520,000 − 50,000 + 5,000
    expect(p.carriedDiscounts.applied.toFixed(2)).toBe("50000.00");
  });

  test("a free-shipping coupon is NOT re-allocated onto the lines", async () => {
    // Its value was applied by zeroing shipping, which is carried forward
    // as-is. Allocating it again would give the saving twice.
    mockOrderLevelDiscounts = [
      { source: "coupon", discount_type: "free_shipping", amount_ngn: "5000.00" },
    ];
    const p = await plan({ lines: [{ line_id: "line-A", quantity: 1 }] });
    expect(p.after.discount_amount_ngn).toBe("0.00");
    expect(p.carriedDiscounts.freeShipping.toFixed(2)).toBe("5000.00");
  });

  test("a discount the new cart cannot absorb is clipped, and says so", async () => {
    mockOrderLevelDiscounts = [
      { source: "coupon", discount_type: "fixed", amount_ngn: "900000.00" },
    ];
    const p = await plan({ lines: [{ line_id: "line-A", quantity: 1 }] });
    expect(p.carriedDiscounts.requested.toFixed(2)).toBe("900000.00");
    expect(p.carriedDiscounts.applied.toFixed(2)).toBe("389000.00"); // down to ₦0, never negative
    expect(p.after.total_ngn).toBe("5000.00"); // shipping only
  });
});

describe("delivery", () => {
  test("an unchanged address is not a change", async () => {
    const p = await plan({
      lines: [{ line_id: "line-A", quantity: 1 }],
      delivery_address: { city: "Lekki", state: "Lagos" },
    });
    expect(p.addressMoved).toBe(false);
    expect(p.deliveryTouched).toBe(false);
    expect(p.changed).toBe(false);
  });

  test("a moved address is a change on its own, with no line edits", async () => {
    const p = await plan({
      lines: [{ line_id: "line-A", quantity: 1 }],
      delivery_address: { line1: "4 Ozumba Mbadiwe", city: "Victoria Island" },
    });
    expect(p.addressMoved).toBe(true);
    expect(p.changed).toBe(true);
    expect(p.lineChanges).toEqual([]);
    // The patch merges onto the existing snapshot rather than replacing it.
    expect(p.deliveryAfter.address.state).toBe("Lagos");
    expect(p.deliveryAfter.address.line1).toBe("4 Ozumba Mbadiwe");
  });

  test("a shipping-fee change alone counts as a change", async () => {
    const p = await plan({
      lines: [{ line_id: "line-A", quantity: 1 }],
      shipping_fee_ngn: 12000,
    });
    expect(p.deliveryTouched).toBe(true);
    expect(p.after.total_ngn).toBe("401000.00");
    expect(p.difference.toFixed(2)).toBe("7000.00");
  });

  test("shipping is carried forward untouched when the caller omits it", async () => {
    const p = await plan({ lines: [{ variant_id: "var-B", quantity: 1 }] });
    expect(p.after.shipping_fee_ngn).toBe("5000.00");
  });
});

describe("guards", () => {
  test("a line_id that isn't on this order is rejected, not silently added", async () => {
    await expect(
      plan({ lines: [{ line_id: "line-ZZZ", quantity: 1 }] }),
    ).rejects.toMatchObject({ code: "REFERENCE_INVALID" });
  });

  test("an unknown variant is rejected", async () => {
    await expect(
      plan({ lines: [{ variant_id: "var-NOPE", quantity: 1 }] }),
    ).rejects.toMatchObject({ code: "REFERENCE_INVALID" });
  });
});
