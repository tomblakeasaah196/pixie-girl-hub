/**
 * Payslip breakdown — the per-employee review sheet HR waives from (§6.11).
 *
 * Payroll's hard question is never "what is the total"; it is "why is this
 * person's total what it is, and is that fair". Answering it used to mean
 * leaving payroll for HR & Staff, reading the attendance ledger, finding the
 * query the reconciler raised, reading what the employee wrote back, deciding,
 * then coming back and re-running the whole run. This module assembles all of
 * that into one payload: every flagged day with its query and the employee's
 * response, every commission and bonus about to be added, every recovery about
 * to be taken — plus a projection of what the net becomes if the run were
 * recalculated right now.
 *
 * Pure functions, no I/O: the repo fetches, this shapes, so the arithmetic is
 * unit-testable and the "what changes if I waive this" preview is computed the
 * same way the calculator computes the real thing.
 */

"use strict";

const { round2 } = require("./payroll.calc");

const num = (v) => {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Why this day costs money — plain language for the review sheet, so HR is not
 * decoding status codes while deciding whether to take someone's pay.
 */
function dayReason(d) {
  if (d.status === "absent") return "Absent — full day at stake";
  if (d.status === "on_leave" && num(d.deduction_ngn) > 0)
    return "Unpaid leave — full day at stake";
  if (d.is_offsite && d.is_late)
    return `Late ${num(d.minutes_late)} min and clocked in off-site`;
  if (d.is_offsite) return "Clocked in off-site";
  if (d.is_late) return `Late ${num(d.minutes_late)} min`;
  return "Flagged for review";
}

/**
 * One reviewable attendance line. `at_stake_ngn` is what payroll would take if
 * this stays upheld; a justified day still reports its amount so HR can see
 * what a waive is worth and reverse it if they change their mind.
 */
function attendanceLine(d) {
  const atStake = num(d.deduction_ngn);
  return {
    day_id: d.day_id,
    work_date: d.work_date,
    status: d.status,
    reason: dayReason(d),
    minutes_late: num(d.minutes_late),
    expected_start_time: d.expected_start_time || null,
    first_clock_in_at: d.first_clock_in_at || null,
    is_offsite: Boolean(d.is_offsite),
    clock_in_address: d.clock_in_address || null,
    daily_rate_ngn: num(d.daily_rate_ngn),
    deduction_pct: num(d.deduction_pct),
    at_stake_ngn: atStake,
    // What this day actually costs the employee as things stand.
    applied_ngn: d.justified ? 0 : atStake,
    justified: Boolean(d.justified),
    decision: d.justified ? "waived" : d.resolution === "upheld" ? "upheld" : "pending",
    query: d.query_id
      ? {
          query_id: d.query_id,
          query_type: d.query_type,
          severity: d.severity,
          subject: d.query_subject,
          details: d.query_details,
          source: d.query_source,
          status: d.query_status,
          employee_response: d.employee_response,
          responded_at: d.responded_at,
          resolution: d.resolution,
          resolution_note: d.resolution_note,
          resolved_at: d.resolved_at,
          resolved_by_name: d.resolved_by_name,
        }
      : null,
  };
}

/** Commission rows as additions, with the sale that earned them. */
function commissionLine(c) {
  return {
    kind: "commission",
    id: c.earning_id,
    reference: c.earning_number,
    label: `Commission — ${String(c.sale_channel || "sale").replace(/_/g, " ")}`,
    detail:
      num(c.rate_pct) > 0
        ? `${num(c.rate_pct)}% of ${num(c.basis_amount_ngn)}`
        : null,
    amount_ngn: num(c.commission_amount_ngn),
    status: c.status,
    dated: c.earned_at,
    order_id: c.order_id || null,
    settled: Boolean(c.payroll_run_id),
  };
}

/** Bonus / reward rows as additions. */
function bonusLine(b) {
  return {
    kind: "bonus",
    id: b.bonus_id,
    reference: b.bonus_number,
    label: `${String(b.bonus_type || "bonus").replace(/_/g, " ")} bonus`,
    detail: b.reason || null,
    amount_ngn: num(b.amount_ngn),
    status: b.status,
    dated: b.awarded_at,
    settled: Boolean(b.payroll_run_id),
  };
}

/**
 * Project what this employee's pay becomes if the run were recalculated now.
 *
 * Deliberately arithmetic on the payslip as stored, not a re-run of the whole
 * calculator: the only figure a waive/uphold moves is the attendance deduction,
 * so the preview shifts that one number and carries everything else through.
 * `recalculatePayslip` then does the real, authoritative recomputation — this
 * is what HR sees before committing to it.
 */
function project({ payslip, attendance }) {
  const onSlip = num(payslip.attendance_deduction_ngn);
  const live = round2(
    attendance.reduce((sum, l) => sum + l.applied_ngn, 0),
  );
  const delta = round2(live - onSlip);
  const otherDeductions = round2(num(payslip.total_deductions_ngn) - onSlip);
  const projectedDeductions = round2(otherDeductions + live);
  return {
    gross_pay_ngn: num(payslip.gross_pay_ngn),
    attendance_on_slip_ngn: onSlip,
    attendance_live_ngn: live,
    attendance_waived_ngn: round2(
      attendance.reduce((s, l) => s + (l.justified ? l.at_stake_ngn : 0), 0),
    ),
    total_deductions_ngn: num(payslip.total_deductions_ngn),
    projected_total_deductions_ngn: projectedDeductions,
    net_pay_ngn: num(payslip.net_pay_ngn),
    projected_net_pay_ngn: round2(num(payslip.net_pay_ngn) - delta),
    // Non-zero means the slip is stale: a decision was made after it was
    // calculated, and recalculating will move the money.
    drift_ngn: round2(-delta),
    stale: Math.abs(delta) >= 0.01,
  };
}

/** Assemble the full review sheet from the raw repo reads. */
function buildBreakdown({
  payslip,
  attendanceDays = [],
  commissions = [],
  bonuses = [],
  runStatus,
}) {
  const attendance = attendanceDays.map(attendanceLine);
  const additions = [
    ...commissions.map(commissionLine),
    ...bonuses.map(bonusLine),
  ].sort((a, b) => String(a.dated || "").localeCompare(String(b.dated || "")));

  return {
    payslip,
    attendance,
    additions,
    additions_total_ngn: round2(
      additions.reduce((s, a) => s + a.amount_ngn, 0),
    ),
    totals: project({ payslip, attendance }),
    // Waiving after a run is approved would silently change what was signed
    // off; the UI hides the controls and the service refuses regardless.
    editable: ["draft", "calculated", "reviewed"].includes(String(runStatus)),
    run_status: runStatus || null,
  };
}

module.exports = {
  buildBreakdown,
  attendanceLine,
  commissionLine,
  bonusLine,
  dayReason,
  project,
};
