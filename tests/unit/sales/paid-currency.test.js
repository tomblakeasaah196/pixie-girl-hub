"use strict";

// A USD order paid through Nomba is credited in Naira, but the customer parted
// with dollars — receipts and payment messages must say what they paid.
const pc = require("../../../src/modules/sales/paid-currency");

const usd = (amount_ngn, paid_amount, status = "captured") => ({
  amount_ngn,
  paid_currency: "USD",
  paid_amount,
  status,
});

describe("paidCurrencyDisplay", () => {
  test("an order paid in dollars shows the dollars received and the effective rate", () => {
    expect(
      pc.paidCurrencyDisplay([usd("150000.00", "100.00"), usd("224985.00", "149.99")]),
    ).toEqual({
      display_currency: "USD",
      display_amount: "249.99",
      fx_rate_used: "1500.000000",
    });
  });

  test("any Naira payment keeps a Naira receipt", () => {
    expect(
      pc.paidCurrencyDisplay([
        usd("150000.00", "100.00"),
        { amount_ngn: "50000.00", paid_currency: null, status: "captured" },
      ]),
    ).toBeNull();
    expect(pc.paidCurrencyDisplay([{ amount_ngn: "5000.00" }])).toBeNull();
    expect(pc.paidCurrencyDisplay([])).toBeNull();
  });

  test("refunded / pending rows are not money received", () => {
    expect(
      pc.paidCurrencyDisplay([
        usd("150000.00", "100.00"),
        usd("150000.00", "100.00", "refunded"),
        usd("150000.00", "100.00", "pending"),
      ]).display_amount,
    ).toBe("100.00");
  });

  test("a USD row missing its dollar amount can't be shown in dollars", () => {
    expect(pc.paidCurrencyDisplay([usd("150000.00", null)])).toBeNull();
  });
});

describe("labels", () => {
  test("formatMoney", () => {
    expect(pc.formatMoney("249.99", "USD")).toBe("$249.99");
    expect(pc.formatMoney("374985", "NGN")).toBe("₦374,985.00");
    expect(pc.formatMoney("1234567.5", "USD")).toBe("$1,234,567.50");
  });

  test("paymentAmountLabel speaks the payment's own currency", () => {
    expect(pc.paymentAmountLabel(usd("150000.00", "100.00"))).toBe("$100.00");
    expect(pc.paymentAmountLabel({ amount_ngn: "5000" })).toBe("₦5,000.00");
  });

  test("lockedTotalLabel only for an order really locked to a foreign currency", () => {
    const order = {
      total_ngn: "374985.00",
      display_currency: "USD",
      display_total: "249.99",
      fx_rate_used: "1500.000000",
    };
    expect(pc.lockedTotalLabel(order)).toBe("$249.99");
    // 1.0 is the "never captured" default, not a rate.
    expect(pc.lockedTotalLabel({ ...order, fx_rate_used: "1.000000" })).toBeNull();
    expect(pc.lockedTotalLabel({ ...order, display_currency: "NGN" })).toBeNull();
  });

  test("paidTotalLabel prefers the dollars actually received", () => {
    const order = {
      total_ngn: "374985.00",
      display_currency: "USD",
      display_total: "249.99",
      fx_rate_used: "1500.000000",
    };
    expect(pc.paidTotalLabel(order, [usd("375000.00", "250.00")])).toBe("$250.00");
    expect(pc.paidTotalLabel(order, [])).toBe("$249.99");
    expect(pc.paidTotalLabel({ total_ngn: "5000" }, [])).toBeNull();
  });
});
