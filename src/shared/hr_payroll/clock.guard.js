/**
 * Clock-transition guard (attendance) — PURE, no DB.
 *
 * Enforces one accepted clock_in and one accepted clock_out per day, with
 * clock_out required to follow a clock_in. This is the control behind the
 * clock-in audit (2026-07-07): the append-only event log has no per-day
 * uniqueness of its own, so a double-tap / direct API call could otherwise
 * record two clock_ins for one day. Kept pure so it is unit-testable; the
 * DB partial unique index (migration 000303) is the concurrency backstop.
 *
 * NOTE: this deliberately allows exactly ONE in→out cycle per day. If the
 * business later wants break/return re-clock-in, relax the clock_in rule to
 * "no OPEN clock_in" instead of "no clock_in at all".
 */

"use strict";

/**
 * @param {object} args
 * @param {Array<{event_type:string, accepted:boolean}>} args.todayEvents
 *        Today's clock events for the profile (accepted + rejected both fine).
 * @param {'clock_in'|'clock_out'} args.eventType  The requested punch.
 * @returns {{allowed:boolean, reason:string|null, message:string|null}}
 */
function evaluateClockTransition({ todayEvents, eventType }) {
  const events = Array.isArray(todayEvents) ? todayEvents : [];
  const hasIn = events.some((e) => e.event_type === "clock_in" && e.accepted);
  const hasOut = events.some((e) => e.event_type === "clock_out" && e.accepted);

  if (eventType === "clock_in") {
    if (hasIn) {
      return {
        allowed: false,
        reason: "already_clocked_in",
        message: "You've already clocked in today.",
      };
    }
    return { allowed: true, reason: null, message: null };
  }

  if (eventType === "clock_out") {
    if (!hasIn) {
      return {
        allowed: false,
        reason: "not_clocked_in",
        message: "You can't clock out — you haven't clocked in today.",
      };
    }
    if (hasOut) {
      return {
        allowed: false,
        reason: "already_clocked_out",
        message: "You've already clocked out today.",
      };
    }
    return { allowed: true, reason: null, message: null };
  }

  return { allowed: false, reason: "invalid_event_type", message: "Invalid clock event." };
}

module.exports = { evaluateClockTransition };
