/**
 * Lateness & daily-earnings engine (HR Phase 1) — PURE, no DB.
 *
 * Implements the meeting's real-time rules (docs meeting notes §3.1):
 *  - Monthly salary is pro-rated to a daily value over the brand's working
 *    days in that month (answer #1: live calc + a persisted daily snapshot).
 *  - Lateness past the grace window is deducted on a tiered scale that the
 *    brand configures in HR Settings (answer #2). Default tiers mirror the
 *    meeting: 1h late = 10%, 2h = 20%, 3h = 30% of that day's pay.
 *
 * Kept pure so the money math is unit-testable in isolation. Money flows in
 * as numbers and is rounded to kobo (2dp) at the edges.
 */

"use strict";

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** ISO weekday key ('mon'..'sun') for a YYYY-MM-DD string (date-only, UTC). */
function weekdayKey(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return WEEKDAY_KEYS[d.getUTCDay()];
}

/**
 * Count the working days in a calendar month for a given working-day set.
 * @param year   full year (2026)
 * @param month  1-12
 * @param workingDays  array of weekday keys, e.g. ['mon',...,'fri']
 */
function workingDaysInMonth(year, month, workingDays) {
  const set = new Set((workingDays || []).map((d) => d.toLowerCase()));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate(); // last day of month
  let count = 0;
  for (let day = 1; day <= days; day++) {
    const key = WEEKDAY_KEYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
    if (set.has(key)) count++;
  }
  return count;
}

/**
 * Daily pay rate: monthly base salary / working days in that month.
 * Falls back to a 22-day month if no working days resolve (defensive).
 */
function dailyRate(baseSalaryNgn, workingDaysCount) {
  const denom = workingDaysCount > 0 ? workingDaysCount : 22;
  return round2(Number(baseSalaryNgn || 0) / denom);
}

/**
 * Whether a given weekday is a working day for this staff member. A
 * per-employee work_schedule map ({mon:'on_site'|'remote'|'off'}) wins; the
 * brand's working_days set is the fallback.
 * @returns { working:boolean, mode:'on_site'|'remote'|'off'|null }
 */
function resolveWorkingDay({ dateStr, workSchedule, brandWorkingDays }) {
  const key = weekdayKey(dateStr);
  if (workSchedule && Object.keys(workSchedule).length > 0) {
    const mode = workSchedule[key] || "off";
    return { working: mode !== "off", mode };
  }
  const set = new Set((brandWorkingDays || []).map((d) => d.toLowerCase()));
  return { working: set.has(key), mode: set.has(key) ? "on_site" : "off" };
}

/**
 * Minutes late = (first clock-in) − (expected start + grace), floored at 0.
 * @param expectedStart 'HH:MM' local expected start, or null/'' → never late
 * @param firstClockInAt ISO timestamp of the first accepted clock-in, or null
 * @param graceMinutes minutes of grace before lateness counts
 * @param dateStr the working date 'YYYY-MM-DD' the clock-in belongs to
 * @param tzOffsetMinutes local-time UTC offset of the workplace (60 for
 *        Africa/Lagos). expectedStart is wall-clock local time; the clock-in
 *        timestamp is a UTC instant, so the expected instant must be shifted.
 */
function minutesLate({
  expectedStart,
  firstClockInAt,
  graceMinutes = 0,
  dateStr,
  tzOffsetMinutes = 0,
}) {
  if (!expectedStart || !firstClockInAt) return 0;
  const m = /^(\d{1,2}):(\d{2})/.exec(expectedStart);
  if (!m) return 0;
  const expected = new Date(`${dateStr}T00:00:00Z`);
  expected.setUTCHours(
    Number(m[1]),
    Number(m[2]) + Number(graceMinutes || 0) - Number(tzOffsetMinutes || 0),
    0, 0,
  );
  const actual = new Date(firstClockInAt);
  const diffMin = Math.floor((actual.getTime() - expected.getTime()) / 60000);
  return diffMin > 0 ? diffMin : 0;
}

