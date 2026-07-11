"use strict";

/**
 * Chief of Staff meeting intelligence (cos.meeting.js) — the pure "open
 * questions" derivation for a prep brief. No DB.
 */

const meeting = require("../../../src/modules/chief_of_staff/cos.meeting");

// Freeze "today" so overdue detection is deterministic.
const RealDate = Date;
beforeAll(() => {
  global.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) return new RealDate("2026-08-15T09:00:00Z");
      return new RealDate(...args);
    }
    static now() {
      return new RealDate("2026-08-15T09:00:00Z").getTime();
    }
  };
});
afterAll(() => {
  global.Date = RealDate;
});

describe("deriveOpenQuestions", () => {
  test("prompts to link a goal when the event has none", () => {
    const q = meeting.deriveOpenQuestions({ goal: null, milestones: [], followups: [] });
    expect(q[0]).toMatch(/isn't linked to a goal/i);
  });

  test("surfaces at-risk health and overdue milestones", () => {
    const q = meeting.deriveOpenQuestions({
      goal: { title: "Launch", health: "behind", progress_pct: 30 },
      milestones: [
        { title: "Supplier", status: "in_progress", target_date: "2026-08-01" }, // overdue
        { title: "Done bit", status: "done", target_date: "2026-07-01" }, // ignored
        { title: "Future", status: "pending", target_date: "2026-09-01" }, // not overdue
      ],
      followups: [{ question: "Why did sampling stall?" }],
    });
    expect(q.some((x) => /behind/i.test(x))).toBe(true);
    expect(q.some((x) => /Supplier.*still/i.test(x))).toBe(true);
    expect(q).toContain("Why did sampling stall?");
    // The "Future" milestone (not overdue) and the done one are not raised.
    expect(q.some((x) => /Future/.test(x))).toBe(false);
  });

  test("falls back to a next-steps prompt for a healthy goal", () => {
    const q = meeting.deriveOpenQuestions({
      goal: { title: "Launch", health: "on_track", progress_pct: 80 },
      milestones: [],
      followups: [],
    });
    expect(q).toHaveLength(1);
    expect(q[0]).toMatch(/next steps/i);
  });
});
