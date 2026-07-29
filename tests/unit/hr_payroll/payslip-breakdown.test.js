"use strict";

/**
 * Payslip breakdown — the per-employee review sheet HR waives from.
 * Pure shaping + projection: asserts the plain-language reasons, that a waived
 * day stops costing money without losing what it was worth, that additions are
 * merged and totalled, and that the projected net matches what a recalculation
 * would produce.
 */

const {
  buildBreakdown,
  attendanceLine,
  dayReason,
  project,
} = require("../../../src/shared/hr_payroll/payslip.breakdown");

const lateDay = {
  day_id: "d1",
  work_date: "2026-07-06",
  status: "late",
  is_late: true,
  minutes_late: 35,
  daily_rate_ngn: "6818.18",
  deduction_pct: "25.00",
  deduction_ngn: "1704.55",
  justified: false,
  query_id: "q1",
  query_type: "lateness",
  query_subject: "Lateness on 06/07/2026",
  query_source: "auto",
  query_status: "responded",
  employee_response: "Third Mainland Bridge was shut.",
  responded_at: "2026-07-07T08:12:00Z",
};

const absentDay = {
  day_id: "d2",
  work_date: "2026-07-14",
  status: "absent",
  is_late: false,
  minutes_late: 0,
  daily_rate_ngn: "6818.18",
  deduction_ngn: "6818.18",
  justified: false,
  query_id: null,
};

const waivedDay = {
  day_id: "d3",
  work_date: "2026-07-21",
  status: "late",
  is_late: true,
  minutes_late: 12,
  daily_rate_ngn: "6818.18",
  deduction_ngn: "682.00",
  justified: true,
  query_id: "q3",
  query_type: "lateness",
  query_subject: "Lateness on 21/07/2026",
  query_status: "waived",
  resolution: "waived",
  resolution_note: "Approved medical appointment",
  resolved_by_name: "Faitlyn Alex",
};

const payslip = {
  payslip_id: "p1",
  gross_pay_ngn: "150000.00",
  attendance_deduction_ngn: "8522.73", // late + absent, waived day already out
  total_deductions_ngn: "10522.73", // + 2,000 loan repayment
  net_pay_ngn: "139477.27",
};

describe("dayReason", () => {
  it("says what actually happened, in words HR can act on", () => {
    expect(dayReason(lateDay)).toBe("Late 35 min");
    expect(dayReason(absentDay)).toBe("Absent — full day at stake");
    expect(dayReason({ status: "on_leave", deduction_ngn: 500 })).toBe(
      "Unpaid leave — full day at stake",
    );
    expect(dayReason({ status: "present", is_offsite: true })).toBe(
      "Clocked in off-site",
    );
    expect(dayReason({ status: "late", is_late: true, is_offsite: true, minutes_late: 9 })).toBe(
      "Late 9 min and clocked in off-site",
    );
  });
});

describe("attendanceLine", () => {
  it("carries the query and the employee's own response", () => {
    const l = attendanceLine(lateDay);
    expect(l.query.subject).toBe("Lateness on 06/07/2026");
    expect(l.query.employee_response).toBe("Third Mainland Bridge was shut.");
    expect(l.query.source).toBe("auto");
    expect(l.decision).toBe("pending");
  });

  it("keeps a waived day's value visible while charging nothing for it", () => {
    const l = attendanceLine(waivedDay);
    expect(l.at_stake_ngn).toBe(682);
    expect(l.applied_ngn).toBe(0);
    expect(l.justified).toBe(true);
    expect(l.decision).toBe("waived");
    expect(l.query.resolved_by_name).toBe("Faitlyn Alex");
  });

  it("charges an unwaived day its full deduction", () => {
    expect(attendanceLine(absentDay).applied_ngn).toBe(6818.18);
  });

  it("reports a day with no query as a reviewable line all the same", () => {
    expect(attendanceLine(absentDay).query).toBeNull();
  });
});

