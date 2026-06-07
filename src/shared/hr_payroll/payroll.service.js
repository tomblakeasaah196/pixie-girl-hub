/**
 * Payroll operations service (V2.2 §6.11) — Pass 2.
 *
 * Run lifecycle (state machine):
 *   draft → calculated → reviewed → approved → paid   (+ reversed)
 * calculate() builds each active staffer's payslip from base salary + payable
 * commissions + approved bonuses, applying the active PAYE/pension/NHF config
 * (payroll.calc), and rolls up run totals. markPaid() settles payslips and
 * links/settles the underlying commissions & bonuses.
 *
 * Commissions: accrue → approve → paid (or reversed).
 * Bonuses: award → (approve | reject) → paid (or reversed). Approval is gated
 * on hr_payroll.approve; bonuses can additionally be routed through the §6.27
 * engine by adding a definition + completion reaction (not required here).
 *
 * All money writes are audited.
 */

"use strict";

const repo = require("./payroll.repo");
const calc = require("./payroll.calc");
const events = require("./hr.events");
const numbering = require("../../services/numbering.service");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError, ConflictError } = require("../../utils/errors");

function aud(fields) {
  return audit({ ...fields, is_sensitive: true });
}

// ── run state machine ──────────────────────────────────────
const RUN_TRANSITIONS = {
  draft: ["calculated"],
  calculated: ["calculated", "reviewed"], // re-calc allowed
  reviewed: ["approved", "calculated"],
  approved: ["paid", "reversed"],
  paid: ["reversed"],
};
function assertTransition(from, to) {
  if (!(RUN_TRANSITIONS[from] || []).includes(to)) {
    throw new ConflictError(`Payroll run cannot go ${from} → ${to}`);
  }
}

async function listRuns({ brand, filters, page, page_size }) {
  return repo.listRuns({ brand, filters, page, page_size });
}
async function getRun({ brand, run_id }) {
  const run = await repo.findRun({ brand, run_id });
  if (!run) throw new NotFoundError("Payroll run");
  return run;
}

async function createRun({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const existing = await repo.findRunByPeriod({
      client,
      brand,
      pay_year: input.pay_year,
      pay_month: input.pay_month,
    });
    if (existing)
      throw new ConflictError("A payroll run already exists for that period");
    const run_number = await numbering.periodNumber(
      client,
      brand,
      "payroll_run",
      {
        suffix: "PAY",
        year: input.pay_year,
        month: input.pay_month,
      },
    );
    const run = await repo.createRun({
      client,
      brand,
      run_number,
      input,
      created_by: user.user_id,
    });
    await aud({
      business: brand,
      user_id: user.user_id,
      action_key: "hr_payroll.create_payroll_run",
      target_type: "payroll_runs",
      target_id: run.run_id,
      after: run,
      request_id,
    });
    events.emit("payroll_run_created", { brand, run_id: run.run_id });
    return run;
  });
}

async function calculateRun({ brand, user, request_id, run_id }) {
  return transaction(async (client) => {
    const run = await repo.findRun({ client, brand, run_id });
    if (!run) throw new NotFoundError("Payroll run");
    assertTransition(run.status, "calculated");

    await repo.deletePayslipsForRun({ client, brand, run_id });

    const [staff, commByUser, bonusByUser, configs] = await Promise.all([
      repo.listActiveStaffForPayroll({
        client,
        brand,
        period_end: run.period_end,
      }),
      repo.payableCommissionByUser({ client, brand }),
      repo.payableBonusByUser({ client, brand }),
      repo.activeDeductionConfigs({ client, brand, as_of: run.pay_date }),
    ]);
    const commMap = Object.fromEntries(
      commByUser.map((r) => [r.user_id, Number(r.total)]),
    );
    const bonusMap = Object.fromEntries(
      bonusByUser.map((r) => [r.user_id, Number(r.total)]),
    );

    const totals = {
      total_staff: 0,
      total_gross_ngn: 0,
      total_commission_ngn: 0,
      total_bonus_ngn: 0,
      total_paye_ngn: 0,
      total_pension_employee_ngn: 0,
      total_pension_employer_ngn: 0,
      total_nhf_ngn: 0,
      total_other_deductions_ngn: 0,
      total_net_ngn: 0,
    };

    for (const s of staff) {
      const commission = commMap[s.user_id] || 0;
      const bonus = bonusMap[s.user_id] || 0;
      const slip = calc.buildPayslip({
        earnings: {
          base_salary: Number(s.base_salary) || 0,
          commission,
          bonus,
        },
        deductionConfigs: configs,
      });
      const payslip_number = await numbering.nextNumber(
        client,
        brand,
        "payslip",
        { suffix: "SLP" },
      );
      const inserted = await repo.insertPayslip({
        client,
        brand,
        payslip_number,
        data: {
          payslip_number,
          payroll_run_id: run_id,
          user_id: s.user_id,
          staff_profile_id: s.profile_id,
          job_title_snapshot: s.job_title,
          department_snapshot: s.department,
          ...slip,
        },
      });
      await repo.insertPayslipLines({
        client,
        brand,
        payslip_id: inserted.payslip_id,
        lines: slip.lines,
      });

      totals.total_staff += 1;
      totals.total_gross_ngn += slip.gross_pay_ngn;
      totals.total_commission_ngn += slip.commission_ngn;
      totals.total_bonus_ngn += slip.bonus_ngn;
      totals.total_paye_ngn += slip.paye_ngn;
      totals.total_pension_employee_ngn += slip.pension_employee_ngn;
      totals.total_pension_employer_ngn += slip.pension_employer_ngn;
      totals.total_nhf_ngn += slip.nhf_ngn;
      totals.total_other_deductions_ngn +=
        slip.other_deductions_ngn +
        slip.loan_repayment_ngn +
        slip.advance_recovery_ngn;
      totals.total_net_ngn += slip.net_pay_ngn;
    }
    for (const k of Object.keys(totals)) totals[k] = calc.round2(totals[k]);

    const updated = await repo.updateRun({
      client,
      brand,
      run_id,
      patch: {
        ...totals,
        status: "calculated",
        calculated_at: new Date().toISOString(),
      },
    });
    await aud({
      business: brand,
      user_id: user.user_id,
      action_key: "hr_payroll.calculate_payroll_run",
      target_type: "payroll_runs",
      target_id: run_id,
      after: { totals },
      request_id,
    });
    events.emit("payroll_run_calculated", { brand, run_id });
    return updated;
  });
}

