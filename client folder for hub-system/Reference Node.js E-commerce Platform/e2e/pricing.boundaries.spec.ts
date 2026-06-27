import { test, expect } from "@playwright/test";
import { computeOrderTotals, shippingThreshold } from "../src/lib/pricing";

/**
 * Boundary checks at exactly the free-shipping thresholds.
 * These mirror the pricing rules baked into the cart UI so we can prove
 * the published behaviour without standing up a full cart in the browser.
 */

function line(price: number, qty = 1) {
  return {
    id: `sku-${price}-${qty}`,
    slug: `sku-${price}`,
    name: `SKU ${price}`,
    image: "",
    price,
    variant: "default",
    qty,
  };
}

test.describe("Free-shipping thresholds", () => {
  test("Nigeria threshold is $1000, worldwide is $2000", () => {
    expect(shippingThreshold("Nigeria")).toBe(1000);
    expect(shippingThreshold("NG")).toBe(1000);
    expect(shippingThreshold("United States")).toBe(2000);
    expect(shippingThreshold(undefined)).toBe(2000);
  });

  test("Nigeria · subtotal exactly $1000 qualifies for free shipping", () => {
    const t = computeOrderTotals([line(1000)], "Nigeria");
    expect(t.afterDiscount).toBe(1000);
    expect(t.freeShipping).toBe(true);
    expect(t.amountToFreeShipping).toBe(0);
  });

  test("Nigeria · $999 does not qualify, prompts $1 to free", () => {
    const t = computeOrderTotals([line(999)], "Nigeria");
    expect(t.freeShipping).toBe(false);
    expect(t.amountToFreeShipping).toBe(1);
  });

  test("Worldwide · subtotal exactly $2000 qualifies for free shipping", () => {
    const t = computeOrderTotals([line(2000)], "United States");
    expect(t.freeShipping).toBe(true);
    expect(t.amountToFreeShipping).toBe(0);
  });

  test("Worldwide · $1999 prompts $1 to free shipping", () => {
    const t = computeOrderTotals([line(1999)], "United States");
    expect(t.freeShipping).toBe(false);
    expect(t.amountToFreeShipping).toBe(1);
  });

  test("Bulk discount $40 at 2 pieces lowers the bag below the threshold (worldwide)", () => {
    // Two $1020 items = $2040 subtotal, $40 bulk = $2000 — exact threshold.
    const t = computeOrderTotals([line(1020, 2)], "United States");
    expect(t.subtotal).toBe(2040);
    expect(t.bulkDiscount).toBe(40);
    expect(t.afterDiscount).toBe(2000);
    expect(t.freeShipping).toBe(true);
  });

  test("Bulk discount $90 at 3 pieces (Nigeria boundary)", () => {
    // Three pieces totalling $1090 - $90 = $1000 exactly.
    const lines = [line(363, 2), line(364, 1)];
    const t = computeOrderTotals(lines, "Nigeria");
    expect(t.subtotal).toBe(1090);
    expect(t.bulkDiscount).toBe(90);
    expect(t.afterDiscount).toBe(1000);
    expect(t.freeShipping).toBe(true);
  });
});
