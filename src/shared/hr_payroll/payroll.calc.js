/**
 * Payroll calculation engine (V2.2 §6.11) — PURE, no DB.
 *
 * Turns a staff member's monthly earnings + the brand's active
 * payroll_deductions config into a payslip's figures and itemised lines.
 * Kept pure so the tax math is unit-testable in isolation.
 *
 * Deductions are CONFIG-DRIVEN (shared per-brand payroll_deductions rows), not
 * hardcoded to a tax year: the admin maintains the PAYE bands, pension and NHF
 * rates, and consolidated relief in the Pass-1 config UI; this engine just
 * applies whatever is active.
 *
 * Money is handled as numbers here and rounded to kobo (2dp) at the edges.
 */

"use strict";

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Progressive tax over ordered bands.
 * bands: [{ lower, upper|null, rate }] — rate is a fraction (0.07 = 7%).
 * Tax accrues on the portion of `taxable` falling within each band.
 */
function progressiveTax(taxable, bands) {
  if (!Array.isArray(bands) || taxable <= 0) return 0;
  const ordered = [...bands].sort((a, b) => Number(a.lower) - Number(b.lower));
  let tax = 0;
  for (const band of ordered) {
    const lower = Number(band.lower) || 0;
    if (taxable <= lower) break;
    const upper = band.upper === null ? Infinity : Number(band.upper);
    const portion = Math.min(taxable, upper) - lower;
    if (portion > 0) tax += portion * Number(band.rate || 0);
  }
  return round2(tax);
}

function rateFrom(config) {
  return config && config.rate_pct !== null && config.rate_pct !== undefined
    ? Number(config.rate_pct)
    : 0;
}

/**
 * Statutory deductions for one month.
 * @param gross           monthly gross pay
 * @param pensionableBase base for pension (defaults to gross)
 * @param configs         { paye, pension_employee, pension_employer, nhf }
 */
function computeDeductions({ gross, pensionableBase, configs = {} }) {
  const base = pensionableBase === null ? gross : pensionableBase;
  const pension_employee = round2(base * rateFrom(configs.pension_employee));
  const pension_employer = round2(base * rateFrom(configs.pension_employer));
  const nhf = round2(base * rateFrom(configs.nhf));

  // PAYE: relief reduces taxable income; pension + NHF are tax-deductible.
  const paye = configs.paye || {};
  const relief =
    (paye.consolidated_relief_ngn !== null &&
    paye.consolidated_relief_ngn !== undefined
      ? Number(paye.consolidated_relief_ngn)
      : 0) +
    (paye.consolidated_relief_pct !== null &&
    paye.consolidated_relief_pct !== undefined
      ? gross * Number(paye.consolidated_relief_pct)
      : 0);
  const taxable = Math.max(0, gross - relief - pension_employee - nhf);
  const payeAmount = progressiveTax(taxable, paye.bands || []);

  return {
    paye: payeAmount,
    pension_employee,
    pension_employer, // employer-side: reported, not deducted from net
    nhf,
    taxable: round2(taxable),
  };
}

/**
 * Build one payslip's figures + itemised lines.
 * earnings: { base_salary, allowances, commission, bonus, overtime, reimbursements }
 * extraDeductions: { loan_repayment, advance_recovery, other_deductions }
 */
function buildPayslip({
  earnings = {},
  extraDeductions = {},
  deductionConfigs = {},
  pensionableBase,
}) {
  const e = {
    base_salary: round2(earnings.base_salary || 0),
    allowances: round2(earnings.allowances || 0),
    commission: round2(earnings.commission || 0),
    bonus: round2(earnings.bonus || 0),
    overtime: round2(earnings.overtime || 0),
    reimbursements: round2(earnings.reimbursements || 0),
  };
  const gross = round2(
    e.base_salary +
      e.allowances +
      e.commission +
      e.bonus +
      e.overtime +
      e.reimbursements,
  );

  const stat = computeDeductions({
    gross,
    pensionableBase: pensionableBase === null ? e.base_salary : pensionableBase,
    configs: deductionConfigs,
  });

  const d = {
    paye: stat.paye,
    pension_employee: stat.pension_employee,
    pension_employer: stat.pension_employer,
    nhf: stat.nhf,
    loan_repayment: round2(extraDeductions.loan_repayment || 0),
    advance_recovery: round2(extraDeductions.advance_recovery || 0),
    other_deductions: round2(extraDeductions.other_deductions || 0),
  };
  // Employer pension is a company cost, not withheld from the employee's net.
  const total_deductions = round2(
    d.paye +
      d.pension_employee +
      d.nhf +
      d.loan_repayment +
      d.advance_recovery +
      d.other_deductions,
  );
  const net_pay = round2(gross - total_deductions);

  const lines = [];
  const push = (line_type, description, amount) => {
    if (amount > 0)
      lines.push({ line_type, description, amount_ngn: round2(amount) });
  };
  push("base_salary", "Base salary", e.base_salary);
  push("transport_allowance", "Allowances", e.allowances);
  push("commission", "Commission", e.commission);
  push("bonus", "Bonus", e.bonus);
  push("overtime", "Overtime", e.overtime);
  push("reimbursement", "Reimbursements", e.reimbursements);
  push("paye", "PAYE", d.paye);
  push("pension_employee", "Pension (employee)", d.pension_employee);
  push("nhf", "NHF", d.nhf);
  push("loan_repayment", "Loan repayment", d.loan_repayment);
  push("advance_recovery", "Advance recovery", d.advance_recovery);
  push("other_deduction", "Other deductions", d.other_deductions);
  lines.forEach((l, idx) => (l.display_order = idx));

  return {
    base_salary_ngn: e.base_salary,
    allowances_ngn: e.allowances,
    commission_ngn: e.commission,
    bonus_ngn: e.bonus,
    overtime_ngn: e.overtime,
    reimbursements_ngn: e.reimbursements,
    gross_pay_ngn: gross,
    paye_ngn: d.paye,
    pension_employee_ngn: d.pension_employee,
    pension_employer_ngn: d.pension_employer,
    nhf_ngn: d.nhf,
    loan_repayment_ngn: d.loan_repayment,
    advance_recovery_ngn: d.advance_recovery,
    other_deductions_ngn: d.other_deductions,
    total_deductions_ngn: total_deductions,
    net_pay_ngn: net_pay,
    lines,
  };
}

module.exports = { round2, progressiveTax, computeDeductions, buildPayslip };