async function transitionRun({
  brand,
  user,
  request_id,
  run_id,
  to,
  extra = {},
}) {
  return transaction(async (client) => {
    const run = await repo.findRun({ client, brand, run_id });
    if (!run) throw new NotFoundError("Payroll run");
    assertTransition(run.status, to);
    const patch = { status: to, ...extra };
    const updated = await repo.updateRun({ client, brand, run_id, patch });
    await aud({
      business: brand,
      user_id: user.user_id,
      action_key: `hr_payroll.${to}_payroll_run`,
      target_type: "payroll_runs",
      target_id: run_id,
      before: { status: run.status },
      after: { status: to },
      request_id,
    });
    events.emit(`payroll_run_${to}`, { brand, run_id });
    return updated;
  });
}

const reviewRun = (a) => transitionRun({ ...a, to: "reviewed" });
const approveRun = (a) =>
  transitionRun({
    ...a,
    to: "approved",
    extra: {
      approved_by: a.user.user_id,
      approved_at: new Date().toISOString(),
    },
  });

async function markRunPaid({ brand, user, request_id, run_id }) {
  return transaction(async (client) => {
    const run = await repo.findRun({ client, brand, run_id });
    if (!run) throw new NotFoundError("Payroll run");
    assertTransition(run.status, "paid");
    const now = new Date().toISOString();

    const { data: slips } = await repo.listPayslips({
      client,
      brand,
      filters: { payroll_run_id: run_id },
      page: 1,
      page_size: 1000,
    });
    for (const slip of slips) {
      await repo.setPayslipPayment({
        client,
        brand,
        payslip_id: slip.payslip_id,
        payment_status: "paid",
        fields: { paid_at: now },
      });
      await repo.markCommissionsPaidForUser({
        client,
        brand,
        user_id: slip.user_id,
        run_id,
        paid_at: now,
      });
      await repo.markBonusesPaidForUser({
        client,
        brand,
        user_id: slip.user_id,
        run_id,
        paid_at: now,
      });
    }
    const updated = await repo.updateRun({
      client,
      brand,
      run_id,
      patch: { status: "paid", paid_at: now },
    });
    await aud({
      business: brand,
      user_id: user.user_id,
      action_key: "hr_payroll.pay_payroll_run",
      target_type: "payroll_runs",
      target_id: run_id,
      after: { paid: slips.length },
      request_id,
    });
    events.emit("payroll_run_paid", { brand, run_id });
    return updated;
  });
}
const reverseRun = (a) => transitionRun({ ...a, to: "reversed" });

// ── payslips (read) ────────────────────────────────────────
async function listPayslips({ brand, filters, page, page_size }) {
  return repo.listPayslips({ brand, filters, page, page_size });
}
async function getPayslip({ brand, payslip_id }) {
  const slip = await repo.findPayslip({ brand, payslip_id });
  if (!slip) throw new NotFoundError("Payslip");
  return slip;
}

