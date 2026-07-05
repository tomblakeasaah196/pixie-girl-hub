/**
 * Lagos-pinned time helpers for HR attendance (audit fix: day boundaries and
 * lateness math were UTC, so 00:00–01:00 Lagos punches landed on the previous
 * day and lateness ran an hour lenient).
 *
 * Both businesses operate in Africa/Lagos, which is UTC+1 year-round (no DST),
 * so a fixed offset is exact and keeps these helpers pure.
 */

"use strict";

const LAGOS_UTC_OFFSET_MIN = 60;

/** 'YYYY-MM-DD' for the current instant in Africa/Lagos. */
function todayStr(now = new Date()) {
  return new Date(now.getTime() + LAGOS_UTC_OFFSET_MIN * 60000)
    .toISOString()
    .slice(0, 10);
}

/** { year, month } for a date string (or Lagos-today when omitted). */
function ym(dateStr) {
  const s = dateStr || todayStr();
  const d = new Date(`${s}T00:00:00Z`);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/** dateStr + n days (date-only arithmetic). */
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

module.exports = { LAGOS_UTC_OFFSET_MIN, todayStr, ym, addDays };
