/**
 * Chief of Staff (PR6) — adaptive nudge timing (wow #8).
 *
 * Pure, DB-free helpers so they're trivially unit-testable. The accountability
 * scheduler feeds these the CEO's observed engagement hours (derived from
 * shared.cos_nudges.engaged_at, converted to the CEO's local wall-clock hour)
 * and gets back the hour at which a recurring nudge should fire — nudged toward
 * when she actually acts, but always bounded to her work hours.
 *
 * The signal only shifts timing once there's enough evidence (MIN_SAMPLES);
 * below that it returns the CEO's configured default unchanged, so a brand-new
 * account behaves exactly as the fixed schedule until a habit emerges.
 */

"use strict";

const MIN_SAMPLES = 4;

/** Clamp an hour into an inclusive [lo, hi] wall-clock window. */
function clampHour(hour, lo, hi) {
  if (lo > hi) return hour; // defensive: not a normal work window
  return Math.min(hi, Math.max(lo, hour));
}

/** The median of a numeric array (integer hours). Returns null when empty. */
function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * The hour a recurring nudge should fire.
 *
 * @param {number[]} engagedHours  local hours (0–23) the CEO engaged at
 * @param {object}   opts
 * @param {number}   opts.defaultHour  the configured fallback hour (0–23)
 * @param {number}   [opts.workStart=8]
 * @param {number}   [opts.workEnd=18]
 * @param {number}   [opts.minSamples=MIN_SAMPLES]
 * @param {number}   [opts.floorHour]  only consider engagements at/after this
 *                                     hour (e.g. afternoon for the evening
 *                                     review) — filters morning noise
 * @returns {number} the (clamped) hour to fire at
 */
function preferredHour(engagedHours, opts = {}) {
  const {
    defaultHour,
    workStart = 8,
    workEnd = 18,
    minSamples = MIN_SAMPLES,
    floorHour = null,
  } = opts;

  const base = clampHour(defaultHour, workStart, workEnd);
  const sample = (engagedHours || []).filter(
    (h) => Number.isInteger(h) && h >= 0 && h <= 23 && (floorHour === null || h >= floorHour),
  );
  if (sample.length < minSamples) return base;

  const m = median(sample);
  if (m === null) return base;
  return clampHour(m, Math.max(workStart, floorHour ?? workStart), workEnd);
}

module.exports = { preferredHour, clampHour, median, MIN_SAMPLES };
