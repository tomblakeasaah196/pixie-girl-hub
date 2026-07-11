"use strict";

/**
 * Chief of Staff risk engine (cos.risk.js) — pure, no DB/LLM. Due buckets,
 * staleness, slippage projection, health precedence, and candidate emission.
 */

const risk = require("../../../src/modules/chief_of_staff/cos.risk");

const NOW = new Date("2026-07-11T12:00:00Z");

describe("dueBucket", () => {
  test("classifies overdue / today / tomorrow / none", () => {
    expect(risk.dueBucket("2026-07-10", NOW)).toBe("overdue");
    expect(risk.dueBucket("2026-07-11T23:00:00Z", NOW)).toBe("due_today");
    expect(risk.dueBucket("2026-07-12T06:00:00Z", NOW)).toBe("due_tomorrow");
    expect(risk.dueBucket("2026-07-20", NOW)).toBeNull();
    expect(risk.dueBucket(null, NOW)).toBeNull();
  });
});

describe("isStale", () => {
  test("true only past the stale window", () => {
    const stale = new Date("2026-06-20T12:00:00Z"); // 21 days
    const fresh = new Date("2026-07-05T12:00:00Z"); // 6 days
    expect(risk.isStale({ lastActivityAt: stale, now: NOW, staleDays: 14 })).toBe(true);
    expect(risk.isStale({ lastActivityAt: fresh, now: NOW, staleDays: 14 })).toBe(false);
    expect(risk.isStale({ lastActivityAt: null, now: NOW })).toBe(false);
  });
});

describe("projectSlippage", () => {
  test("projects past target when velocity is too slow", () => {
    const goal = { created_at: "2026-06-11T12:00:00Z", target_date: "2026-07-20" };
    // 30 days elapsed, 1 of 4 done → 0.033/day; 3 remaining ≈ 90 days out.
    const milestones = [
      { status: "done" },
      { status: "pending" },
      { status: "pending" },
      { status: "pending" },
    ];
    const s = risk.projectSlippage({ goal, milestones, now: NOW });
    expect(s.slipDays).toBeGreaterThan(0);
  });

  test("no slippage when all milestones are done", () => {
    const goal = { created_at: "2026-06-11T12:00:00Z", target_date: "2026-07-20" };
    const s = risk.projectSlippage({
      goal,
      milestones: [{ status: "done" }, { status: "done" }],
      now: NOW,
    });
    expect(s.slipDays).toBeNull();
  });

  test("null when there is no target date", () => {
    const s = risk.projectSlippage({
      goal: { created_at: "2026-06-11T12:00:00Z", target_date: null },
      milestones: [{ status: "pending" }],
      now: NOW,
    });
    expect(s.slipDays).toBeNull();
  });
});

describe("assessGoal", () => {
  const baseGoal = {
    goal_id: "g1",
    title: "Launch",
    status: "active",
    progress_pct: 20,
    created_at: "2026-05-11T12:00:00Z",
    target_date: "2026-08-31",
  };

  test("behind + overdue-milestone candidate when a milestone is past due", () => {
    const { health, candidates } = risk.assessGoal({
      goal: baseGoal,
      milestones: [
        { milestone_id: "m1", title: "Supplier", status: "pending", target_date: "2026-07-01" },
      ],
      tasks: [],
      lastActivityAt: "2026-07-10T12:00:00Z",
      now: NOW,
    });
    expect(health).toBe("behind");
    expect(candidates.some((c) => c.subject_type === "milestone" && c.trigger === "overdue")).toBe(true);
  });

  test("at_risk + no_progress candidate when stale with no overdue items", () => {
    // Generous target (well past any projection) so ONLY staleness fires.
    const { health, candidates } = risk.assessGoal({
      goal: { ...baseGoal, target_date: "2027-06-01" },
      milestones: [{ milestone_id: "m1", title: "Later", status: "pending", target_date: "2027-05-20" }],
      tasks: [],
      lastActivityAt: "2026-06-15T12:00:00Z", // 26 days stale
      now: NOW,
    });
    expect(health).toBe("at_risk");
    expect(candidates.some((c) => c.trigger === "no_progress" && c.subject_type === "goal")).toBe(true);
  });

  test("emits a due_today task candidate", () => {
    const { candidates } = risk.assessGoal({
      goal: baseGoal,
      milestones: [],
      tasks: [{ task_id: "t1", title: "Ship", status: "to_do", due_at: "2026-07-11T15:00:00Z" }],
      lastActivityAt: "2026-07-11T09:00:00Z",
      now: NOW,
    });
    const c = candidates.find((x) => x.subject_type === "task");
    expect(c).toBeTruthy();
    expect(c.trigger).toBe("due_today");
  });

  test("achieved goal reports achieved and raises no candidates", () => {
    const { health, candidates } = risk.assessGoal({
      goal: { ...baseGoal, status: "active", progress_pct: 100 },
      milestones: [{ milestone_id: "m1", status: "done", target_date: "2026-06-01" }],
      tasks: [],
      lastActivityAt: "2026-07-10T12:00:00Z",
      now: NOW,
    });
    expect(health).toBe("achieved");
    expect(candidates.length).toBe(0);
  });

  test("done/cancelled tasks and done/skipped milestones raise nothing", () => {
    const { candidates } = risk.assessGoal({
      goal: baseGoal,
      milestones: [{ milestone_id: "m1", status: "done", target_date: "2026-07-01" }],
      tasks: [{ task_id: "t1", status: "done", due_at: "2026-07-01T00:00:00Z" }],
      lastActivityAt: "2026-07-10T12:00:00Z",
      now: NOW,
    });
    expect(candidates.length).toBe(0);
  });
});
