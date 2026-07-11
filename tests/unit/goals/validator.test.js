"use strict";

/**
 * Goals + Notes validators (Chief of Staff, PR1).
 */

const g = require("../../../src/shared/goals/goals.validator");
const n = require("../../../src/shared/goals/notes.validator");

function run(mw, body) {
  const req = { body };
  let called = false;
  let error;
  try {
    mw(req, {}, () => {
      called = true;
    });
  } catch (e) {
    error = e;
  }
  return { req, called, error };
}

const UUID = "11111111-1111-1111-1111-111111111111";

describe("goal validators", () => {
  test("create requires a title", () => {
    expect(run(g.validateGoalCreate, {}).error).toBeDefined();
    expect(run(g.validateGoalCreate, { title: "" }).error).toBeDefined();
    expect(run(g.validateGoalCreate, { title: "Launch Accessories" }).called).toBe(
      true,
    );
  });

  test("create rejects unknown fields (strict)", () => {
    expect(
      run(g.validateGoalCreate, { title: "X", nope: 1 }).error,
    ).toBeDefined();
  });

  test("create accepts inline milestones + target date", () => {
    const { called } = run(g.validateGoalCreate, {
      title: "Open New Store",
      priority: "high",
      target_date: "2026-09-01",
      milestones: [{ title: "Lease" }, { title: "Fit-out", target_date: "2026-08-01" }],
    });
    expect(called).toBe(true);
  });

  test("bad enum / bad date rejected", () => {
    expect(
      run(g.validateGoalCreate, { title: "X", priority: "sometime" }).error,
    ).toBeDefined();
    expect(
      run(g.validateGoalCreate, { title: "X", target_date: "next week" }).error,
    ).toBeDefined();
  });

  test("milestone update status is bounded", () => {
    expect(run(g.validateMilestoneUpdate, { status: "done" }).called).toBe(true);
    expect(
      run(g.validateMilestoneUpdate, { status: "teleported" }).error,
    ).toBeDefined();
  });

  test("stakeholder requires exactly one of user_id / contact_id", () => {
    expect(run(g.validateStakeholderAdd, {}).error).toBeDefined();
    expect(
      run(g.validateStakeholderAdd, { user_id: UUID, contact_id: UUID }).error,
    ).toBeDefined();
    expect(run(g.validateStakeholderAdd, { user_id: UUID }).called).toBe(true);
    expect(
      run(g.validateStakeholderAdd, { contact_id: UUID, role: "supplier" }).called,
    ).toBe(true);
  });
});

describe("note validators", () => {
  test("empty body is allowed (defaults to '')", () => {
    expect(run(n.validateNoteCreate, {}).called).toBe(true);
    expect(run(n.validateNoteCreate, { title: "Idea", body: "buy dye" }).called).toBe(
      true,
    );
  });

  test("bad goal_id rejected; unknown field rejected", () => {
    expect(run(n.validateNoteCreate, { goal_id: "x" }).error).toBeDefined();
    expect(run(n.validateNoteCreate, { surprise: true }).error).toBeDefined();
  });
});
