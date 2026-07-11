"use strict";

/**
 * Chief of Staff playbook templates (cos.templates.js) — the PURE offset<->date
 * maths: capturing a goal into an offset structure, and re-dating it into an
 * ordered, token-wired batch plan. No DB.
 */

const tpl = require("../../../src/modules/chief_of_staff/cos.templates");

describe("structureFromGoal", () => {
  const goal = { created_at: "2026-01-01T00:00:00Z", priority: "high" };
  const milestones = [
    { milestone_id: "m1", title: "Supplier", target_date: "2026-01-31", display_order: 0, status: "pending" },
    { milestone_id: "m2", title: "Samples", target_date: "2026-02-15", display_order: 1, status: "pending" },
    { milestone_id: "skip", title: "Skipped", target_date: "2026-03-01", display_order: 2, status: "skipped" },
  ];
  const tasks = [
    { task_id: "t1", title: "Call factory", due_at: "2026-01-11T17:00:00Z", milestone_id: "m1" },
    { task_id: "t2", title: "Goal-level task", due_at: "2026-01-06T17:00:00Z", milestone_id: null },
  ];

  test("captures milestone/task offsets from the goal's start and drops skipped", () => {
    const s = tpl.structureFromGoal({ goal, milestones, tasks });
    expect(s.goal.priority).toBe("high");
    expect(s.milestones).toHaveLength(2); // skipped excluded
    expect(s.milestones[0]).toMatchObject({ title: "Supplier", offset_days: 30 });
    expect(s.milestones[0].tasks[0]).toMatchObject({ title: "Call factory", offset_days: 10 });
    expect(s.tasks[0]).toMatchObject({ title: "Goal-level task", offset_days: 5 });
  });

  test("offsets never go negative", () => {
    const s = tpl.structureFromGoal({
      goal: { created_at: "2026-06-01", priority: "normal" },
      milestones: [{ milestone_id: "m", title: "Past", target_date: "2026-05-01", display_order: 0, status: "pending" }],
      tasks: [],
    });
    expect(s.milestones[0].offset_days).toBe(0);
  });
});

describe("stepsFromTemplate — re-dating round-trip", () => {
  const structure = {
    goal: { priority: "high" },
    milestones: [
      { title: "Supplier", offset_days: 30, tasks: [{ title: "Call factory", offset_days: 10 }] },
      { title: "Samples", offset_days: 45, tasks: [] },
    ],
    tasks: [{ title: "Kickoff", offset_days: 0 }],
  };

  test("produces create_goal → milestones → tasks + links in order", () => {
    const steps = tpl.stepsFromTemplate({ structure, startDate: "2026-06-01", name: "Relaunch" });
    const keys = steps.map((s) => s.action_key);
    expect(keys[0]).toBe("workspace.create_goal");
    expect(keys).toContain("workspace.add_milestone");
    expect(keys).toContain("workspace.create_task");
    expect(keys).toContain("workspace.link_task");
  });

  test("re-dates every offset from the chosen start date", () => {
    const steps = tpl.stepsFromTemplate({ structure, startDate: "2026-06-01", name: "Relaunch" });
    const goalStep = steps[0];
    // Goal target = start + max offset (45d) = 2026-07-16.
    expect(goalStep.payload.target_date).toBe("2026-07-16");

    const supplier = steps.find((s) => s.action_key === "workspace.add_milestone" && s.payload.title === "Supplier");
    expect(supplier.payload.target_date).toBe("2026-07-01"); // +30d

    const task = steps.find((s) => s.action_key === "workspace.create_task");
    expect(task.payload.due_at.slice(0, 10)).toBe("2026-06-11"); // +10d
  });

  test("wires cross-step tokens: milestones + tasks reference the new goal", () => {
    const steps = tpl.stepsFromTemplate({ structure, startDate: "2026-06-01", name: "Relaunch" });
    const milestone = steps.find((s) => s.action_key === "workspace.add_milestone");
    expect(milestone.payload.id).toBe("{{step:0.goal_id}}");

    const link = steps.find((s) => s.action_key === "workspace.link_task");
    expect(link.payload.id).toBe("{{step:0.goal_id}}");
    expect(link.payload.taskId).toMatch(/^\{\{step:\d+\.task_id\}\}$/);
    // A milestone task also links to its milestone.
    expect(link.payload.milestone_id).toMatch(/^\{\{step:\d+\.milestone_id\}\}$/);
  });
});

describe("dayOffset / addDaysDateOnly", () => {
  test("round-trip: an offset applied to a start reproduces the date", () => {
    const off = tpl.dayOffset("2026-01-01", "2026-01-31");
    expect(off).toBe(30);
    expect(tpl.addDaysDateOnly("2026-06-01", off)).toBe("2026-07-01");
  });
});
