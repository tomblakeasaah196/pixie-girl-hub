"use strict";

/**
 * evaluateClockTransition — one accepted clock_in + one accepted clock_out
 * per day, clock_out must follow a clock_in (clock-in audit 2026-07-07).
 */
const { evaluateClockTransition } = require("../../../src/shared/hr_payroll/clock.guard");

const IN = { event_type: "clock_in", accepted: true };
const OUT = { event_type: "clock_out", accepted: true };

describe("evaluateClockTransition", () => {
  test("first clock-in of the day is allowed", () => {
    const r = evaluateClockTransition({ todayEvents: [], eventType: "clock_in" });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBeNull();
  });

  test("second clock-in is blocked (the double clock-in bug)", () => {
    const r = evaluateClockTransition({ todayEvents: [IN], eventType: "clock_in" });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("already_clocked_in");
  });

  test("clock-out after a clock-in is allowed", () => {
    const r = evaluateClockTransition({ todayEvents: [IN], eventType: "clock_out" });
    expect(r.allowed).toBe(true);
  });

  test("clock-out without a clock-in is blocked", () => {
    const r = evaluateClockTransition({ todayEvents: [], eventType: "clock_out" });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("not_clocked_in");
  });

  test("second clock-out is blocked", () => {
    const r = evaluateClockTransition({ todayEvents: [IN, OUT], eventType: "clock_out" });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("already_clocked_out");
  });

  test("no re-clock-in after the day is complete (one cycle/day)", () => {
    const r = evaluateClockTransition({ todayEvents: [IN, OUT], eventType: "clock_in" });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("already_clocked_in");
  });

  test("rejected attempts do not count as a completed punch", () => {
    // A rejected (accepted:false) clock-in must not block a real clock-in.
    const rejected = { event_type: "clock_in", accepted: false };
    const r = evaluateClockTransition({ todayEvents: [rejected], eventType: "clock_in" });
    expect(r.allowed).toBe(true);
  });
});
