/**
 * Payroll GL posting builders (ratified accounting policy Q3).
 *
 * Pure functions over the run's payslip sums — payroll.service posts these
 * via accounting.postEntry. Approval books the full statutory accrual;
 * disbursement clears Net-Pay Payable per money that actually moved; a
 * failed async payout re-accrues its slip.
 *
 *   APPROVAL (source payroll_runs, key payroll_accrual:<run_id>):
 *     DR 5100 Salaries & Wages         base+allowances+overtime+reimbursements
 *     DR 5110 Commission Expense       commissions
 *     DR 5120 Bonus Expense            bonuses
 *     DR 5130 Pension — Employer       employer contribution
 *        CR 2200 PAYE Payable
 *        CR 2210 Pension — Employee
 *        CR 2220 Pension — Employer
 *        CR 2230 NHF Payable
 *        CR 1410 Cash Advances Issued  loan repayments + advance recoveries
 *        CR 2310 Accrued Expenses      other deductions
 *        CR 2300 Accrued Salaries      net pay owed to staff
 *
 *   DISBURSEMENT (key payroll_pay:<run_id>):
 *     DR 2300 / CR 1100 for the net pay of slips that were actually paid or
 *     queued with the provider. Failed slips stay accrued in 2300.
 */

"use strict";

const { ACCOUNTS } = require("../../modules/accounting/posting-map");
const { money, toCurrencyString } = require("../../utils/money");

/**
 * @param {Object} s  payslip sums for the run:
 *   earnings_ngn (base+allowances+overtime+reimbursements), commission_ngn,
 *   bonus_ngn, paye_ngn, pension_employee_ngn, pension_employer_ngn,
 *   nhf_ngn, staff_recoveries_ngn (loans+advances), other_deductions_ngn,
 *   net_pay_ngn
 * @param {string} reference  run_number
 */
function buildPayrollAccrualLines(s, reference) {
  const dr = (code, amount, description) => ({
    account_code: code,
    debit_ngn: toCurrencyString(money(amount)),
    description,
  });
  const cr = (code, amount, description) => ({
    account_code: code,
    credit_ngn: toCurrencyString(money(amount)),
    description,
  });
  const lines = [];
  const push = (line, amount) => {
    if (money(amount || 0).gt(0)) lines.push(line);
  };
  push(dr(ACCOUNTS.SALARIES, s.earnings_ngn, `Salaries — ${reference}`), s.earnings_ngn);
  push(dr(ACCOUNTS.COMMISSION_EXPENSE, s.commission_ngn, `Commissions — ${reference}`), s.commission_ngn);
  push(dr(ACCOUNTS.BONUS_EXPENSE, s.bonus_ngn, `Bonuses — ${reference}`), s.bonus_ngn);
  push(dr(ACCOUNTS.PENSION_EMPLOYER_EXPENSE, s.pension_employer_ngn, `Employer pension — ${reference}`), s.pension_employer_ngn);
  push(cr(ACCOUNTS.PAYE_PAYABLE, s.paye_ngn, `PAYE withheld — ${reference}`), s.paye_ngn);
  push(cr(ACCOUNTS.PENSION_EMPLOYEE, s.pension_employee_ngn, `Employee pension — ${reference}`), s.pension_employee_ngn);
  push(cr(ACCOUNTS.PENSION_EMPLOYER, s.pension_employer_ngn, `Employer pension payable — ${reference}`), s.pension_employer_ngn);
  push(cr(ACCOUNTS.NHF_PAYABLE, s.nhf_ngn, `NHF withheld — ${reference}`), s.nhf_ngn);
  push(cr(ACCOUNTS.CASH_ADVANCES, s.staff_recoveries_ngn, `Staff loan/advance recoveries — ${reference}`), s.staff_recoveries_ngn);
  push(cr(ACCOUNTS.ACCRUED_EXPENSES, s.other_deductions_ngn, `Other payroll deductions — ${reference}`), s.other_deductions_ngn);
  push(cr(ACCOUNTS.ACCRUED_SALARIES, s.net_pay_ngn, `Net pay owed — ${reference}`), s.net_pay_ngn);
  return lines;
}

/** DR Accrued Salaries / CR Bank for net pay that actually left. */
function buildPayrollPaymentLines(amount_ngn, reference) {
  const amt = toCurrencyString(money(amount_ngn));
  return [
    {
      account_code: ACCOUNTS.ACCRUED_SALARIES,
      debit_ngn: amt,
      description: `Net pay settled — ${reference}`,
    },
    {
      account_code: ACCOUNTS.BANK_MAIN,
      credit_ngn: amt,
      description: `Payroll disbursement — ${reference}`,
    },
  ];
}

/** A queued payout that later FAILED never left the bank — re-accrue it. */
function buildPayoutFailureLines(net_pay_ngn, reference) {
  const amt = toCurrencyString(money(net_pay_ngn));
  return [
    {
      account_code: ACCOUNTS.BANK_MAIN,
      debit_ngn: amt,
      description: `Failed payout returned — ${reference}`,
    },
    {
      account_code: ACCOUNTS.ACCRUED_SALARIES,
      credit_ngn: amt,
      description: `Net pay re-accrued — ${reference}`,
    },
  ];
}

module.exports = {
  buildPayrollAccrualLines,
  buildPayrollPaymentLines,
  buildPayoutFailureLines,
};
