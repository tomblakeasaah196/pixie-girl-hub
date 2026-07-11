"use strict";

/**
 * Chief of Staff win celebrations (cos.celebrations.js) — the PURE message
 * builder (wow #8, PR6). The subscriber/quiet-hours/dedupe paths are DB-backed
 * and covered by the accountability integration pass; here we assert the copy.
 */

const { buildCelebration } = require("../../../src/modules/chief_of_staff/cos.celebrations");

describe("buildCelebration", () => {
  test("milestone win shows pace (X of Y)", () => {
    const c = buildCelebration({
      subjectType: "milestone",
      assistantName: "Ada",
      goalTitle: "Launch line",
      milestoneTitle: "Finalise supplier",
      doneCount: 3,
      totalCount: 6,
    });
    expect(c.title).toBe("🎉 Ada");
    expect(c.body).toContain("Finalise supplier");
    expect(c.body).toContain("3 of 6");
    expect(c.body).toContain("Launch line");
  });

  test("the final milestone reads as goal-complete", () => {
    const c = buildCelebration({
      subjectType: "milestone",
      goalTitle: "Launch line",
      milestoneTitle: "Ship it",
      doneCount: 6,
      totalCount: 6,
    });
    expect(c.body).toMatch(/final one/i);
  });

  test("milestone with no siblings still congratulates", () => {
    const c = buildCelebration({
      subjectType: "milestone",
      goalTitle: "Launch line",
      milestoneTitle: "Do the thing",
      doneCount: 1,
      totalCount: 0,
    });
    expect(c.body).toMatch(/nicely done/i);
  });

  test("goal achieved has its own copy", () => {
    const c = buildCelebration({
      subjectType: "goal",
      assistantName: "Chief of Staff",
      goalTitle: "Launch line",
    });
    expect(c.title).toBe("🎉 Chief of Staff");
    expect(c.body).toMatch(/Goal achieved/i);
    expect(c.body).toContain("Launch line");
  });

  test("defaults the assistant name", () => {
    const c = buildCelebration({ subjectType: "goal", goalTitle: "X" });
    expect(c.title).toBe("🎉 Chief of Staff");
  });
});
