"use strict";

const calc = require("../../../src/shared/hr_payroll/lateness.calc");

describe("lateness.calc — working days & daily rate", () => {
  test("counts mon-fri working days in a known month", () => {
    // June 2026: 22 weekdays (Mon-Fri).
    const wd = calc.workingDaysInMonth(2026, 6, ["mon", "tue", "wed", "thu", "fri"]);
    expect(wd).toBe(22);
  });

  test("daily rate is salary / working days, rounded to kobo", () => {
    expect(calc.dailyRate(220000, 22)).toBe(10000);
    expect(calc.dailyRate(100000, 22)).toBe(4545.45);
  });

  test("falls back to a 22-day month when no working days resolve", () => {
    expect(calc.dailyRate(220000, 0)).toBe(10000);
  });
});

describe("lateness.calc — minutes late", () => {
  const base = { expectedStart: "09:00", graceMinutes: 0, dateStr: "2026-06-22" };

  test("on-time clock-in is not late", () => {
    expect(
      calc.minutesLate({ ...base, firstClockInAt: "2026-06-22T09:00:00Z" }),
    ).toBe(0);
  });

  test("90 minutes late is counted", () => {
    expect(
      calc.minutesLate({ ...base, firstClockInAt: "2026-06-22T10:30:00Z" }),
    ).toBe(90);
  });

  test("grace window suppresses lateness within it", () => {
    expect(
      calc.minutesLate({
        ...base,
        graceMinutes: 15,
        firstClockInAt: "2026-06-22T09:10:00Z",
      }),
    ).toBe(0);
  });

  test("no expected start time → never late", () => {
    expect(
      calc.minutesLate({ ...base, expectedStart: null, firstClockInAt: "2026-06-22T12:00:00Z" }),
    ).toBe(0);
  });
});

describe("lateness.calc — tiered deduction (meeting defaults)", () => {
  const tiers = [
    { after_minutes: 60, deduction_pct: 10 },
    { after_minutes: 120, deduction_pct: 20 },
    { after_minutes: 180, deduction_pct: 30 },
  ];

  test("under an hour late → no deduction", () => {
    expect(calc.deductionPctForMinutes(45, tiers)).toBe(0);
  });
  test("1 hour late → 10%", () => {
    expect(calc.deductionPctForMinutes(60, tiers)).toBe(10);
  });
  test("2 hours late → 20%", () => {
    expect(calc.deductionPctForMinutes(125, tiers)).toBe(20);
  });
  test("3+ hours late → 30%", () => {
    expect(calc.deductionPctForMinutes(400, tiers)).toBe(30);
  });
  test("amount = daily rate × pct", () => {
    expect(calc.deductionAmount(10000, 10)).toBe(1000);
  });
});

describe("lateness.calc — reconcileDay", () => {
  const tiers = [{ after_minutes: 60, deduction_pct: 10 }];
  const common = {
    dateStr: "2026-06-22",
    baseSalaryNgn: 220000,
    workingDaysCount: 22,
    expectedStart: "09:00",
    graceMinutes: 0,
    tiers,
  };

  test("present on time earns the full daily rate", () => {
    const r = calc.reconcileDay({ ...common, firstClockInAt: "2026-06-22T08:55:00Z" });
    expect(r.status).toBe("present");
    expect(r.deduction_ngn).toBe(0);
    expect(r.earned_ngn).toBe(10000);
  });

  test("late by 90 min loses 10% of the day", () => {
    const r = calc.reconcileDay({ ...common, firstClockInAt: "2026-06-22T10:30:00Z" });
    expect(r.status).toBe("late");
    expect(r.deduction_pct).toBe(10);
    expect(r.deduction_ngn).toBe(1000);
    expect(r.earned_ngn).toBe(9000);
  });

  test("absent earns nothing", () => {
    const r = calc.reconcileDay({ ...common, firstClockInAt: null });
    expect(r.status).toBe("absent");
    expect(r.earned_ngn).toBe(0);
  });

  test("approved leave earns the day with no deduction", () => {
    const r = calc.reconcileDay({ ...common, firstClockInAt: null, isOnLeave: true });
    expect(r.status).toBe("on_leave");
    expect(r.earned_ngn).toBe(10000);
  });

  test("non-working day earns nothing and is not late", () => {
    const r = calc.reconcileDay({ ...common, firstClockInAt: null, isWorkingDay: false });
    expect(r.status).toBe("off");
    expect(r.worked).toBe(false);
  });

  test("clocking in on a scheduled day off counts as present, not off", () => {
    const r = calc.reconcileDay({
      ...common, firstClockInAt: "2026-06-22T13:00:00Z", isWorkingDay: false,
    });
    expect(r.status).toBe("present_day_off");
    expect(r.worked).toBe(true);
    expect(r.deduction_ngn).toBe(0);
    expect(r.earned_ngn).toBe(10000);
  });
});

describe("lateness.calc — minutesOvertime (supplementary hours)", () => {
  const base = { expectedEnd: "18:00", dateStr: "2026-06-22" };

  test("clocking out after close counts the extra minutes", () => {
    expect(
      calc.minutesOvertime({ ...base, lastClockOutAt: "2026-06-22T18:45:00Z" }),
    ).toBe(45);
  });

  test("clocking out before close is zero (not negative)", () => {
    expect(
      calc.minutesOvertime({ ...base, lastClockOutAt: "2026-06-22T17:30:00Z" }),
    ).toBe(0);
  });

  test("clocking out exactly at close is zero", () => {
    expect(
      calc.minutesOvertime({ ...base, lastClockOutAt: "2026-06-22T18:00:00Z" }),
    ).toBe(0);
  });

  test("no expected end or no clock-out → zero", () => {
    expect(
      calc.minutesOvertime({ ...base, expectedEnd: null, lastClockOutAt: "2026-06-22T20:00:00Z" }),
    ).toBe(0);
    expect(calc.minutesOvertime({ ...base, lastClockOutAt: null })).toBe(0);
  });

  test("respects the workplace timezone offset (Lagos = 60)", () => {
    // 19:00 Lagos = 18:00Z; against an 18:00 local close that is exactly 60 min.
    expect(
      calc.minutesOvertime({
        ...base,
        lastClockOutAt: "2026-06-22T18:00:00Z",
        tzOffsetMinutes: 60,
      }),
    ).toBe(60);
  });
});

describe("lateness.calc — computeAttendanceInsights", () => {
  test("counts present_day_off as a present day", () => {
    const insights = calc.computeAttendanceInsights([
      { status: "present_day_off", first_clock_in_at: "2026-06-22T13:00:00Z", work_date: "2026-06-22" },
      { status: "present", first_clock_in_at: "2026-06-23T09:00:00Z", work_date: "2026-06-23" },
    ]);
    expect(insights.present_days).toBe(2);
  });

  test("aggregates overtime across days", () => {
    const insights = calc.computeAttendanceInsights([
      { status: "present", overtime_minutes: 30, work_date: "2026-06-22" },
      { status: "present", overtime_minutes: 0, work_date: "2026-06-23" },
      { status: "present", overtime_minutes: 90, work_date: "2026-06-24" },
    ]);
    expect(insights.overtime_minutes).toBe(120);
    expect(insights.overtime_days).toBe(2);
    expect(insights.avg_overtime_minutes).toBe(60);
  });
});
