"use strict";

// Post-hoc coupon resolution (§6.2 / §6.23.2) — what a code is worth on an
// order that was already placed, and what it is allowed to waive.
//
// The load-bearing rule (owner decision): the waiver is CAPPED AT THE
// OUTSTANDING BALANCE. A code worth more than the balance settles the order and
// no more — it never drives the order into credit, never opens a refund, and
// never leaves a liability on a screen with no authority to discharge one.
// `previewOrderCoupon` and `applyOrderCoupon` both run this same function, so
// the figure staff read before committing is the figure that gets committed.

const mockCouponService = { validateCoupon: jest.fn() };

jest.mock("../../../src/modules/retention/coupon.service", () => mockCouponService);
jest.mock("../../../src/modules/sales/sales.repo", () => ({}));
jest.mock("../../../src/modules/sales/amendment.repo", () => ({}));
jest.mock("../../../src/modules/sales/timeline.repo", () => ({}));
jest.mock("../../../src/modules/retention/coupon.repo", () => ({}));
jest.mock("../../../src/modules/accounting/accounting.repo", () => ({}));
jest.mock("../../../src/modules/invoicing/invoicing.service", () => ({}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(),
  withSavepoint: jest.fn(),
}));

const {
  resolveForOrder,
  assertCouponable,
} = require("../../../src/modules/sales/order-coupon.service");

// The order from the screenshot this feature was built for: a ₦404,000 frontal,
// ₦389,000 already taken at the Nomba terminal, ₦15,000 still owed.
const ORDER = {
  order_id: "ord-1",
  order_number: "FLH-SO-0125",
  contact_id: "contact-1",
  status: "partially_paid",
  subtotal_ngn: "404000.00",
  discount_amount_ngn: "0.00",
  tax_amount_ngn: "0.00",
  shipping_fee_ngn: "0.00",
  total_ngn: "404000.00",
  amount_paid_ngn: "389000.00",
  balance_due_ngn: "15000.00",
  coupon_code: null,
};

const coupon = (over = {}) => ({
  coupon_id: "coup-1",
  coupon_code: "WELCOME10",
  display_name: "Welcome 10%",
  discount_type: "fixed_amount",
  ...over,
});

const validates = (discount_ngn, over = {}) =>
  mockCouponService.validateCoupon.mockResolvedValue({
    valid: true,
    coupon: coupon(over),
    discount_ngn,
    discount_type: over.discount_type || "fixed_amount",
  });

const args = (order = ORDER) => ({
  brand: "faitlynhair",
  order,
  code: "WELCOME10",
});

beforeEach(() => jest.clearAllMocks());

describe("the cap — a code worth more than what is left to pay", () => {
  test("waives only the balance, not the code's full value", async () => {
    validates("20000.00"); // worth ₦20,000; only ₦15,000 is owed
    const r = await resolveForOrder(args());

    expect(r.valid).toBe(true);
    expect(r.applied.toFixed(2)).toBe("15000.00");
    expect(r.raw.toFixed(2)).toBe("20000.00");
    expect(r.capped).toBe(true);
  });

  test("leaves the order settled but never in credit", async () => {
    validates("20000.00");
    const r = await resolveForOrder(args());

    // ₦404,000 − ₦15,000 = ₦389,000 — exactly what she has already paid.
    expect(r.totalAfter.toFixed(2)).toBe("389000.00");
    expect(r.balanceAfter.toFixed(2)).toBe("0.00");
    expect(r.balanceAfter.isNegative()).toBe(false);
    expect(r.settles).toBe(true);
  });

  test("a code worth exactly the balance is not reported as capped", async () => {
    validates("15000.00");
    const r = await resolveForOrder(args());

    expect(r.capped).toBe(false);
    expect(r.applied.toFixed(2)).toBe("15000.00");
    expect(r.settles).toBe(true);
  });
});

describe("the ordinary case — a code smaller than the balance", () => {
  test("waives its full value and leaves the rest owing", async () => {
    validates("5000.00");
    const r = await resolveForOrder(args());

    expect(r.capped).toBe(false);
    expect(r.applied.toFixed(2)).toBe("5000.00");
    expect(r.totalAfter.toFixed(2)).toBe("399000.00");
    expect(r.balanceAfter.toFixed(2)).toBe("10000.00");
    expect(r.settles).toBe(false);
  });

  test("a percentage code is valued against the subtotal by the coupon engine", async () => {
    // The engine already applied the percentage and any max_discount cap; this
    // function's job is only the balance cap on top of that.
    validates("40400.00", { discount_type: "percentage" });
    const r = await resolveForOrder(args());

    expect(r.raw.toFixed(2)).toBe("40400.00");
    expect(r.applied.toFixed(2)).toBe("15000.00"); // still capped
    expect(r.capped).toBe(true);
  });
});