// ── commissions ────────────────────────────────────────────
async function listCommissions({ brand, filters, page, page_size }) {
  return repo.listCommissions({ brand, filters, page, page_size });
}
async function accrueCommission({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const earning_number = await numbering.nextNumber(
      client,
      brand,
      "commission",
      { suffix: "COM" },
    );
    const earning = await repo.createCommission({
      client,
      brand,
      earning_number,
      input,
    });
    await aud({
      business: brand,
      user_id: user.user_id,
      action_key: "hr_payroll.accrue_commission",
      target_type: "commission_earned",
      target_id: earning.earning_id,
      after: earning,
      request_id,
    });
    events.emit("commission_accrued", {
      brand,
      earning_id: earning.earning_id,
    });
    return earning;
  });
}
async function setCommissionState({ brand, user, request_id, earning_id, to }) {
  return transaction(async (client) => {
    const earning = await repo.findCommission({ client, brand, earning_id });
    if (!earning) throw new NotFoundError("Commission");
    if (earning.status === "paid")
      throw new ConflictError("Paid commission cannot be changed");
    const updated = await repo.setCommissionStatus({
      client,
      brand,
      earning_id,
      status: to,
    });
    await aud({
      business: brand,
      user_id: user.user_id,
      action_key: `hr_payroll.${to}_commission`,
      target_type: "commission_earned",
      target_id: earning_id,
      before: { status: earning.status },
      after: { status: to },
      request_id,
    });
    events.emit(`commission_${to}`, { brand, earning_id });
    return updated;
  });
}
const approveCommission = (a) => setCommissionState({ ...a, to: "approved" });
const reverseCommission = (a) => setCommissionState({ ...a, to: "reversed" });

// ── bonuses ────────────────────────────────────────────────
async function listBonuses({ brand, filters, page, page_size }) {
  return repo.listBonuses({ brand, filters, page, page_size });
}
async function awardBonus({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const bonus_number = await numbering.nextNumber(client, brand, "bonus", {
      suffix: "BON",
    });
    const bonus = await repo.createBonus({
      client,
      brand,
      bonus_number,
      input,
      awarded_by: user.user_id,
    });
    await aud({
      business: brand,
      user_id: user.user_id,
      action_key: "hr_payroll.award_bonus",
      target_type: "bonuses_awarded",
      target_id: bonus.bonus_id,
      after: bonus,
      request_id,
    });
    events.emit("bonus_awarded", { brand, bonus_id: bonus.bonus_id });
    return bonus;
  });
}
async function decideBonus({
  brand,
  user,
  request_id,
  bonus_id,
  decision,
  reason,
}) {
  return transaction(async (client) => {
    const bonus = await repo.findBonus({ client, brand, bonus_id });
    if (!bonus) throw new NotFoundError("Bonus");
    if (bonus.status !== "pending_approval") {
      throw new ConflictError(`Bonus is ${bonus.status}, not pending approval`);
    }
    const now = new Date().toISOString();
    const fields =
      decision === "approve"
        ? { approved_by: user.user_id, approved_at: now }
        : { rejected_at: now, rejection_reason: reason || null };
    const status = decision === "approve" ? "approved" : "rejected";
    const updated = await repo.setBonusStatus({
      client,
      brand,
      bonus_id,
      status,
      fields,
    });
    await aud({
      business: brand,
      user_id: user.user_id,
      action_key: `hr_payroll.${status}_bonus`,
      target_type: "bonuses_awarded",
      target_id: bonus_id,
      before: { status: bonus.status },
      after: { status },
      request_id,
    });
    events.emit(`bonus_${status}`, { brand, bonus_id });
    return updated;
  });
}
async function reverseBonus({ brand, user, request_id, bonus_id }) {
  return transaction(async (client) => {
    const bonus = await repo.findBonus({ client, brand, bonus_id });
    if (!bonus) throw new NotFoundError("Bonus");
    if (bonus.status === "paid")
      throw new ConflictError("Paid bonus cannot be reversed here");
    const updated = await repo.setBonusStatus({
      client,
      brand,
      bonus_id,
      status: "reversed",
    });
    await aud({
      business: brand,
      user_id: user.user_id,
      action_key: "hr_payroll.reverse_bonus",
      target_type: "bonuses_awarded",
      target_id: bonus_id,
      before: { status: bonus.status },
      after: { status: "reversed" },
      request_id,
    });
    events.emit("bonus_reversed", { brand, bonus_id });
    return updated;
  });
}

module.exports = {
  listRuns,
  getRun,
  createRun,
  calculateRun,
  reviewRun,
  approveRun,
  markRunPaid,
  reverseRun,
  listPayslips,
  getPayslip,
  listCommissions,
  accrueCommission,
  approveCommission,
  reverseCommission,
  listBonuses,
  awardBonus,
  decideBonus,
  reverseBonus,
};
