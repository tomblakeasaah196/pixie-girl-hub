"use strict";

// The post-hoc coupon GL delta (§6.2 / §6.23.2). A code applied to an order
// whose sale journal is already on the books must post the DIFFERENCE — the
// slice of revenue that, it turns out, was never earned — and nothing else.
//
// The invariant these tests exist for: debits === credits, and the money lands
// on the account the original journal credited (channel revenue for an ordinary
// code, shipping revenue for a free-shipping one). Getting the second half
// wrong balances the journal while quietly misstating both revenue lines.

const {
  buildOrderDiscountLines,
} = require("../../../src/modules/sales/sales.postings");
const { money } = require("../../../src/utils/money");

function totals(lines) {
  let dr = money(0);
  let cr = money(0);
  for (const l of lines || []) {
    dr = dr.plus(money(l.debit_ngn || 0));
    cr = cr.plus(money(l.credit_ngn || 0));
  }
  return { dr: dr.toFixed(2), cr: cr.toFixed(2) };
}
const byAccount = (lines, code) =>
  (lines || []).find((l) => l.account_code === code);

const base = {
  revenue_account_code: "4000",
  contact_id: "contact-1",
  reference: "FLH-SO-0125",
  coupon_code: "WELCOME10",
};

describe("buildOrderDiscountLines — an ordinary code on a recognised order", () => {
  // The ₦404,000 wig, ₦389,000 already paid, a ₦15,000 code capped to the
  // balance and applied after the sale journal had posted.
  const lines = buildOrderDiscountLines({
    ...base,
    discount_ngn: "15000.00",
    is_shipping_waiver: false,
  });

  test("balances", () => {
    const { dr, cr } = totals(lines);
    expect(dr).toBe(cr);
    expect(dr).toBe("15000.00");
  });

  test("debits the channel's revenue account — that much was never earned", () => {
    expect(byAccount(lines, "4000").debit_ngn).toBe("15000.00");
    expect(byAccount(lines, "4000").credit_ngn).toBeUndefined();
  });

  test("credits Customer Deposits back up — the draw-down was too large", () => {
    // Policy Q7: the sale journal drew 2400 down by the full order total.
    // Waiving part of that total means part of the draw-down has to come back.
    expect(byAccount(lines, "2400").credit_ngn).toBe("15000.00");
    expect(byAccount(lines, "2400").debit_ngn).toBeUndefined();
    expect(byAccount(lines, "2400").contact_id).toBe("contact-1");
  });

  test("touches neither COGS nor inventory — the goods did not change", () => {
    expect(byAccount(lines, "5000")).toBeUndefined();
    expect(byAccount(lines, "1300")).toBeUndefined();
    expect(lines).toHaveLength(2);
  });

  test("names the code in both descriptions, for the auditor reading it cold", () => {
    for (const l of lines) {
      expect(l.description).toContain("WELCOME10");
      expect(l.description).toContain("FLH-SO-0125");
    }
  });
});

describe("buildOrderDiscountLines — a free-shipping code", () => {
  // Shipping was credited to Shipping Revenue, not to the channel account, so
  // that is the line the waiver has to reverse.
  const lines = buildOrderDiscountLines({
    ...base,
    coupon_code: "FREESHIP",
    discount_ngn: "5000.00",
    is_shipping_waiver: true,
  });

  test("balances", () => {
    const { dr, cr } = totals(lines);
    expect(dr).toBe(cr);
  });

  test("debits Shipping Revenue, leaving the channel's revenue alone", () => {
    expect(byAccount(lines, "4200").debit_ngn).toBe("5000.00");
    expect(byAccount(lines, "4000")).toBeUndefined();
  });

  test("still credits Customer Deposits", () => {
    expect(byAccount(lines, "2400").credit_ngn).toBe("5000.00");
  });
});

describe("buildOrderDiscountLines — nothing to post", () => {
  // postEntry rejects a single-line journal, and a zero waiver moves nothing.
  test("returns null for a zero discount", () => {
    expect(
      buildOrderDiscountLines({ ...base, discount_ngn: "0" }),
    ).toBeNull();
  });

  test("returns null for a missing discount", () => {
    expect(buildOrderDiscountLines({ ...base })).toBeNull();
  });

  test("returns null rather than reversing a negative", () => {
    // A negative waiver is nonsense; the caller's job is to refuse it, not this
    // builder's to invent a journal that puts revenue back.
    expect(
      buildOrderDiscountLines({ ...base, discount_ngn: "-2500.00" }),
    ).toBeNull();
  });
});
