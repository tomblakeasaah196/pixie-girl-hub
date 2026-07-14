"use strict";

/**
 * Social Studio deadline policy (social.deadlines.js) — pure, no DB. The
 * nudge -> escalate decision and the fixed quiet-hours window.
 */

const deadlines = require("../../../src/modules/social_media/social.deadlines");

describe("decideSweepAction", () => {
  const scheduledFor = "2026-07-14T09:00:00Z";

  test("waits inside the grace window", () => {
    const now = new Date("2026-07-14T09:10:00Z"); // 10 min late
    expect(
      deadlines.decideSweepAction({ now, scheduledFor, lastNudgedAt: null }),
    ).toBe("wait");
  });

  test("nudges once past the grace window with no prior nudge", () => {
    const now = new Date("2026-07-14T10:00:00Z"); // 1h late
    expect(
      deadlines.decideSweepAction({ now, scheduledFor, lastNudgedAt: null }),
    ).toBe("nudge");
  });

  test("waits again inside the nudge cooldown", () => {
    const now = new Date("2026-07-14T11:00:00Z"); // 2h late
    const lastNudgedAt = "2026-07-14T10:00:00Z"; // nudged 1h ago, cooldown is 3h
    expect(
      deadlines.decideSweepAction({ now, scheduledFor, lastNudgedAt }),
    ).toBe("wait");
  });

  test("nudges again once the cooldown has elapsed", () => {
    const now = new Date("2026-07-14T13:30:00Z"); // 4.5h late
    const lastNudgedAt = "2026-07-14T10:00:00Z"; // nudged 3.5h ago
    expect(
      deadlines.decideSweepAction({ now, scheduledFor, lastNudgedAt }),
    ).toBe("nudge");
  });

  test("escalates once the total overdue time passes the threshold, regardless of nudges", () => {
    const now = new Date("2026-07-14T15:30:00Z"); // 6.5h late
    expect(
      deadlines.decideSweepAction({
        now,
        scheduledFor,
        lastNudgedAt: "2026-07-14T15:00:00Z",
      }),
    ).toBe("escalate");
  });
});

describe("isQuietHour", () => {
  test("true overnight, false during the day, in the default Lagos window", () => {
    const midnight = new Date("2026-07-14T23:30:00Z"); // 00:30 WAT next day
    const noon = new Date("2026-07-14T12:00:00Z"); // 13:00 WAT
    expect(deadlines.isQuietHour(midnight)).toBe(true);
    expect(deadlines.isQuietHour(noon)).toBe(false);
  });
});
