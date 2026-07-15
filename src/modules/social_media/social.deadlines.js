/**
 * Social Studio — deadline enforcement policy (pure logic, unit-tested).
 *
 * Mirrors the Chief-of-Staff accountability sweep's shape (nudge, then
 * escalate) but flatter, per how this module's accountability model works:
 * there is no team-lead tier — a missed deadline nudges the creator directly,
 * and an unresolved miss reports straight to the CEO.
 */

"use strict";

const GRACE_MINUTES = 30; // how overdue before the first nudge fires
const NUDGE_COOLDOWN_HOURS = 3; // minimum gap between repeat nudges
const ESCALATE_AFTER_HOURS = 6; // total time overdue before it's flagged + reported

/**
 * @param {{now:Date, scheduledFor:string, lastNudgedAt:?string}} args
 * @returns {'escalate'|'nudge'|'wait'}
 */
function decideSweepAction({ now, scheduledFor, lastNudgedAt }) {
  const hoursLate =
    (now.getTime() - new Date(scheduledFor).getTime()) / 3_600_000;
  if (hoursLate < GRACE_MINUTES / 60) return "wait";
  if (hoursLate >= ESCALATE_AFTER_HOURS) return "escalate";
  if (!lastNudgedAt) return "nudge";
  const sinceNudgeHours =
    (now.getTime() - new Date(lastNudgedAt).getTime()) / 3_600_000;
  return sinceNudgeHours >= NUDGE_COOLDOWN_HOURS ? "nudge" : "wait";
}

/** Simple fixed quiet-hours window (no per-user prefs for this module yet).
 *  Default 21:00-07:00 Africa/Lagos — the business's home timezone. */
function isQuietHour(
  now,
  { timeZone = "Africa/Lagos", startHour = 21, endHour = 7 } = {},
) {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone,
    }).format(now),
  );
  return startHour <= endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour;
}

module.exports = {
  GRACE_MINUTES,
  NUDGE_COOLDOWN_HOURS,
  ESCALATE_AFTER_HOURS,
  decideSweepAction,
  isQuietHour,
};
