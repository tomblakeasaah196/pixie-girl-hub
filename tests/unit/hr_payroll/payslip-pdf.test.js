"use strict";

/**
 * Payslip PDF — the HTML the browser turns into the stored document.
 * Pure render: asserts the employer/employee identity, the two ledgers, the
 * employer-contribution split, net pay in figures AND words, bank masking,
 * and the column-fallback for slips that carry no itemised lines.
 */

const {
  payslipHtml,
  nairaInWords,
  groupLines,
  ledgersFromColumns,
  reconcile,
  maskAccount,
} = require("../../../src/shared/hr_payroll/payslip.pdf");

const brand = {
  brand_name: "Faitlyn Hair",
  brand_legal_name: "Faitlyn Hair Ltd",
  accent: "#690909",
  brand_address: "12 Admiralty Way, Lekki, Lagos",
  brand_phone: "+234 801 234 5678",
  support_email: "people@faitlynhair.com",
  tin: "12345678-0001",
  cac_number: "RC 1234567",
};

const slip = {
  payslip_number: "FLH-SLP-0006",
  staff_name: "Ape Boluwatife",
  employee_number: "FLH-EMP-014",
  job_title_snapshot: "Senior Stylist",
  department_snapshot: "Salon",
  employment_type: "full_time",
  staff_start_date: "2024-03-01",
  run_number: "FLH-PAY-2026-07",
  pay_date: "2026-07-31",
  period_start: "2026-07-01",
  period_end: "2026-07-31",
  days_worked: 20,
  working_days_in_period: 22,
  prorate_factor: 1,
  base_salary_ngn: 60000,
  allowances_ngn: 5000,
  commission_ngn: 4565,
  gross_pay_ngn: 69565,
  paye_ngn: 0,
  pension_employee_ngn: 0,
  pension_employer_ngn: 9000,
  attendance_deduction_ngn: 2087,
  total_deductions_ngn: 2087,
  net_pay_ngn: 67478,
  payment_status: "paid",
  payment_method: "bank_transfer",
  payment_reference: "NMB-8891023",
  paid_at: "2026-07-31T15:04:00Z",
  bank_account_snapshot: "0123456789",
  bank_name: "GTBank",
  lines: [
    { line_type: "base_salary", description: "Base salary", amount_ngn: 60000 },
    { line_type: "transport_allowance", description: "Allowances", amount_ngn: 5000 },
    { line_type: "commission", description: "Commission", amount_ngn: 4565 },
    { line_type: "pension_employer", description: "Pension (employer)", amount_ngn: 9000 },
    {
      line_type: "attendance_deduction",
      description: "Attendance deductions (lateness / absence / unpaid leave)",
      amount_ngn: 2087,
    },
  ],
};

describe("nairaInWords", () => {
  it("spells whole naira with the spoken 'and'", () => {
    expect(nairaInWords(1050)).toBe("One thousand and fifty naira only");
    expect(nairaInWords(273250)).toBe(
      "Two hundred and seventy-three thousand, two hundred and fifty naira only",
    );
    expect(nairaInWords(100)).toBe("One hundred naira only");
  });

  it("includes kobo when the amount is not whole", () => {
    expect(nairaInWords(2543478.55)).toBe(
      "Two million, five hundred and forty-three thousand, four hundred and seventy-eight naira, fifty-five kobo only",
    );
  });

  it("handles zero and negatives", () => {
    expect(nairaInWords(0)).toBe("Zero naira only");
    expect(nairaInWords(-500)).toBe("Minus five hundred naira only");
  });
});

describe("groupLines", () => {
  it("splits earnings, deductions and employer contributions", () => {
    const g = groupLines(slip.lines);
    expect(g.earnings.map((r) => r.label)).toEqual([
      "Base salary",
      "Allowances",
      "Commission",
    ]);
    expect(g.deductions.map((r) => r.label)).toEqual([
      "Attendance deductions (lateness / absence / unpaid leave)",
    ]);
    expect(g.employer.map((r) => r.label)).toEqual(["Pension (employer)"]);
  });

  it("treats an unrecognised line_type as a deduction rather than dropping it", () => {
    const g = groupLines([{ line_type: "brand_new_levy", amount_ngn: 10 }]);
    expect(g.deductions).toEqual([{ label: "Brand New Levy", amount: 10 }]);
  });
});

