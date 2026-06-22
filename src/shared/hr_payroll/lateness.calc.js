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
 */
function minutesLate({ expectedStart, firstClockInAt, graceMinutes = 0, dateStr }) {
  if (!expectedStart || !firstClockInAt) return 0;
  const m = /^(\d{1,2}):(\d{2})/.exec(expectedStart);
  if (!m) return 0;
  const expected = new Date(`${dateStr}T00:00:00Z`);
  expected.setUTCHours(Number(m[1]), Number(m[2]) + Number(graceMinutes || 0), 0, 0);
  const actual = new Date(firstClockInAt);
  const diffMin = Math.floor((actual.getTime() - expected.getTime()) / 60000);
  return diffMin > 0 ? diffMin : 0;
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
  isWorkingDay = true,
  tiers,
}) {
  const rate = dailyRate(baseSalaryNgn, workingDaysCount);

  if (!isWorkingDay) {
    return { status: "off", minutes_late: 0, deduction_pct: 0, deduction_ngn: 0,
      daily_rate_ngn: rate, earned_ngn: 0, worked: false };
  }
  if (isOnLeave) {
    return { status: "on_leave", minutes_late: 0, deduction_pct: 0, deduction_ngn: 0,
      daily_rate_ngn: rate, earned_ngn: rate, worked: false };
  }
  if (!firstClockInAt) {
    return { status: "absent", minutes_late: 0, deduction_pct: 0, deduction_ngn: 0,
      daily_rate_ngn: rate, earned_ngn: 0, worked: false };
  }

  const mins = minutesLate({ expectedStart, firstClockInAt, graceMinutes, dateStr });
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

module.exports = {
  round2,
  weekdayKey,
  workingDaysInMonth,
  dailyRate,
  resolveWorkingDay,
  minutesLate,
  deductionPctForMinutes,
  deductionAmount,
  reconcileDay,
};