describe("project", () => {
  it("reports no drift when the slip already matches the decisions", () => {
    const attendance = [lateDay, absentDay, waivedDay].map(attendanceLine);
    const t = project({ payslip, attendance });
    expect(t.attendance_live_ngn).toBe(8522.73);
    expect(t.attendance_on_slip_ngn).toBe(8522.73);
    expect(t.drift_ngn).toBe(0);
    expect(t.stale).toBe(false);
    expect(t.projected_net_pay_ngn).toBe(139477.27);
  });

  it("raises the projected net by exactly what a fresh waive is worth", () => {
    // HR has just waived the absent day; the slip still carries its cost.
    const attendance = [
      lateDay,
      { ...absentDay, justified: true },
      waivedDay,
    ].map(attendanceLine);
    const t = project({ payslip, attendance });
    expect(t.attendance_live_ngn).toBe(1704.55);
    expect(t.stale).toBe(true);
    expect(t.drift_ngn).toBe(6818.18);
    expect(t.projected_net_pay_ngn).toBe(146295.45);
    expect(t.projected_total_deductions_ngn).toBe(3704.55);
  });

  it("lowers the projected net when a waive is reversed", () => {
    const attendance = [
      lateDay,
      absentDay,
      { ...waivedDay, justified: false },
    ].map(attendanceLine);
    const t = project({ payslip, attendance });
    expect(t.attendance_live_ngn).toBe(9204.73);
    expect(t.drift_ngn).toBe(-682);
    expect(t.projected_net_pay_ngn).toBe(138795.27);
  });

  it("totals what has been waived so far", () => {
    const attendance = [lateDay, absentDay, waivedDay].map(attendanceLine);
    expect(project({ payslip, attendance }).attendance_waived_ngn).toBe(682);
  });
});

describe("buildBreakdown", () => {
  const commissions = [
    {
      earning_id: "c1",
      earning_number: "FLH-COM-0007",
      sale_channel: "instagram",
      basis_amount_ngn: "250000.00",
      rate_pct: "2.5000",
      commission_amount_ngn: "6250.00",
      status: "approved",
      earned_at: "2026-07-09T10:00:00Z",
      order_id: "o1",
    },
  ];
  const bonuses = [
    {
      bonus_id: "b1",
      bonus_number: "FLH-BON-0003",
      bonus_type: "service_quality",
      reason: "Five 5-star reviews in a week",
      amount_ngn: "15000.00",
      status: "approved",
      awarded_at: "2026-07-02T09:00:00Z",
    },
  ];

  it("merges additions oldest-first and totals them", () => {
    const b = buildBreakdown({
      payslip,
      attendanceDays: [lateDay],
      commissions,
      bonuses,
      runStatus: "calculated",
    });
    expect(b.additions.map((a) => a.kind)).toEqual(["bonus", "commission"]);
    expect(b.additions_total_ngn).toBe(21250);
    expect(b.additions[0].label).toBe("service quality bonus");
    expect(b.additions[0].detail).toBe("Five 5-star reviews in a week");
    expect(b.additions[1].label).toBe("Commission — instagram");
    expect(b.additions[1].detail).toBe("2.5% of 250000");
  });

  it("is editable while the run is still being worked, and not after", () => {
    const open = (status) =>
      buildBreakdown({ payslip, attendanceDays: [], runStatus: status }).editable;
    expect(open("draft")).toBe(true);
    expect(open("calculated")).toBe(true);
    expect(open("reviewed")).toBe(true);
    expect(open("approved")).toBe(false);
    expect(open("paid")).toBe(false);
    expect(open("reversed")).toBe(false);
  });

  it("survives an employee with nothing flagged and nothing added", () => {
    const b = buildBreakdown({ payslip, runStatus: "calculated" });
    expect(b.attendance).toEqual([]);
    expect(b.additions).toEqual([]);
    expect(b.additions_total_ngn).toBe(0);
    // No reconciled days → the slip's own attendance figure is the drift.
    expect(b.totals.attendance_live_ngn).toBe(0);
    expect(b.totals.stale).toBe(true);
  });
});
