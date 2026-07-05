"use strict";

/**
 * Attendance insights (Employee 360 + My HR headers) — PURE.
 * Verifies punctuality, the earliest/latest arrival & departure the boss
 * asked about, days-at-risk, and Lagos-local time-of-day extraction.
 */

const {
  localMinutesOfDay,
  computeAttendanceInsights,
} = require("../../../src/shared/hr_payroll/lateness.calc");

const LAGOS = 60;

describe("localMinutesOfDay", () => {
  test("reads local time-of-day at the given offset", () => {
    // 07:10 UTC → 08:10 Lagos → 490 minutes.
    expect(localMinutesOfDay("2026-07-06T07:10:00Z", LAGOS)).toBe(490);
  });
  test("null / bad input → null", () => {
    expect(localMinutesOfDay(null, LAGOS)).toBeNull();
    expect(localMinutesOfDay("not-a-date", LAGOS)).toBeNull();
  });
});

describe("computeAttendanceInsights", () => {
  const days = [
    {
      work_date: "2026-07-06", status: "late", is_late: true, minutes_late: 20,
      is_offsite: false, justified: false,
      first_clock_in_at: "2026-07-06T08:20:00Z", // 09:20 Lagos (latest arrival)
      last_clock_out_at: "2026-07-06T16:30:00Z", // 17:30 Lagos (earliest out)
    },
    {
      work_date: "2026-07-07", status: "present", is_late: false, minutes_late: 0,
      is_offsite: false, justified: false,
      first_clock_in_at: "2026-07-07T07:10:00Z", // 08:10 Lagos (earliest arrival)
      last_clock_out_at: "2026-07-07T18:40:00Z", // 19:40 Lagos (latest out)
    },
    {
      work_date: "2026-07-08", status: "absent", is_late: false, minutes_late: 0,
      is_offsite: false, justified: false,
      first_clock_in_at: null, last_clock_out_at: null,
    },
  ];

  const ins = computeAttendanceInsights(days, LAGOS);

  test("counts present/late/absent", () => {
    expect(ins.present_days).toBe(2);
    expect(ins.late_days).toBe(1);
    expect(ins.absent_days).toBe(1);
  });

  test("punctuality = on-time / present", () => {
    expect(ins.punctuality_pct).toBe(50); // 1 of 2 present days was on time
  });

  test("average lateness only over late days", () => {
    expect(ins.avg_late_minutes).toBe(20);
  });

  test("earliest & latest arrival picked by local time-of-day", () => {
    expect(ins.earliest_arrival.work_date).toBe("2026-07-07");
    expect(ins.latest_arrival.work_date).toBe("2026-07-06");
  });

  test("earliest & latest departure picked by local time-of-day", () => {
    expect(ins.earliest_departure.work_date).toBe("2026-07-06");
    expect(ins.latest_departure.work_date).toBe("2026-07-07");
  });

  test("days at risk = unjustified late or off-site", () => {
    expect(ins.at_risk_days).toBe(1); // the late, unjustified day
  });

  test("empty input is all-zero, no throw", () => {
    const z = computeAttendanceInsights([], LAGOS);
    expect(z.present_days).toBe(0);
    expect(z.punctuality_pct).toBe(0);
    expect(z.earliest_arrival).toBeNull();
  });

  test("a justified late day is not at-risk", () => {
    const [d] = [{ ...days[0], justified: true }];
    expect(computeAttendanceInsights([d], LAGOS).at_risk_days).toBe(0);
  });
});
