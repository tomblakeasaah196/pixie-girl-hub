"use strict";

// Deposits-model postings (policy Q4/Q7/Q8): capture → settlement float vs
// customer-deposit liability; forfeiture and cancellation refunds settle out
// of 2400; recognised-revenue refunds go contra-revenue. Every builder must
// hold debits === credits.

const {
  buildCaptureLines,
  buildForfeitLines,
  buildCancellationRefundLines,
} = require("../../../src/modules/sales/sales.postings");
const { money } = require("../../../src/utils/money");

function totals(lines) {
  let dr = money(0);
  let cr = money(0);
  for (const l of lines) {
    dr = dr.plus(money(l.debit_ngn || 0));
    cr = cr.plus(money(l.credit_ngn || 0));
  }
  return { dr: dr.toFixed(2), cr: cr.toFixed(2) };
}

describe("buildCaptureLines — DR settlement / CR deposits", () => {
  test.each([
    ["paystack", "1120"],
    ["opay", "1150"],
    ["nomba", "1140"],
    ["stripe", "1160"],
    ["manual", "1100"], // no gateway float → straight to bank
  ])("%s capture debits %s", (provider, account) => {
    const lines = buildCaptureLines({
      amount_ngn: "50000.00",
      provider,
      contact_id: "c-1",
      reference: "PXG-SO-1",
    });
    const { dr, cr } = totals(lines);
    expect(dr).toBe(cr);
    expect(lines[0].account_code).toBe(account);
    expect(lines[1].account_code).toBe("2400");
    expect(lines[1].credit_ngn).toBe("50000.00");
    expect(lines[1].contact_id).toBe("c-1");
  });
});

describe("buildForfeitLines — abandoned deposits become income", () => {
  test("DR 2400 / CR 4900 for the held amount", () => {
    const lines = buildForfeitLines({
      amount_paid_ngn: "30000.00",
      contact_id: "c-1",
      reference: "PXG-SO-2",
    });
    const { dr, cr } = totals(lines);
    expect(dr).toBe(cr);
    expect(lines[0].account_code).toBe("2400");
    expect(lines[1].account_code).toBe("4900");
  });
});

describe("buildCancellationRefundLines — deposits held (no revenue yet)", () => {
  const order = {
    contact_id: "c-1",
    amount_paid_ngn: "60000.00", // 30% layaway deposit
    total_ngn: "200000.00",
    tax_amount_ngn: "0.00",
  };

  test("fee retained + cash back split the held deposit exactly", () => {
    const lines = buildCancellationRefundLines({
      order,
      fee_amount_ngn: "20000.00", // 10% restocking fee on total
      refund_amount_ngn: "180000.00", // request figure (total-based)
      revenueRecognised: false,
      reference: "PXG-SO-3",
    });
    const { dr, cr } = totals(lines);
    expect(dr).toBe(cr);
    // Only the 60k actually held moves: 20k fee, 40k back to the customer.
    expect(lines.find((l) => l.account_code === "2400").debit_ngn).toBe(
      "60000.00",
    );
    expect(lines.find((l) => l.account_code === "1100").credit_ngn).toBe(
      "40000.00",
    );
    expect(lines.find((l) => l.account_code === "4900").credit_ngn).toBe(
      "20000.00",
    );
  });

  test("fee larger than the deposit caps at the deposit (no negative cash)", () => {
    const lines = buildCancellationRefundLines({
      order: { ...order, amount_paid_ngn: "10000.00" },
      fee_amount_ngn: "20000.00",
      refund_amount_ngn: "180000.00",
      revenueRecognised: false,
      reference: "PXG-SO-4",
    });
    const { dr, cr } = totals(lines);
    expect(dr).toBe(cr);
    expect(lines.find((l) => l.account_code === "4900").credit_ngn).toBe(
      "10000.00",
    );
    expect(lines.find((l) => l.account_code === "1100")).toBeUndefined();
  });

  test("nothing held → no journal", () => {
    expect(
      buildCancellationRefundLines({
        order: { ...order, amount_paid_ngn: "0.00" },
        fee_amount_ngn: "0.00",
        refund_amount_ngn: "0.00",
        revenueRecognised: false,
        reference: "PXG-SO-5",
      }),
    ).toBeNull();
  });
});

describe("buildCancellationRefundLines — revenue already recognised", () => {
  test("contra revenue + pro-rated VAT reversal against bank", () => {
    const lines = buildCancellationRefundLines({
      order: {
        contact_id: "c-1",
        amount_paid_ngn: "215000.00",
        total_ngn: "215000.00", // 200k net + 15k VAT (7.5%)
        tax_amount_ngn: "15000.00",
      },
      fee_amount_ngn: "21500.00",
      refund_amount_ngn: "193500.00", // total − 10% fee
      revenueRecognised: true,
      reference: "PXG-SO-6",
    });
    const { dr, cr } = totals(lines);
    expect(dr).toBe(cr);
    // VAT share = 15,000 × 193,500 / 215,000 = 13,500.
    expect(lines.find((l) => l.account_code === "2100").debit_ngn).toBe(
      "13500.00",
    );
    expect(lines.find((l) => l.account_code === "4090").debit_ngn).toBe(
      "180000.00",
    );
    expect(lines.find((l) => l.account_code === "1100").credit_ngn).toBe(
      "193500.00",
    );
  });
});
