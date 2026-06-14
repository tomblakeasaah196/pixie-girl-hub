"use strict";

/**
 * Payroll engine unit tests (V2.2 §6.11).
 *
 * payroll.calc is PURE (no DB), so the PAYE/pension/NHF/net-pay math is
 * verified here in isolation. These guard the figures that flow onto payslips
 * — the numbers staff are actually paid.
 */

const {
  round2,
  progressiveTax,
  computeDeductions,
  buildPayslip,
} = require("../../../src/shared/hr_payroll/payroll.calc");

// A representative progressive PAYE band set (fractions, not percents).
const BANDS = [
  { lower: 0, upper: 300000, rate: 0.07 },
  { lower: 300000, upper: 600000, rate: 0.11 },
  { lower: 600000, upper: 1100000, rate: 0.15 },
  { lower: 1100000, upper: null, rate: 0.19 },
];

describe("round2", () => {
  test("rounds to 2dp half-up", () => {
    expect(round2(123.456)).toBe(123.46);
    expect(round2(123.454)).toBe(123.45);
    expect(round2(100)).toBe(100);
  });
});

describe("progressiveTax", () => {
  test("zero or negative taxable yields zero", () => {
    expect(progressiveTax(0, BANDS)).toBe(0);
    expect(progressiveTax(-5000, BANDS)).toBe(0);
  });

  test("taxes only the portion within each band", () => {
    // 300,000 entirely in band 1 @ 7%
    expect(progressiveTax(300000, BANDS)).toBe(21000);
    // 500,000 → 300k@7% + 200k@11% = 21,000 + 22,000
    expect(progressiveTax(500000, BANDS)).toBe(43000);
    // 1,000,000 → 21,000 + 33,000 + 60,000
    expect(progressiveTax(1000000, BANDS)).toBe(114000);
  });

  test("is order-independent (bands get sorted)", () => {
    const reversed = [...BANDS].reverse();
    expect(progressiveTax(500000, reversed)).toBe(43000);
  });

  test("missing/empty bands are safe", () => {
    expect(progressiveTax(500000, [])).toBe(0);
    expect(progressiveTax(500000, null)).toBe(0);
  });
});

describe("computeDeductions", () => {
  test("applies pension/NHF on base and PAYE after relief", () => {
    const out = computeDeductions({
      gross: 100000,
      pensionableBase: null, // null → use gross
      configs: {
        pension_employee: { rate_pct: 0.08 },
        pension_employer: { rate_pct: 0.1 },
        nhf: { rate_pct: 0.025 },
        paye: {
          consolidated_relief_ngn: 0,
          consolidated_relief_pct: 0.2,
          bands: [{ lower: 0, upper: null, rate: 0.1 }],
        },
      },
    });
    expect(out.pension_employee).toBe(8000); // 100k * 8%
    expect(out.pension_employer).toBe(10000); // 100k * 10% (reported, not withheld)
    expect(out.nhf).toBe(2500); // 100k * 2.5%
    // relief = 100k*20% = 20,000 → taxable = 100k - 20k - 8k - 2.5k = 69,500
    expect(out.taxable).toBe(69500);
    expect(out.paye).toBe(6950); // 69,500 * 10%
  });
});

describe("buildPayslip", () => {
  test("sums gross, withholds correctly, excludes employer pension from net", () => {
    const slip = buildPayslip({
      earnings: { base_salary: 200000, allowances: 50000, commission: 10000 },
      extraDeductions: {},
      pensionableBase: 260000, // explicit → base = full gross
      deductionConfigs: {
        pension_employee: { rate_pct: 0.08 },
        pension_employer: { rate_pct: 0.1 },
        nhf: { rate_pct: 0.025 },
        paye: {
          consolidated_relief_ngn: 0,
          consolidated_relief_pct: 0.2,
          bands: BANDS,
        },
      },
    });

    expect(slip.gross_pay_ngn).toBe(260000);
    expect(slip.pension_employee_ngn).toBe(20800); // 260k * 8%
    expect(slip.pension_employer_ngn).toBe(26000); // 260k * 10%
    expect(slip.nhf_ngn).toBe(6500); // 260k * 2.5%
    // relief 52,000 → taxable 180,700 → all in band 1 @7% = 12,649
    expect(slip.paye_ngn).toBe(12649);
    // total withheld = PAYE + employee pension + NHF (NOT employer pension)
    expect(slip.total_deductions_ngn).toBe(39949);
    expect(slip.net_pay_ngn).toBe(220051);
    expect(slip.gross_pay_ngn - slip.total_deductions_ngn).toBe(
      slip.net_pay_ngn,
    );
  });

  test("payslip lines never include employer pension and skip zero amounts", () => {
    const slip = buildPayslip({
      earnings: { base_salary: 100000 },
      pensionableBase: 100000,
      deductionConfigs: {
        pension_employee: { rate_pct: 0.08 },
        pension_employer: { rate_pct: 0.1 },
        nhf: { rate_pct: 0 },
        paye: {
          consolidated_relief_ngn: 0,
          consolidated_relief_pct: 0.2,
          bands: BANDS,
        },
      },
    });
    const types = slip.lines.map((l) => l.line_type);
    expect(types).toContain("base_salary");
    expect(types).toContain("pension_employee");
    expect(types).not.toContain("pension_employer"); // employer cost, not a payslip line
    expect(types).not.toContain("nhf"); // zero → skipped
    // display_order is dense and 0-based
    slip.lines.forEach((l, i) => expect(l.display_order).toBe(i));
  });
});