/**
 * Minutes left early = (expected end) − (last clock-out), floored at 0.
 * 0 when there is no expected end or no clock-out (open days / forgot to
 * punch out are not penalised here — reconcile just records what it has).
 */
function minutesEarly({ expectedEnd, lastClockOutAt, dateStr, tzOffsetMinutes = 0 }) {
  if (!expectedEnd || !lastClockOutAt) return 0;
  const m = /^(\d{1,2}):(\d{2})/.exec(expectedEnd);
  if (!m) return 0;
  const expected = new Date(`${dateStr}T00:00:00Z`);
  expected.setUTCHours(Number(m[1]), Number(m[2]) - Number(tzOffsetMinutes || 0), 0, 0);
  const actual = new Date(lastClockOutAt);
  const diffMin = Math.floor((expected.getTime() - actual.getTime()) / 60000);
  return diffMin > 0 ? diffMin : 0;
}

/**
 * Inclusive count of working days between two 'YYYY-MM-DD' dates for a
 * working-day set (used to pro-rate mid-period joiners/leavers).
 */
function workingDaysBetween(startStr, endStr, workingDays) {
  const set = new Set((workingDays || []).map((d) => d.toLowerCase()));
  const start = new Date(`${startStr}T00:00:00Z`);
  const end = new Date(`${endStr}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return 0;
  }
  let count = 0;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (set.has(WEEKDAY_KEYS[d.getUTCDay()])) count++;
  }
  return count;
}

/**
 * Deduction percentage for N minutes late, from the brand's ordered tiers.
 * Tiers: [{after_minutes, deduction_pct}] — the highest tier whose
 * after_minutes threshold is met wins. 0 if not late or below the first tier.
 */
function deductionPctForMinutes(minutes, tiers) {
  if (!minutes || minutes <= 0 || !Array.isArray(tiers)) return 0;
  const ordered = [...tiers]
    .filter((t) => t && t.after_minutes !== null && t.after_minutes !== undefined)
    .sort((a, b) => Number(a.after_minutes) - Number(b.after_minutes));
  let pct = 0;
  for (const t of ordered) {
    if (minutes >= Number(t.after_minutes)) pct = Number(t.deduction_pct) || 0;
  }
  return pct;
}

/** Naira deduction for a day = dailyRate × pct%. */
function deductionAmount(dailyRateNgn, pct) {
  return round2((Number(dailyRateNgn || 0) * Number(pct || 0)) / 100);
}

/**
 * One-call reconcile of a single staff day. Returns the figures the
 * attendance_days + staff_earnings_daily rows are built from.
 */
function reconcileDay({
  dateStr,
  baseSalaryNgn,
  workingDaysCount,
  expectedStart,
  graceMinutes,
  firstClockInAt,
  isOnLeave = false,
  isUnpaidLeave = false,
  isWorkingDay = true,
  tiers,
  tzOffsetMinutes = 0,
}) {
  const rate = dailyRate(baseSalaryNgn, workingDaysCount);

  // A real clock-in always counts as presence, even on a scheduled day off —
  // checked BEFORE the rest-day short-circuit below. Previously `!isWorkingDay`
  // returned "off" unconditionally, so an employee who clocked in on their day
  // off was mislabelled "off" despite the clock-in being recorded and paid.
  if (!isWorkingDay && firstClockInAt) {
    return { status: "present_day_off", minutes_late: 0, deduction_pct: 0, deduction_ngn: 0,
      daily_rate_ngn: rate, earned_ngn: rate, worked: true };
  }
  if (!isWorkingDay) {
    return { status: "off", minutes_late: 0, deduction_pct: 0, deduction_ngn: 0,
      daily_rate_ngn: rate, earned_ngn: 0, worked: false };
  }
  if (isOnLeave) {
    // Paid leave earns the day; unpaid leave shows the day's rate as a
    // deduction so the tracker and the payslip agree (§3.5).
    return isUnpaidLeave
      ? { status: "on_leave", minutes_late: 0, deduction_pct: 100, deduction_ngn: rate,
          daily_rate_ngn: rate, earned_ngn: 0, worked: false }
      : { status: "on_leave", minutes_late: 0, deduction_pct: 0, deduction_ngn: 0,
          daily_rate_ngn: rate, earned_ngn: rate, worked: false };
  }
  if (!firstClockInAt) {
    return { status: "absent", minutes_late: 0, deduction_pct: 0, deduction_ngn: 0,
      daily_rate_ngn: rate, earned_ngn: 0, worked: false };
  }

  const mins = minutesLate({
    expectedStart, firstClockInAt, graceMinutes, dateStr, tzOffsetMinutes,
  });
  const pct = deductionPctForMinutes(mins, tiers);
  const ded = deductionAmount(rate, pct);
  return {
    status: mins > 0 ? "late" : "present",
    minutes_late: mins,
    deduction_pct: pct,
    deduction_ngn: ded,
    daily_rate_ngn: rate,
    earned_ngn: round2(rate - ded),
    worked: true,
  };
}

/** Local minutes-since-midnight for an ISO instant at a fixed UTC offset. */
function localMinutesOfDay(iso, tzOffsetMinutes = 0) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const shifted = new Date(d.getTime() + Number(tzOffsetMinutes || 0) * 60000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/**
 * Employee attendance insights over a set of reconciled `attendance_days`
 * rows (PURE). Powers the Employee 360 + My HR headers: punctuality, the
 * earliest/latest arrival & departure the boss asked about, days liable to a
 * query, and average lateness. Times are read at the workplace offset
 * (Africa/Lagos = 60).
 */
function computeAttendanceInsights(days, tzOffsetMinutes = 0) {
  let present = 0, late = 0, absent = 0, offsite = 0, atRisk = 0, lateSum = 0;
  let earliestArrival = null, latestArrival = null;
  let earliestDeparture = null, latestDeparture = null;

  for (const d of days || []) {
    if (d.status === "present" || d.status === "late" || d.status === "present_day_off") present++;
    if (d.is_late) { late++; lateSum += Number(d.minutes_late || 0); }
    if (d.status === "absent") absent++;
    if (d.is_offsite) offsite++;
    if ((d.is_late || d.is_offsite) && !d.justified) atRisk++;

    const inMin = localMinutesOfDay(d.first_clock_in_at, tzOffsetMinutes);
    if (inMin !== null) {
      const rec = { work_date: d.work_date, at: d.first_clock_in_at, local_minutes: inMin };
      if (!earliestArrival || inMin < earliestArrival.local_minutes) earliestArrival = rec;
      if (!latestArrival || inMin > latestArrival.local_minutes) latestArrival = rec;
    }
    const outMin = localMinutesOfDay(d.last_clock_out_at, tzOffsetMinutes);
    if (outMin !== null) {
      const rec = { work_date: d.work_date, at: d.last_clock_out_at, local_minutes: outMin };
      if (!earliestDeparture || outMin < earliestDeparture.local_minutes) earliestDeparture = rec;
      if (!latestDeparture || outMin > latestDeparture.local_minutes) latestDeparture = rec;
    }
  }

  return {
    present_days: present,
    late_days: late,
    absent_days: absent,
    offsite_days: offsite,
    at_risk_days: atRisk,
    punctuality_pct: present > 0 ? Math.round(((present - late) / present) * 100) : 0,
    avg_late_minutes: late > 0 ? round2(lateSum / late) : 0,
    earliest_arrival: earliestArrival,
    latest_arrival: latestArrival,
    earliest_departure: earliestDeparture,
    latest_departure: latestDeparture,
  };
}

module.exports = {
  round2,
  weekdayKey,
  workingDaysInMonth,
  workingDaysBetween,
  dailyRate,
  resolveWorkingDay,
  minutesLate,
  minutesEarly,
  deductionPctForMinutes,
  deductionAmount,
  reconcileDay,
  localMinutesOfDay,
  computeAttendanceInsights,
};
