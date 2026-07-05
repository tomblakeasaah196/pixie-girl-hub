"use strict";

/**
 * PR1 payroll-truth unit tests (audit C1–C4 + Lagos TZ / clock-out).
 *
 * Everything here is PURE (no DB): the attendance→payslip money, the PAYE
 * toggle behaviour, pro-rating, advance-recovery cap, and the Lagos-pinned
 * lateness / early-leave math.
 */

const {
  buildPayslip,
  capAdvanceRecovery,
} = require("../../../src/shared/hr_payroll/payroll.calc");
const {
  minutesLate,
  minutesEarly,
  workingDaysBetween,
  reconcileDay,
} = require("../../../src/shared/hr_payroll/lateness.calc");
const lagos = require("../../../src/shared/hr_payroll/lagos-time");

const BANDS = [
  { lower: 0, upper: 300000, rate: 0.07 },
  { lower: 300000, upper: null, rate: 0.11 },
];
const STATUTORY = {
  paye: { bands: BANDS, consolidated_relief_ngn: 200000, consolidated_relief_pct: 0.2 },
  pension_employee: { rate_pct: 0.08 },
  nhf: { rate_pct: 0.025 },
};

describe("attendance deduction reaches net pay (audit C1)", () => {
  test("attendance deduction is a deduction line and lowers net", () => {
    const slip = buildPayslip({
      earnings: { base_salary: 100000 },
      attendance: { deduction_ngn: 5000, days_worked: 20, working_days: 22 },
    });
    expect(slip.attendance_deduction_ngn).toBe(5000);
    expect(slip.net_pay_ngn).toBe(95000);
    const line = slip.lines.find((l) => l.line_type === "attendance_deduction");
    expect(line).toBeTruthy();
    expect(line.amount_ngn).toBe(5000);
    expect(slip.days_worked).toBe(20);
    expect(slip.working_days_in_period).toBe(22);
  });

  test("no attendance deduction → no line", () => {
    const slip = buildPayslip({ earnings: { base_salary: 100000 } });
    expect(slip.attendance_deduction_ngn).toBe(0);
    expect(slip.lines.find((l) => l.line_type === "attendance_deduction")).toBeUndefined();
  });
});

describe("PAYE toggle (audit C3)", () => {
  test("no configs → zero statutory, gross = net", () => {
    const slip = buildPayslip({ earnings: { base_salary: 500000 }, deductionConfigs: {} });
    expect(slip.paye_ngn).toBe(0);
    expect(slip.pension_employee_ngn).toBe(0);
    expect(slip.nhf_ngn).toBe(0);
    expect(slip.net_pay_ngn).toBe(500000);
    expect(slip.lines.find((l) => l.line_type === "paye")).toBeUndefined();
  });

  test("with configs → statutory withheld", () => {
    const slip = buildPayslip({ earnings: { base_salary: 500000 }, deductionConfigs: STATUTORY });
    expect(slip.paye_ngn).toBeGreaterThan(0);
    expect(slip.pension_employee_ngn).toBeGreaterThan(0);
    expect(slip.net_pay_ngn).toBeLessThan(500000);
  });
});

describe("pro-rating for mid-period joiners/leavers (audit C2)", () => {
  test("half factor halves the base and labels the line", () => {
    const slip = buildPayslip({ earnings: { base_salary: 100000 }, prorateFactor: 0.5 });
    expect(slip.base_salary_ngn).toBe(50000);
    expect(slip.net_pay_ngn).toBe(50000);
    expect(slip.prorate_factor).toBe(0.5);
    const line = slip.lines.find((l) => l.line_type === "base_salary");
    expect(line.description).toMatch(/pro-rated/i);
  });

  test("factor clamps to [0,1] and defaults to 1", () => {
    expect(buildPayslip({ earnings: { base_salary: 100000 }, prorateFactor: 2 }).base_salary_ngn).toBe(100000);
    expect(buildPayslip({ earnings: { base_salary: 100000 } }).prorate_factor).toBe(1);
  });
});

