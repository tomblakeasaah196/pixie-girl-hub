/**
 * Chief of Staff (PR6) — shared time helpers.
 *
 * Small, pure, DB-free wall-clock utilities used by the accountability
 * scheduler and the celebration subscriber so quiet-hours / timezone logic
 * lives in exactly one place.
 */

"use strict";

/** Parse an "HH:MM" / "HH:MM:SS" wall-clock string to an integer hour (0–23). */
function parseHour(t, fallback = 0) {
  if (typeof t !== "string") return fallback;
  const m = t.match(/^(\d{1,2}):/);
  if (!m) return fallback;
  const h = Number(m[1]);
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : fallback;
}

/** Local wall-clock hour (0–23) in a timezone; falls back to Lagos (UTC+1). */
function localHour(tz = "Africa/Lagos", at = new Date()) {
  try {
    const h = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }).format(at);
    return Number(h) % 24;
  } catch {
    return (at.getUTCHours() + 1) % 24;
  }
}

/** True when `hour` falls inside a (possibly midnight-wrapping) quiet window. */
function isQuietHour(hour, quietStart = 21, quietEnd = 6) {
  return quietStart > quietEnd
    ? hour >= quietStart || hour < quietEnd
    : hour >= quietStart && hour < quietEnd;
}

module.exports = { parseHour, localHour, isQuietHour };
