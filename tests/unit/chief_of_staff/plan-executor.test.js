"use strict";

/**
 * Chief of Staff plan executor (cos.plan-executor.js) — ordered execution,
 * cross-step token resolution at run time, partial-failure stop, and resume.
 * cos.repo + praxis.executor are mocked (no DB, no HTTP).
 */

jest.mock("../../../src/modules/chief_of_staff/cos.repo");
jest.mock("../../../src/modules/praxis_ai/praxis.executor", () => ({
  executeAction: jest.fn(),
}));
jest.mock("../../../src/shared/goals/goals.repo", () => ({
  findActiveByTitle: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/config/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const repo = require("../../../src/modules/chief_of_staff/cos.repo");
const executor = require("../../../src/modules/praxis_ai/praxis.executor");
const goalsRepo = require("../../../src/shared/goals/goals.repo");
const planExec = require("../../../src/modules/chief_of_staff/cos.plan-executor");

const PLAN = { plan_id: "plan-1", proposed_by_user_id: "u1", business: "pixiegirl" };

/** Wire cos.repo mocks over an in-memory `steps` array (mutated by setStepStatus). */
function wireRepo(steps) {
  const planStatus = { value: PLAN.status || "confirmed" };
  repo.listPlanSteps.mockImplementation(async () => steps);
  repo.setStepStatus.mockImplementation(async ({ id, status, fields = {} }) => {
    const s = steps.find((x) => x.pending_id === id);
    Object.assign(s, { status, ...fields });
    return s;
  });
  repo.setPlanStatus.mockImplementation(async ({ status }) => {
    planStatus.value = status;
    return { ...PLAN, status };
  });
  repo.findPlan.mockResolvedValue({ ...PLAN });
  return planStatus;
}

beforeEach(() => jest.clearAllMocks());

test("runs steps in order and resolves {{step:N.field}} from prior results", async () => {
  const steps = [
    { pending_id: "p0", plan_step: 0, status: "confirmed", method: "POST", route: "/api/v1/goals", business: "pixiegirl", payload: { title: "Launch" } },
    { pending_id: "p1", plan_step: 1, status: "confirmed", method: "POST", route: "/api/v1/goals/:id/milestones", business: "pixiegirl", payload: { id: "{{step:0.goal_id}}", title: "M1" } },
  ];
  wireRepo(steps);
  executor.executeAction
    .mockResolvedValueOnce({ ok: true, http_status: 201, result: { data: { goal_id: "g-1" } } })
    .mockResolvedValueOnce({ ok: true, http_status: 201, result: { data: { milestone_id: "m-1" } } });

  const out = await planExec.executePlan({ plan: { ...PLAN }, auth_header: "Bearer x", request_id: "r1" });

  expect(out.status).toBe("executed");
  expect(executor.executeAction).toHaveBeenCalledTimes(2);
  // The milestone step's {{step:0.goal_id}} was resolved to the real id.
  expect(executor.executeAction.mock.calls[1][0].pending.payload).toEqual({ id: "g-1", title: "M1" });
  expect(steps[0].status).toBe("executed");
  expect(steps[1].status).toBe("executed");
});

test("a failed step stops the run and lands the plan in partially_failed", async () => {
  const steps = [
    { pending_id: "p0", plan_step: 0, status: "confirmed", method: "POST", route: "/api/v1/goals", business: "pixiegirl", payload: { title: "Launch" } },
    { pending_id: "p1", plan_step: 1, status: "confirmed", method: "POST", route: "/api/v1/goals/:id/milestones", business: "pixiegirl", payload: { id: "{{step:0.goal_id}}", title: "M1" } },
  ];
  wireRepo(steps);
  executor.executeAction.mockResolvedValueOnce({ ok: false, http_status: 422, result: { error: "boom" } });

  const out = await planExec.executePlan({ plan: { ...PLAN }, auth_header: "Bearer x" });

  expect(out.status).toBe("partially_failed");
  expect(executor.executeAction).toHaveBeenCalledTimes(1); // dependent step never ran
  expect(steps[0].status).toBe("failed");
  expect(steps[1].status).toBe("confirmed"); // untouched
});

test("fails a step whose token cannot resolve (no such prior result)", async () => {
  const steps = [
    { pending_id: "p1", plan_step: 0, status: "confirmed", method: "POST", route: "/api/v1/goals/:id/milestones", business: "pixiegirl", payload: { id: "{{step:9.goal_id}}", title: "M1" } },
  ];
  wireRepo(steps);
  const out = await planExec.executePlan({ plan: { ...PLAN }, auth_header: "Bearer x" });
  expect(out.status).toBe("partially_failed");
  expect(executor.executeAction).not.toHaveBeenCalled();
  expect(steps[0].status).toBe("failed");
  expect(steps[0].execution_error).toMatch(/cross-step reference/i);
});

test("confirmPlan stamps confirmed_by_user_id on each proposed step (no 409)", async () => {
  // Regression for the ACTION_BLOCKED (P0001) 409 on Approve plan: flipping a
  // step proposed → confirmed must carry confirmed_by_user_id, or the
  // ai_pending_actions confirm trigger raises.
  const plan = {
    plan_id: "plan-9",
    proposed_by_user_id: "u1",
    business: "pixiegirl",
    status: "proposed",
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
  const steps = [
    { pending_id: "p0", plan_step: 0, status: "proposed", method: "POST", route: "/api/v1/goals", business: "pixiegirl", payload: { title: "Launch" } },
  ];
  repo.findPlan.mockImplementation(async () => ({ ...plan }));
  repo.listPlanSteps.mockImplementation(async () => steps);
  repo.setPlanStatus.mockImplementation(async ({ status, fields = {} }) => {
    Object.assign(plan, { status, ...fields });
    return { ...plan };
  });
  repo.setStepStatus.mockImplementation(async ({ id, status, fields = {} }) => {
    const s = steps.find((x) => x.pending_id === id);
    Object.assign(s, { status, ...fields });
    return s;
  });
  executor.executeAction.mockResolvedValue({ ok: true, http_status: 201, result: { data: { goal_id: "g-9" } } });

  const out = await planExec.confirmPlan({
    user: { user_id: "u1" },
    request_id: "r9",
    id: "plan-9",
    auth_header: "Bearer x",
  });

  expect(out.status).toBe("executed");
  const confirmCall = repo.setStepStatus.mock.calls.find(
    ([a]) => a.id === "p0" && a.status === "confirmed",
  );
  expect(confirmCall).toBeTruthy();
  expect(confirmCall[0].fields.confirmed_by_user_id).toBe("u1");
  expect(confirmCall[0].fields.confirmed_at).toBeTruthy();
});

test("duplicate-goal guard: a create_goal step matching a live goal fails with an actionable error", async () => {
  const steps = [
    { pending_id: "p0", plan_step: 0, status: "confirmed", action_key: "workspace.create_goal", method: "POST", route: "/api/v1/goals", business: "faitlynhair", payload: { title: "UK Popup Pilot" } },
    { pending_id: "p1", plan_step: 1, status: "confirmed", action_key: "workspace.add_milestone", method: "POST", route: "/api/v1/goals/:id/milestones", business: "faitlynhair", payload: { id: "{{step:0.goal_id}}", title: "M1" } },
  ];
  wireRepo(steps);
  goalsRepo.findActiveByTitle.mockResolvedValue({
    goal_id: "g-existing",
    title: "UK Popup Pilot",
    status: "active",
  });

  const out = await planExec.executePlan({ plan: { ...PLAN }, auth_header: "Bearer x" });

  expect(out.status).toBe("partially_failed");
  expect(executor.executeAction).not.toHaveBeenCalled(); // twin never minted
  expect(steps[0].status).toBe("failed");
  expect(steps[0].execution_error).toMatch(/already exists/i);
  expect(steps[0].execution_error).toMatch(/edit this step/i);
});

test("duplicate-goal guard: unique titles pass, and non-goal steps skip the lookup", async () => {
  const steps = [
    { pending_id: "p0", plan_step: 0, status: "confirmed", action_key: "workspace.create_goal", method: "POST", route: "/api/v1/goals", business: "faitlynhair", payload: { title: "Fresh goal" } },
    { pending_id: "p1", plan_step: 1, status: "confirmed", action_key: "workspace.create_task", method: "POST", route: "/api/v1/tasks", business: "faitlynhair", payload: { title: "T" } },
  ];
  wireRepo(steps);
  goalsRepo.findActiveByTitle.mockResolvedValue(null);
  executor.executeAction
    .mockResolvedValueOnce({ ok: true, result: { data: { goal_id: "g-1" } } })
    .mockResolvedValueOnce({ ok: true, result: { data: { task_id: "t-1" } } });

  const out = await planExec.executePlan({ plan: { ...PLAN }, auth_header: "Bearer x" });

  expect(out.status).toBe("executed");
  expect(goalsRepo.findActiveByTitle).toHaveBeenCalledTimes(1); // only the goal step
});

test("duplicate-goal guard fails open when the lookup itself throws", async () => {
  const steps = [
    { pending_id: "p0", plan_step: 0, status: "confirmed", action_key: "workspace.create_goal", method: "POST", route: "/api/v1/goals", business: "faitlynhair", payload: { title: "G" } },
  ];
  wireRepo(steps);
  goalsRepo.findActiveByTitle.mockRejectedValue(new Error("db down"));
  executor.executeAction.mockResolvedValueOnce({ ok: true, result: { data: { goal_id: "g-1" } } });

  const out = await planExec.executePlan({ plan: { ...PLAN }, auth_header: "Bearer x" });
  expect(out.status).toBe("executed"); // guard is best-effort, never blocks the run
});

test("resume skips already-executed steps and re-seeds their results", async () => {
  const steps = [
    { pending_id: "p0", plan_step: 0, status: "executed", method: "POST", route: "/api/v1/goals", business: "pixiegirl", payload: { title: "Launch" }, execution_result: { data: { goal_id: "g-1" } } },
    { pending_id: "p1", plan_step: 1, status: "confirmed", method: "POST", route: "/api/v1/goals/:id/milestones", business: "pixiegirl", payload: { id: "{{step:0.goal_id}}", title: "M1" } },
  ];
  wireRepo(steps);
  executor.executeAction.mockResolvedValueOnce({ ok: true, result: { data: { milestone_id: "m-1" } } });

  const out = await planExec.executePlan({ plan: { ...PLAN }, auth_header: "Bearer x" });

  expect(out.status).toBe("executed");
  expect(executor.executeAction).toHaveBeenCalledTimes(1); // only the unfinished step
  expect(executor.executeAction.mock.calls[0][0].pending.payload).toEqual({ id: "g-1", title: "M1" });
});
