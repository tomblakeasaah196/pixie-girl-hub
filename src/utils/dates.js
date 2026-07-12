"use strict";
// date-fns-tz v3 API: utcToZonedTime → toZonedTime, zonedTimeToUtc →
// fromZonedTime, and formatInTimeZone replaces format(zonedDate,{timeZone}).
const { fromZonedTime, toZonedTime, formatInTimeZone } = require("date-fns-tz");
const { config } = require("../config/env");

// Read TZ lazily (config is a Proxy that validates env on first property
// access). Resolving it inside each call — not at module load — keeps merely
// requiring this util side-effect-free, so it's safe to import from anywhere
// (including modules loaded in unit tests that don't set the full env).
const tz = () => config.TZ;

function nowInTz() {
  return toZonedTime(new Date(), tz());
}

function toUtc(date) {
  return fromZonedTime(date, tz());
}

function formatTz(date, fmt = "yyyy-MM-dd HH:mm:ss zzz") {
  return formatInTimeZone(date, tz(), fmt);
}

/* ── Canonical human-facing date/time format ──────────────────────────────
 * The Hub renders every human-facing timestamp as "23:57, 11/07/2026" —
 * 24-hour local time, then day/month/year — in the configured timezone
 * (Africa/Lagos, UTC+1). `formatDate` / `formatTime` are the date-only and
 * time-only halves of the same canon. This is DISPLAY ONLY: API payloads,
 * DB values, filenames and sort keys stay ISO 8601 (yyyy-MM-dd / RFC3339).
 * Mirror of apps/admin/src/lib/format.ts so the PDF/email/notification copy
 * matches the admin UI exactly.
 */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

// → { date: "dd/MM/yyyy", time: "HH:mm" } | null. A bare calendar date (a DATE
// column, no time or zone) is reformatted verbatim so timezone conversion can
// never shift the day; a full timestamp is converted into the display TZ.
function displayParts(value) {
  if (value === null || value === undefined || value === "") return null;
  if (!(value instanceof Date)) {
    const m = DATE_ONLY.exec(String(value));
    if (m) return { date: `${m[3]}/${m[2]}/${m[1]}`, time: "00:00" };
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return {
    date: formatInTimeZone(d, tz(), "dd/MM/yyyy"),
    time: formatInTimeZone(d, tz(), "HH:mm"),
  };
}

/** "23:57, 11/07/2026" — 24-hour time then DD/MM/YYYY. `fallback` for empty/invalid. */
function formatDateTime(value, fallback = "") {
  const p = displayParts(value);
  return p ? `${p.time}, ${p.date}` : fallback;
}

/** "11/07/2026" — date only (DD/MM/YYYY). */
function formatDate(value, fallback = "") {
  const p = displayParts(value);
  return p ? p.date : fallback;
}

/** "23:57" — 24-hour time only (HH:MM). */
function formatTime(value, fallback = "") {
  const p = displayParts(value);
  return p ? p.time : fallback;
}

module.exports = {
  nowInTz,
  toUtc,
  formatTz,
  formatDateTime,
  formatDate,
  formatTime,
  get TZ() {
    return config.TZ;
  },
};