describe("ledgersFromColumns", () => {
  it("rebuilds both ledgers from the payslip columns, dropping zeros", () => {
    const g = ledgersFromColumns(slip);
    expect(g.earnings.map((r) => r.label)).toEqual([
      "Basic salary",
      "Allowances",
      "Commission",
    ]);
    // paye/pension are zero on this slip → omitted
    expect(g.deductions.map((r) => r.label)).toEqual(["Attendance deductions"]);
    expect(g.employer).toEqual([{ label: "Pension (employer)", amount: 9000 }]);
  });
});

describe("reconcile", () => {
  it("keeps the stored total and adds a balancing row when the rows fall short", () => {
    const { rows, total } = reconcile([{ label: "Base", amount: 100 }], 150, "Other");
    expect(total).toBe(150);
    expect(rows).toEqual([
      { label: "Base", amount: 100 },
      { label: "Other", amount: 50 },
    ]);
  });

  it("leaves a balanced ledger untouched", () => {
    const { rows } = reconcile([{ label: "Base", amount: 100 }], 100, "Other");
    expect(rows).toHaveLength(1);
  });
});

describe("maskAccount", () => {
  it("shows only the last four digits", () => {
    expect(maskAccount("0123456789")).toBe("••••6789");
    expect(maskAccount("12")).toBe("••••12");
    expect(maskAccount(null)).toBeNull();
  });
});

describe("payslipHtml", () => {
  const html = payslipHtml(brand, slip);

  it("renders employer identity and the employee it belongs to", () => {
    expect(html).toContain("Faitlyn Hair");
    expect(html).toContain("Faitlyn Hair Ltd");
    expect(html).toContain("CAC RC 1234567");
    expect(html).toContain("TIN 12345678-0001");
    expect(html).toContain("Ape Boluwatife");
    expect(html).toContain("FLH-EMP-014");
    expect(html).toContain("Senior Stylist");
    expect(html).toContain("Full Time");
  });

  it("renders the period, run and attendance context", () => {
    expect(html).toContain("FLH-SLP-0006");
    expect(html).toContain("FLH-PAY-2026-07");
    expect(html).toContain("01/07/2026 — 31/07/2026");
    expect(html).toContain("20 of 22 working days");
  });

  it("renders both ledgers with their stored totals", () => {
    expect(html).toContain("Base salary");
    expect(html).toContain("Commission");
    expect(html).toContain("Gross pay");
    expect(html).toContain("₦69,565.00");
    expect(html).toContain("Total deductions");
    expect(html).toContain("−₦2,087.00");
  });

  it("keeps the employer contribution out of the deductions ledger", () => {
    const deductionsBlock = html.slice(
      html.indexOf(">Deductions<"),
      html.indexOf("net-label"),
    );
    expect(deductionsBlock).not.toContain("Pension (employer)");
    expect(html).toContain("Employer contributions");
    expect(html).toContain("not deducted from your net pay");
  });

  it("renders net pay in figures and in words", () => {
    expect(html).toContain("₦67,478.00");
    expect(html).toContain(
      "Sixty-seven thousand, four hundred and seventy-eight naira only",
    );
  });

  it("renders payment details with a masked account number", () => {
    expect(html).toContain("NMB-8891023");
    expect(html).toContain("GTBank");
    expect(html).toContain("••••6789");
    expect(html).not.toContain("0123456789");
  });

  it("omits the pro-rata row when the employee worked the full period", () => {
    expect(html).not.toContain("Pro-rata");
    expect(payslipHtml(brand, { ...slip, prorate_factor: 0.5 })).toContain(
      "Pro-rated ×0.5000",
    );
  });

  it("falls back to the payslip columns when there are no itemised lines", () => {
    const bare = payslipHtml(brand, { ...slip, lines: [] });
    expect(bare).toContain("Basic salary");
    expect(bare).toContain("₦69,565.00");
    expect(bare).toContain("₦67,478.00");
  });

  it("escapes employee-supplied text", () => {
    const evil = payslipHtml(brand, { ...slip, staff_name: '<script>x</script>' });
    expect(evil).not.toContain("<script>x</script>");
    expect(evil).toContain("&lt;script&gt;");
  });

  it("draws its own sheet, so the page must have zero engine margins", () => {
    expect(html).toContain("@page { size: A4; margin: 0; }");
    expect(html).toContain("width:210mm");
  });
});