describe("free shipping", () => {
  // computeDiscount returns 0 for free_shipping — at checkout the fee is zeroed
  // rather than discounted — so the waiver has to be valued off the fee the
  // order was actually charged.
  const WITH_SHIPPING = {
    ...ORDER,
    shipping_fee_ngn: "8000.00",
    total_ngn: "412000.00",
    balance_due_ngn: "23000.00",
  };

  test("is worth the shipping fee this order was charged", async () => {
    validates("0.00", { discount_type: "free_shipping" });
    const r = await resolveForOrder(args(WITH_SHIPPING));

    expect(r.valid).toBe(true);
    expect(r.applied.toFixed(2)).toBe("8000.00");
    expect(r.totalAfter.toFixed(2)).toBe("404000.00");
  });

  test("is refused on an order with no delivery fee", async () => {
    validates("0.00", { discount_type: "free_shipping" });
    const r = await resolveForOrder(args()); // shipping_fee_ngn '0.00'

    expect(r.valid).toBe(false);
    expect(r.reason).toBe("NO_SHIPPING_FEE");
    expect(r.message).toMatch(/no delivery fee/i);
  });
});

describe("codes this screen refuses", () => {
  test("nothing owed — a settled order has no balance to reduce", async () => {
    const settled = {
      ...ORDER,
      status: "paid",
      amount_paid_ngn: "404000.00",
      balance_due_ngn: "0.00",
    };
    const r = await resolveForOrder(args(settled));

    expect(r.valid).toBe(false);
    expect(r.reason).toBe("NOTHING_DUE");
    // Refused before the coupon engine is even consulted — no point burning a
    // per-customer allowance on a check that cannot apply anything.
    expect(mockCouponService.validateCoupon).not.toHaveBeenCalled();
  });

  test("buy-X-get-Y — that is a basket change, not a price reduction", async () => {
    validates("0.00", { discount_type: "buy_x_get_y" });
    const r = await resolveForOrder(args());

    expect(r.valid).toBe(false);
    expect(r.reason).toBe("UNSUPPORTED_TYPE");
    expect(r.message).toMatch(/Change Order/);
  });

  test("a code the engine rejects comes back with a sentence, not a code", async () => {
    mockCouponService.validateCoupon.mockResolvedValue({
      valid: false,
      reason: "EXPIRED",
    });
    const r = await resolveForOrder(args());

    expect(r.valid).toBe(false);
    expect(r.reason).toBe("EXPIRED");
    expect(r.message).toBe("That code has expired.");
  });

  test("an unmapped rejection still gets a usable sentence", async () => {
    mockCouponService.validateCoupon.mockResolvedValue({
      valid: false,
      reason: "SOME_NEW_RULE",
    });
    const r = await resolveForOrder(args());

    expect(r.valid).toBe(false);
    expect(r.message).toBe("That code can't be used on this order.");
  });

  test("a code that works out to nothing", async () => {
    validates("0.00");
    const r = await resolveForOrder(args());

    expect(r.valid).toBe(false);
    expect(r.reason).toBe("ZERO_VALUE");
  });
});

describe("the coupon engine is asked the right question", () => {
  test("valued against the subtotal, for this order's customer", async () => {
    validates("5000.00");
    await resolveForOrder(args());

    expect(mockCouponService.validateCoupon).toHaveBeenCalledWith(
      expect.objectContaining({
        brand: "faitlynhair",
        code: "WELCOME10",
        contact_id: "contact-1",
        order_subtotal_ngn: "404000.00",
      }),
    );
  });

  test("the code is passed through as typed, never upper-cased", async () => {
    // shared.coupons.coupon_code is matched exactly and nothing normalises it
    // on create, so a voucher minted as "welcome10" is only findable as
    // "welcome10". Upper-casing here would report a real code as non-existent.
    validates("5000.00");
    await resolveForOrder({ ...args(), code: "welcome10" });

    expect(mockCouponService.validateCoupon).toHaveBeenCalledWith(
      expect.objectContaining({ code: "welcome10" }),
    );
  });

  test("the coupon row is locked when a transaction client is passed", async () => {
    // The apply path passes its client so the row is locked FOR UPDATE against
    // a concurrent redemption; the preview path deliberately does not.
    validates("5000.00");
    const client = { query: jest.fn() };
    await resolveForOrder({ ...args(), client });

    expect(mockCouponService.validateCoupon).toHaveBeenCalledWith(
      expect.objectContaining({ client }),
    );
  });
});

describe("assertCouponable — orders that are past discounting", () => {
  const refuses = (order, match) =>
    expect(() => assertCouponable(order)).toThrow(match);

  test("a completed order", () => {
    refuses({ ...ORDER, status: "completed" }, /completed/i);
  });

  test("a cancelled order", () => {
    refuses({ ...ORDER, status: "cancelled" }, /cancelled|discounted/i);
  });

  test("a refunded order", () => {
    refuses({ ...ORDER, status: "refunded" }, /refunded|discounted/i);
  });

  test("an order with a cancellation awaiting a decision", () => {
    refuses({ ...ORDER, status: "cancellation_requested" }, /cancellation/i);
  });

  test("an order that already carries a code names the code it holds", () => {
    // sales_orders.coupon_code is one column and retention's settlement
    // subscriber joins expecting one 'coupon' discount row, so a second code
    // has to be refused by name rather than silently double-discounted.
    let caught;
    try {
      assertCouponable({ ...ORDER, coupon_code: "EARLYBIRD" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.code).toBe("COUPON_ALREADY_APPLIED");
    expect(caught.user_message).toContain("EARLYBIRD");
  });

  test("a partially-paid order is fine — that is the whole point", () => {
    expect(() => assertCouponable(ORDER)).not.toThrow();
  });

  test("a pending-payment order is fine", () => {
    expect(() =>
      assertCouponable({ ...ORDER, status: "pending_payment" }),
    ).not.toThrow();
  });
});
