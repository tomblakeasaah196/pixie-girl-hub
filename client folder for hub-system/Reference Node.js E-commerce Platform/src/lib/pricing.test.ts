import { describe, it, expect } from "vitest";
import { computeOrderTotals, computeBulkDiscount, shippingThreshold, isFreeShipping, BULK_TIERS } from "./pricing";
import type { CartLine } from "./cart";

const line = (price: number, qty = 1, slug = "x"): CartLine => ({
  id: `${slug}::v`, slug, name: slug, image: "", price, variant: "v", qty,
});

describe("shippingThreshold", () => {
  it("defaults to $2000 worldwide", () => {
    expect(shippingThreshold()).toBe(2000);
    expect(shippingThreshold("United States")).toBe(2000);
    expect(shippingThreshold("")).toBe(2000);
  });
  it("is $1000 for Nigeria (case + alias insensitive)", () => {
    for (const c of ["Nigeria", "nigeria", "NIGERIA", "ng", "NGA"]) {
      expect(shippingThreshold(c)).toBe(1000);
    }
  });
});

describe("isFreeShipping boundary behavior", () => {
  it("Nigeria: $999 paid, $1000 free", () => {
    expect(isFreeShipping(999, "Nigeria")).toBe(false);
    expect(isFreeShipping(1000, "Nigeria")).toBe(true);
    expect(isFreeShipping(1001, "Nigeria")).toBe(true);
  });
  it("Worldwide: $1999 paid, $2000 free", () => {
    expect(isFreeShipping(1999, "United States")).toBe(false);
    expect(isFreeShipping(2000, "United States")).toBe(true);
    expect(isFreeShipping(2000)).toBe(true);
  });
});

describe("computeBulkDiscount tiers", () => {
  it("0 qty → no discount", () => {
    expect(computeBulkDiscount([]).amount).toBe(0);
  });
  it("1 qty → no discount", () => {
    expect(computeBulkDiscount([line(500, 1)]).amount).toBe(0);
  });
  it("2 qty → $40 off", () => {
    expect(computeBulkDiscount([line(500, 2)]).amount).toBe(40);
  });
  it("3 qty → $90 off (highest matching tier)", () => {
    expect(computeBulkDiscount([line(500, 3)]).amount).toBe(90);
  });
  it("4+ qty stays at the highest defined tier", () => {
    const max = BULK_TIERS[BULK_TIERS.length - 1].discount;
    expect(computeBulkDiscount([line(500, 7)]).amount).toBe(max);
  });
  it("counts qty across mixed line items", () => {
    expect(computeBulkDiscount([line(300, 1, "a"), line(400, 2, "b")]).amount).toBe(90);
  });
});

describe("computeOrderTotals — Nigeria $1000 boundary", () => {
  it("$999 subtotal (1 item) → not free, $1 to threshold", () => {
    const t = computeOrderTotals([line(999, 1)], "Nigeria");
    expect(t.subtotal).toBe(999);
    expect(t.bulkDiscount).toBe(0);
    expect(t.freeShipping).toBe(false);
    expect(t.shippingThreshold).toBe(1000);
    expect(t.amountToFreeShipping).toBe(1);
    expect(t.total).toBe(999);
  });
  it("$1000 subtotal exactly → free shipping", () => {
    const t = computeOrderTotals([line(1000, 1)], "Nigeria");
    expect(t.freeShipping).toBe(true);
    expect(t.amountToFreeShipping).toBe(0);
  });
  it("bulk discount can push below the Nigeria threshold", () => {
    // 2 × $520 = $1040, − $40 bulk = $1000 → still free in Nigeria
    const t = computeOrderTotals([line(520, 2)], "Nigeria");
    expect(t.subtotal).toBe(1040);
    expect(t.bulkDiscount).toBe(40);
    expect(t.afterDiscount).toBe(1000);
    expect(t.freeShipping).toBe(true);
  });
  it("bulk discount that drops total below threshold loses free shipping", () => {
    // 2 × $510 = $1020, − $40 = $980 → not free in Nigeria
    const t = computeOrderTotals([line(510, 2)], "Nigeria");
    expect(t.afterDiscount).toBe(980);
    expect(t.freeShipping).toBe(false);
    expect(t.amountToFreeShipping).toBe(20);
  });
});

describe("computeOrderTotals — Worldwide $2000 boundary", () => {
  it("$1999 → not free", () => {
    const t = computeOrderTotals([line(1999, 1)], "United States");
    expect(t.freeShipping).toBe(false);
    expect(t.shippingThreshold).toBe(2000);
    expect(t.amountToFreeShipping).toBe(1);
  });
  it("$2000 exactly → free", () => {
    const t = computeOrderTotals([line(2000, 1)], "United States");
    expect(t.freeShipping).toBe(true);
  });
  it("no country provided → worldwide threshold", () => {
    const t = computeOrderTotals([line(2000, 1)]);
    expect(t.shippingThreshold).toBe(2000);
    expect(t.freeShipping).toBe(true);
  });
  it("3 × $700 = $2100, − $90 = $2010 → free worldwide", () => {
    const t = computeOrderTotals([line(700, 3)], "France");
    expect(t.subtotal).toBe(2100);
    expect(t.bulkDiscount).toBe(90);
    expect(t.afterDiscount).toBe(2010);
    expect(t.freeShipping).toBe(true);
  });
});

describe("computeOrderTotals — empty bag", () => {
  it("returns zeros, not free shipping", () => {
    const t = computeOrderTotals([], "Nigeria");
    expect(t.subtotal).toBe(0);
    expect(t.total).toBe(0);
    expect(t.freeShipping).toBe(false);
    expect(t.amountToFreeShipping).toBe(1000);
  });
});
