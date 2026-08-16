"use strict";

// The Change Order GL delta (§6.2). An amendment to an order whose sale journal
// is already on the books must post the DIFFERENCE — never a re-post (which
// would double the order's revenue) and never a reversal-and-replay (which
// would double its footprint in every report).
//
// The invariant these tests exist for: debits === credits in EVERY direction —
// upgrade, downgrade, shipping-only, VAT-only, and the mixed case where the
// components move opposite ways and cancel out at the total.

const {
  buildAmendmentLines,
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
const byAccount = (lines, code) => (lines || []).find((l) => l.account_code === code);

const base = {
  revenue_account_code: "4000",
  contact_id: "contact-1",
  reference: "FLH-SO-0093",
};

describe("buildAmendmentLines — the upgrade (a pricier wig)", () => {
  // ₦389,000 → ₦520,000 net, VAT-free, shipping unchanged, ₦90,000 of cost
  // going out with the replacement unit.
  const lines = buildAmendmentLines({
    ...base,
    delta_total_ngn: "131000.00",
    delta_net_ngn: "131000.00",
    delta_shipping_ngn: "0",
    delta_tax_ngn: "0",
    cogs_added_ngn: "90000.00",
  });

  test("balances", () => {
    const { dr, cr } = totals(lines);
    expect(dr).toBe(cr);
  });

  test("debits Customer Deposits — the customer now owes the difference", () => {
    // Policy Q7: every capture credits 2400, so what she still owes sits there
    // as a debit until the top-up payment credits it back.
    expect(byAccount(lines, "2400").debit_ngn).toBe("131000.00");
    expect(byAccount(lines, "2400").credit_ngn).toBeUndefined();
    expect(byAccount(lines, "2400").contact_id).toBe("contact-1");
  });

  test("credits the channel's revenue account with the uplift", () => {
    expect(byAccount(lines, "4000").credit_ngn).toBe("131000.00");
  });

  test("relieves inventory for the unit that went out, once", () => {
    expect(byAccount(lines, "5000").debit_ngn).toBe("90000.00"); // COGS
    expect(byAccount(lines, "1300").credit_ngn).toBe("90000.00"); // Inventory FG
  });
});

describe("buildAmendmentLines — the downgrade (a cheaper wig)", () => {
  // Removed units go back through stock's own 'return' movement (DR Inventory /
  // CR COGS), so nothing here carries COGS: adding it would relieve twice.
  const lines = buildAmendmentLines({
    ...base,
    delta_total_ngn: "-131000.00",
    delta_net_ngn: "-131000.00",
    delta_shipping_ngn: "0",
    delta_tax_ngn: "0",
    cogs_added_ngn: "0",
  });

  test("balances", () => {
    const { dr, cr } = totals(lines);
    expect(dr).toBe(cr);
  });

  test("mirrors the entry — 2400 becomes a credit we owe her", () => {
    expect(byAccount(lines, "2400").credit_ngn).toBe("131000.00");
    expect(byAccount(lines, "2400").debit_ngn).toBeUndefined();
  });

  test("debits revenue back down", () => {
    expect(byAccount(lines, "4000").debit_ngn).toBe("131000.00");
  });

  test("books no COGS — the return movement owns that side", () => {
    expect(byAccount(lines, "5000")).toBeUndefined();
    expect(byAccount(lines, "1300")).toBeUndefined();
  });
});

describe("buildAmendmentLines — every component, mixed directions", () => {
  // Net up ₦100,000, shipping down ₦5,000, VAT up ₦7,500 → total up ₦102,500.
  const lines = buildAmendmentLines({
    ...base,
    delta_total_ngn: "102500.00",
    delta_net_ngn: "100000.00",
    delta_shipping_ngn: "-5000.00",
    delta_tax_ngn: "7500.00",
    cogs_added_ngn: "40000.00",
  });

  test("balances even though shipping moves against the others", () => {
    const { dr, cr } = totals(lines);
    expect(dr).toBe(cr);
  });

  test("shipping revenue is DEBITED when the fee came down", () => {
    expect(byAccount(lines, "4200").debit_ngn).toBe("5000.00");
  });

  test("VAT output follows the tax delta", () => {
    expect(byAccount(lines, "2100").credit_ngn).toBe("7500.00");
  });
});

describe("buildAmendmentLines — nothing to post", () => {
  test("a delivery-address-only change writes no journal", () => {
    // postEntry rejects a one-line journal, and there is genuinely nothing on
    // the books to move — the caller skips posting entirely.
    expect(
      buildAmendmentLines({
        ...base,
        delta_total_ngn: "0",
        delta_net_ngn: "0",
        delta_shipping_ngn: "0",
        delta_tax_ngn: "0",
        cogs_added_ngn: "0",
      }),
    ).toBeNull();
  });

  test("a same-price swap still posts, because inventory moved", () => {
    // Money unchanged, but a different unit left the shelf: COGS and inventory
    // must still be relieved for it.
    const lines = buildAmendmentLines({
      ...base,
      delta_total_ngn: "0",
      delta_net_ngn: "0",
      delta_shipping_ngn: "0",
      delta_tax_ngn: "0",
      cogs_added_ngn: "90000.00",
    });
    expect(lines).toHaveLength(2);
    const { dr, cr } = totals(lines);
    expect(dr).toBe(cr);
    expect(dr).toBe("90000.00");
  });

  test("a shipping-only correction is a legal two-line journal", () => {
    const lines = buildAmendmentLines({
      ...base,
      delta_total_ngn: "3500.00",
      delta_net_ngn: "0",
      delta_shipping_ngn: "3500.00",
      delta_tax_ngn: "0",
      cogs_added_ngn: "0",
    });
    expect(lines).toHaveLength(2);
    const { dr, cr } = totals(lines);
    expect(dr).toBe(cr);
  });
});

describe("buildAmendmentLines — revenue routes by the order's own channel", () => {
  test.each([
    ["4000", "storefront revenue"],
    ["4010", "another channel's account"],
  ])("credits %s (%s)", (code) => {
    const lines = buildAmendmentLines({
      ...base,
      revenue_account_code: code,
      delta_total_ngn: "10000.00",
      delta_net_ngn: "10000.00",
      delta_shipping_ngn: "0",
      delta_tax_ngn: "0",
      cogs_added_ngn: "0",
    });
    expect(byAccount(lines, code).credit_ngn).toBe("10000.00");
  });
});
