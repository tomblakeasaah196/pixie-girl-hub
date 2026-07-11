"use strict";

/**
 * Chief of Staff smart scheduling (cos.scheduler.js) — the PURE core: free-slot
 * finding (no double-book, work + quiet hours, no past slots) and day-load /
 * overload detection. No DB.
 */

const sched = require("../../../src/modules/chief_of_staff/cos.scheduler");

// Local (Lagos, UTC+1) minutes-since-midnight for a UTC ISO instant.
const localMin = (iso) => {
  const d = new Date(new Date(iso).getTime() + 60 * 60000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
const overlaps = (a, b) =>
  new Date(a.start_at) < new Date(b.end) && new Date(a.end_at) > new Date(b.start);

const NOW = new Date("2026-08-01T00:00:00Z"); // Saturday, before the search window

describe("findFreeSlots", () => {
  test("never double-books a busy interval", () => {
    // 10:00–12:00 Lagos on 2026-08-03 == 09:00–11:00 UTC.
    const busy = [{ start: "2026-08-03T09:00:00.000Z", end: "2026-08-03T11:00:00.000Z" }];
    const slots = sched.findFreeSlots({
      busy,
      durationMin: 60,
      fromDate: "2026-08-03",
      days: 1,
      now: NOW,
      limit: 50,
    });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.some((s) => overlaps(s, busy[0]))).toBe(false);
  });

  test("every slot sits inside work hours (08:00–18:00 local)", () => {
    const slots = sched.findFreeSlots({
      busy: [],
      durationMin: 120,
      fromDate: "2026-08-03",
      days: 1,
      now: NOW,
      limit: 50,
    });
    for (const s of slots) {
      expect(localMin(s.start_at)).toBeGreaterThanOrEqual(8 * 60);
      expect(localMin(s.end_at)).toBeLessThanOrEqual(18 * 60);
    }
    // First free block starts exactly at work start.
    expect(localMin(slots[0].start_at)).toBe(8 * 60);
  });

  test("never proposes a slot in the past", () => {
    const now = new Date("2026-08-03T12:00:00.000Z"); // 13:00 Lagos
    const slots = sched.findFreeSlots({
      busy: [],
      durationMin: 60,
      fromDate: "2026-08-03",
      days: 1,
      now,
      limit: 50,
    });
    for (const s of slots) expect(new Date(s.start_at).getTime()).toBeGreaterThanOrEqual(now.getTime());
  });

  test("respects a custom quiet window that eats into work hours", () => {
    // Push work end to 23:00 and quiet from 20:00 — slots must end by 20:00 local.
    const slots = sched.findFreeSlots({
      busy: [],
      durationMin: 60,
      fromDate: "2026-08-03",
      days: 1,
      now: NOW,
      limit: 50,
      workEndMin: 23 * 60,
      quietStartMin: 20 * 60,
      quietEndMin: 6 * 60,
    });
    for (const s of slots) expect(localMin(s.end_at)).toBeLessThanOrEqual(20 * 60);
  });

  test("returns nothing when the requested block can't fit in work hours", () => {
    const slots = sched.findFreeSlots({
      busy: [],
      durationMin: 12 * 60, // 12h won't fit in a 10h work day
      fromDate: "2026-08-03",
      days: 3,
      now: NOW,
    });
    expect(slots).toEqual([]);
  });
});

describe("inQuiet", () => {
  test("handles a wrapping (overnight) quiet window", () => {
    expect(sched.inQuiet(22 * 60, 21 * 60, 6 * 60)).toBe(true); // 22:00
    expect(sched.inQuiet(3 * 60, 21 * 60, 6 * 60)).toBe(true); // 03:00
    expect(sched.inQuiet(12 * 60, 21 * 60, 6 * 60)).toBe(false); // noon
  });
});

describe("computeLoad", () => {
  const day = "2026-08-03";
  test("sums meeting hours and flags overload past the threshold", () => {
    const events = [
      { event_type: "meeting", start_at: "2026-08-03T07:00:00Z", end_at: "2026-08-03T11:00:00Z" }, // 4h
      { event_type: "call", start_at: "2026-08-03T12:00:00Z", end_at: "2026-08-03T14:00:00Z" }, // 2h
      { event_type: "reminder", start_at: "2026-08-03T15:00:00Z", end_at: "2026-08-03T17:00:00Z" }, // not a meeting
    ];
    const load = sched.computeLoad({ events, tasks: [], date: day, meetingHoursThreshold: 5 });
    expect(load.meeting_hours).toBe(6);
    expect(load.meetings).toBe(2);
    expect(load.overloaded).toBe(true);
  });

  test("counts only open high-priority tasks due that day", () => {
    const tasks = [
      { priority: "urgent", status: "to_do", due_at: "2026-08-03T17:00:00Z" }, // counts
      { priority: "high", status: "done", due_at: "2026-08-03T17:00:00Z" }, // done → skip
      { priority: "normal", status: "to_do", due_at: "2026-08-03T17:00:00Z" }, // low prio → skip
      { priority: "high", status: "to_do", due_at: "2026-08-05T17:00:00Z" }, // wrong day → skip
    ];
    const load = sched.computeLoad({ events: [], tasks, date: day, highTaskThreshold: 1 });
    expect(load.high_priority_tasks).toBe(1);
    expect(load.overloaded).toBe(true);
  });

  test("not overloaded on a light day", () => {
    const load = sched.computeLoad({
      events: [{ event_type: "meeting", start_at: "2026-08-03T09:00:00Z", end_at: "2026-08-03T10:00:00Z" }],
      tasks: [],
      date: day,
    });
    expect(load.overloaded).toBe(false);
  });
});