describe("capAdvanceRecovery (audit C4)", () => {
  test("caps at the configured % of net", () => {
    expect(capAdvanceRecovery({ netBeforeRecovery: 100000, outstanding: 80000, capPct: 50 })).toBe(50000);
  });
  test("recovers the full balance when under the cap", () => {
    expect(capAdvanceRecovery({ netBeforeRecovery: 100000, outstanding: 20000, capPct: 50 })).toBe(20000);
  });
  test("zero when nothing outstanding or no net", () => {
    expect(capAdvanceRecovery({ netBeforeRecovery: 100000, outstanding: 0, capPct: 50 })).toBe(0);
    expect(capAdvanceRecovery({ netBeforeRecovery: 0, outstanding: 5000, capPct: 50 })).toBe(0);
  });
  test("defaults to 50% when capPct missing", () => {
    expect(capAdvanceRecovery({ netBeforeRecovery: 100000, outstanding: 100000 })).toBe(50000);
  });
});

describe("Lagos-pinned lateness (bug: UTC ran an hour lenient)", () => {
  test("09:20 Lagos vs 09:00 expected + 0 grace = 20 late", () => {
    // 09:20 Lagos == 08:20Z.
    const late = minutesLate({
      expectedStart: "09:00",
      firstClockInAt: "2026-07-06T08:20:00Z",
      graceMinutes: 0,
      dateStr: "2026-07-06",
      tzOffsetMinutes: lagos.LAGOS_UTC_OFFSET_MIN,
    });
    expect(late).toBe(20);
  });

  test("grace absorbs small lateness", () => {
    const late = minutesLate({
      expectedStart: "09:00",
      firstClockInAt: "2026-07-06T08:10:00Z", // 09:10 Lagos
      graceMinutes: 15,
      dateStr: "2026-07-06",
      tzOffsetMinutes: lagos.LAGOS_UTC_OFFSET_MIN,
    });
    expect(late).toBe(0);
  });
});

describe("early departure (audit H3)", () => {
  test("leaving before expected end counts minutes early", () => {
    // 17:30 Lagos == 16:30Z, expected end 18:00.
    const early = minutesEarly({
      expectedEnd: "18:00",
      lastClockOutAt: "2026-07-06T16:30:00Z",
      dateStr: "2026-07-06",
      tzOffsetMinutes: lagos.LAGOS_UTC_OFFSET_MIN,
    });
    expect(early).toBe(30);
  });
  test("no clock-out or no expected end → 0", () => {
    expect(minutesEarly({ expectedEnd: "18:00", lastClockOutAt: null, dateStr: "2026-07-06" })).toBe(0);
    expect(minutesEarly({ expectedEnd: null, lastClockOutAt: "2026-07-06T20:00:00Z", dateStr: "2026-07-06" })).toBe(0);
  });
});

describe("unpaid leave loses the day (§3.5)", () => {
  const common = {
    dateStr: "2026-07-06",
    baseSalaryNgn: 220000,
    workingDaysCount: 22,
    expectedStart: "09:00",
    graceMinutes: 0,
    firstClockInAt: null,
    isWorkingDay: true,
    tiers: [],
  };
  test("paid leave earns the daily rate", () => {
    const r = reconcileDay({ ...common, isOnLeave: true, isUnpaidLeave: false });
    expect(r.earned_ngn).toBe(10000);
    expect(r.deduction_ngn).toBe(0);
  });
  test("unpaid leave earns nothing and shows the day as a deduction", () => {
    const r = reconcileDay({ ...common, isOnLeave: true, isUnpaidLeave: true });
    expect(r.earned_ngn).toBe(0);
    expect(r.deduction_ngn).toBe(10000);
  });
});

describe("workingDaysBetween (pro-rate denominator)", () => {
  const week = ["mon", "tue", "wed", "thu", "fri"];
  test("counts inclusive working days", () => {
    // Mon 2026-07-06 .. Fri 2026-07-10 = 5 working days.
    expect(workingDaysBetween("2026-07-06", "2026-07-10", week)).toBe(5);
    // include the weekend → still 5.
    expect(workingDaysBetween("2026-07-06", "2026-07-12", week)).toBe(5);
  });
  test("reversed or empty range → 0", () => {
    expect(workingDaysBetween("2026-07-10", "2026-07-06", week)).toBe(0);
  });
});

describe("lagos-time helpers", () => {
  test("todayStr rolls to the next day for late-UTC instants", () => {
    // 2026-07-06 23:30 UTC == 2026-07-07 00:30 Lagos.
    expect(lagos.todayStr(new Date("2026-07-06T23:30:00Z"))).toBe("2026-07-07");
  });
  test("addDays does date arithmetic", () => {
    expect(lagos.addDays("2026-07-06", 2)).toBe("2026-07-08");
  });
});
