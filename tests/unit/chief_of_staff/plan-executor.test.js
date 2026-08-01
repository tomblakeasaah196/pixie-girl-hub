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
// confirmPlan hands execution to the cos-plan-exec queue (PR3): mock the
// producer + token mint so no Redis/env is touched.
jest.mock("../../../src/jobs/queue-producer", () => ({ enqueue: jest.fn() }));
jest.mock("../../../src/shared/hr_payroll/service-tokens", () => ({
  mintCosPlanExecToken: jest.fn(() => "svc-token"),
}));
jest.mock("../../../src/shared/cache/identity-cache", () => ({
  getAuthUser: jest.fn(),
}));

const repo = require("../../../src/modules/chief_of_staff/cos.repo");
const { enqueue } = require("../../../src/jobs/queue-producer");
const { mintCosPlanExecToken } = require("../../../src/shared/hr_payroll/service-tokens");
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

test("a failed step skips only its dependents, not the whole run", async () => {
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
  // The dependent is explicitly marked skipped (not silently left queued) with
  // an actionable reason pointing at the step it needed.
  expect(steps[1].status).toBe("failed");
  expect(steps[1].execution_error).toMatch(/skipped/i);
});

test("independent steps still run after an unrelated step fails", async () => {
  const steps = [
    { pending_id: "p0", plan_step: 0, status: "confirmed", method: "POST", route: "/api/v1/goals", business: "pixiegirl", payload: { title: "Launch" } },
    // No token → independent of step 0; must still run.
    { pending_id: "p1", plan_step: 1, status: "confirmed", method: "POST", route: "/api/v1/tasks", business: "pixiegirl", payload: { title: "Standalone task" } },
  ];
  wireRepo(steps);
  executor.executeAction
    .mockResolvedValueOnce({ ok: false, http_status: 422, result: { error: { message: "bad" } } })
    .mockResolvedValueOnce({ ok: true, http_status: 201, result: { data: { task_id: "t-1" } } });

  const out = await planExec.executePlan({ plan: { ...PLAN }, auth_header: "Bearer x" });

  expect(out.status).toBe("partially_failed");
  expect(executor.executeAction).toHaveBeenCalledTimes(2); // both attempted
  expect(steps[0].status).toBe("failed");
  expect(steps[1].status).toBe("executed"); // independent work survived
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
  expect(steps[0].execution_error).toMatch(/referenced value|can't run yet/i);
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

  const out = await planExec.confirmPlan({
    user: { user_id: "u1" },
    request_id: "r9",
    id: "plan-9",
  });

  // Execution moved to the worker: confirm returns 'executing' and no step
  // runs inline.
  expect(out.status).toBe("executing");
  expect(executor.executeAction).not.toHaveBeenCalled();
  const confirmCall = repo.setStepStatus.mock.calls.find(
    ([a]) => a.id === "p0" && a.status === "confirmed",
  );
  expect(confirmCall).toBeTruthy();
  expect(confirmCall[0].fields.confirmed_by_user_id).toBe("u1");
  expect(confirmCall[0].fields.confirmed_at).toBeTruthy();
});

test("confirmPlan mints a scoped service token and enqueues the execution job", async () => {
  const plan = {
    plan_id: "plan-10",
    proposed_by_user_id: "u1",
    business: "faitlynhair",
    status: "proposed",
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
  repo.findPlan.mockImplementation(async () => ({ ...plan }));
  repo.listPlanSteps.mockResolvedValue([]);
  repo.setPlanStatus.mockImplementation(async ({ status, fields = {} }) => {
    Object.assign(plan, { status, ...fields });
    return { ...plan };
  });

  const out = await planExec.confirmPlan({
    user: { user_id: "u1" },
    request_id: "r10",
    id: "plan-10",
  });

  expect(mintCosPlanExecToken).toHaveBeenCalledWith({
    user_id: "u1",
    plan_id: "plan-10",
    brand: "faitlynhair",
  });
  expect(enqueue).toHaveBeenCalledWith(
    "cos-plan-exec",
    "execute",
    {
      plan_id: "plan-10",
      brand: "faitlynhair",
      user_id: "u1",
      service_token: "svc-token",
      request_id: "r10",
    },
    { attempts: 3 },
  );
  expect(out.status).toBe("executing");
  expect(out.steps).toEqual([]);
});

test("confirmPlan on a partially_failed plan re-enqueues (Retry remaining)", async () => {
  const plan = { plan_id: "plan-11", proposed_by_user_id: "u1", business: "pixiegirl", status: "partially_failed" };
  repo.findPlan.mockImplementation(async () => ({ ...plan }));
  repo.listPlanSteps.mockResolvedValue([]);
  repo.setPlanStatus.mockImplementation(async ({ status }) => {
    plan.status = status;
    return { ...plan };
  });

  const out = await planExec.confirmPlan({ user: { user_id: "u1" }, id: "plan-11" });

  expect(enqueue).toHaveBeenCalledTimes(1);
  expect(out.status).toBe("executing");
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

test("self-repair: a validation failure is retried once with a corrected payload", async () => {
  const steps = [
    { pending_id: "p0", plan_step: 0, status: "confirmed", action_key: "workspace.create_task", method: "POST", route: "/api/v1/tasks", business: "pixiegirl", payload: { title: "T", priority: "sometime" } },
  ];
  wireRepo(steps);
  // First attempt 422s; the repaired attempt succeeds.
  executor.executeAction
    .mockResolvedValueOnce({ ok: false, http_status: 422, result: { error: { code: "VALIDATION_ERROR", fields: { priority: ["bad"] } } } })
    .mockResolvedValueOnce({ ok: true, http_status: 201, result: { data: { task_id: "t-1" } } });
  const repair = jest.fn().mockResolvedValue({ title: "T", priority: "high" });
  const actionByKey = new Map([["workspace.create_task", { action_key: "workspace.create_task", payload_schema: {} }]]);

  const out = await planExec.executePlan({ plan: { ...PLAN }, auth_header: "Bearer x", repair, actionByKey });

  expect(out.status).toBe("executed");
  expect(repair).toHaveBeenCalledTimes(1);
  expect(executor.executeAction).toHaveBeenCalledTimes(2); // original + repaired
  expect(executor.executeAction.mock.calls[1][0].pending.payload).toEqual({ title: "T", priority: "high" });
  expect(steps[0].status).toBe("executed");
  expect(steps[0].payload).toEqual({ title: "T", priority: "high" }); // repaired payload persisted
});

test("self-repair is skipped for a non-validation (500) failure", async () => {
  const steps = [
    { pending_id: "p0", plan_step: 0, status: "confirmed", action_key: "workspace.create_task", method: "POST", route: "/api/v1/tasks", business: "pixiegirl", payload: { title: "T" } },
  ];
  wireRepo(steps);
  executor.executeAction.mockResolvedValueOnce({ ok: false, http_status: 500, result: { error: {} } });
  const repair = jest.fn();

  const out = await planExec.executePlan({ plan: { ...PLAN }, auth_header: "Bearer x", repair, actionByKey: new Map() });

  expect(out.status).toBe("partially_failed");
  expect(repair).not.toHaveBeenCalled();
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
