"use strict";

// Payroll statutory accrual (policy Q3): the run's payslip sums must post a
// balanced journal — DR gross earnings + employer pension, CR every
// statutory payable + recoveries + net pay.

const {
  buildPayrollAccrualLines,
  buildPayrollPaymentLines,
  buildPayoutFailureLines,
} = require("../../../src/shared/hr_payroll/payroll.postings");
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

// A consistent run: gross 1,000,000 = earnings 800k + commission 150k +
// bonus 50k. Deductions: PAYE 120k, pension 8% employee 80k, NHF 25k,
// recoveries 30k, other 5k → net 740k. Employer pension 10% = 100k.
const SUMS = {
  earnings_ngn: "800000.00",
  commission_ngn: "150000.00",
  bonus_ngn: "50000.00",
  paye_ngn: "120000.00",
  pension_employee_ngn: "80000.00",
  pension_employer_ngn: "100000.00",
  nhf_ngn: "25000.00",
  staff_recoveries_ngn: "30000.00",
  other_deductions_ngn: "5000.00",
  net_pay_ngn: "740000.00",
};

describe("buildPayrollAccrualLines (policy Q3)", () => {
  test("full statutory accrual balances at gross + employer pension", () => {
    const lines = buildPayrollAccrualLines(SUMS, "PXG-PAY-2026-06");
    const { dr, cr } = totals(lines);
    expect(dr).toBe(cr);
    expect(dr).toBe("1100000.00"); // 1,000,000 gross + 100,000 employer pension
    const by = (code) => lines.find((l) => l.account_code === code);
    expect(by("5100").debit_ngn).toBe("800000.00");
    expect(by("5110").debit_ngn).toBe("150000.00");
    expect(by("5120").debit_ngn).toBe("50000.00");
    expect(by("5130").debit_ngn).toBe("100000.00");
    expect(by("2200").credit_ngn).toBe("120000.00");
    expect(by("2210").credit_ngn).toBe("80000.00");
    expect(by("2220").credit_ngn).toBe("100000.00");
    expect(by("2230").credit_ngn).toBe("25000.00");
    expect(by("1410").credit_ngn).toBe("30000.00");
    expect(by("2310").credit_ngn).toBe("5000.00");
    expect(by("2300").credit_ngn).toBe("740000.00");
  });

  test("zero components are omitted, journal still balances", () => {
    const lines = buildPayrollAccrualLines(
      {
        ...SUMS,
        commission_ngn: "0.00",
        bonus_ngn: "0.00",
        nhf_ngn: "0.00",
        staff_recoveries_ngn: "0.00",
        other_deductions_ngn: "0.00",
        pension_employer_ngn: "0.00",
        paye_ngn: "120000.00",
        pension_employee_ngn: "80000.00",
        net_pay_ngn: "600000.00",
      },
      "PXG-PAY-2026-07",
    );
    const { dr, cr } = totals(lines);
    expect(dr).toBe(cr);
    expect(lines).toHaveLength(4); // salaries / paye / pension_e / net
  });
});

describe("payment + failure legs", () => {
  test("disbursement clears net-pay payable into bank", () => {
    const lines = buildPayrollPaymentLines("740000.00", "PXG-PAY-2026-06");
    const { dr, cr } = totals(lines);
    expect(dr).toBe(cr);
    expect(lines[0].account_code).toBe("2300");
    expect(lines[1].account_code).toBe("1100");
  });

  test("failed payout re-accrues exactly the slip's net", () => {
    const lines = buildPayoutFailureLines("95000.00", "PXG-SLP-0031");
    const { dr, cr } = totals(lines);
    expect(dr).toBe(cr);
    expect(lines[0].account_code).toBe("1100");
    expect(lines[1].account_code).toBe("2300");
  });
});
