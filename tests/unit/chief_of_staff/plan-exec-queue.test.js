"use strict";

/**
 * PR3 end-to-end seam (queue mocked, no Redis/DB/HTTP): confirmPlan enqueues a
 * cos-plan-exec job carrying a REAL minted service token → the worker
 * processor executes the plan's steps as that token → the plan.executed event
 * reaches the user's Socket.io room via the realtime relay. This is the
 * "approve → 202 → worker runs → card flips over realtime" contract.
 */

jest.mock("../../../src/config/env", () => ({
  config: { JWT_SECRET: "test-secret-test-secret-test-secret!" },
  validateEnv: () => {},
}));
jest.mock("../../../src/modules/chief_of_staff/cos.repo");
jest.mock("../../../src/modules/praxis_ai/praxis.executor", () => ({
  executeAction: jest.fn(),
}));
jest.mock("../../../src/shared/goals/goals.repo", () => ({
  findActiveByTitle: jest.fn(),
}));
jest.mock("../../../src/modules/ai_governance/governance.service", () => ({
  canUseFeature: jest.fn(async () => ({ ok: false })), // run without self-repair
  listActions: jest.fn(async () => []),
}));
jest.mock("../../../src/shared/cache/identity-cache", () => ({
  getAuthUser: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/config/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../../src/jobs/queue-producer", () => ({ enqueue: jest.fn() }));
// Broadcaster: capture room + event instead of touching Socket.io/Redis.
const emitted = [];
jest.mock("../../../src/realtime/emitter", () => ({
  getBroadcaster: () => ({
    to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }),
  }),
}));

const jwt = require("jsonwebtoken");
const repo = require("../../../src/modules/chief_of_staff/cos.repo");
const executor = require("../../../src/modules/praxis_ai/praxis.executor");
const identityCache = require("../../../src/shared/cache/identity-cache");
const { enqueue } = require("../../../src/jobs/queue-producer");
const planExec = require("../../../src/modules/chief_of_staff/cos.plan-executor");
const processCosPlanExec = require("../../../src/jobs/processors/cos-plan-exec-processor");
const { registerCosRealtime } = require("../../../src/realtime/cos-realtime");

registerCosRealtime();

beforeEach(() => {
  jest.clearAllMocks();
  emitted.length = 0;
  identityCache.getAuthUser.mockResolvedValue({
    user_id: "ceo-1",
    status: "active",
    is_ceo: true,
  });
});

function wirePlan(plan, steps) {
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
}

test("confirm → enqueue → processor executes as the service token → broadcast", async () => {
  const plan = {
    plan_id: "plan-1",
    conversation_id: "conv-1",
    proposed_by_user_id: "ceo-1",
    business: "pixiegirl",
    status: "proposed",
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
  const steps = [
    { pending_id: "p0", plan_step: 0, status: "proposed", method: "POST", route: "/api/v1/goals", business: "pixiegirl", payload: { title: "Launch" } },
    { pending_id: "p1", plan_step: 1, status: "proposed", method: "POST", route: "/api/v1/goals/:id/milestones", business: "pixiegirl", payload: { id: "{{step:0.goal_id}}", title: "M1" } },
  ];
  wirePlan(plan, steps);

  // 1) Confirm: returns immediately as 'executing' with the job enqueued.
  const confirmed = await planExec.confirmPlan({
    user: { user_id: "ceo-1" },
    request_id: "r1",
    id: "plan-1",
  });
  expect(confirmed.status).toBe("executing");
  expect(executor.executeAction).not.toHaveBeenCalled();
  expect(enqueue).toHaveBeenCalledTimes(1);

  const [queue, jobName, jobData, opts] = enqueue.mock.calls[0];
  expect(queue).toBe("cos-plan-exec");
  expect(jobName).toBe("execute");
  expect(opts).toEqual({ attempts: 3 });

  // The job carries a real, scoped service token for the confirming user.
  const claims = jwt.verify(jobData.service_token, "test-secret-test-secret-test-secret!");
  expect(claims).toMatchObject({ sub: "ceo-1", typ: "cos_plan_exec", plan_id: "plan-1", brand: "pixiegirl" });

  // 2) Worker: the processor runs the steps over loopback AS that token.
  executor.executeAction
    .mockResolvedValueOnce({ ok: true, http_status: 201, result: { data: { goal_id: "g-1" } } })
    .mockResolvedValueOnce({ ok: true, http_status: 201, result: { data: { milestone_id: "m-1" } } });

  const jobResult = await processCosPlanExec({ data: jobData });

  expect(jobResult).toEqual({ plan_id: "plan-1", status: "executed" });
  expect(executor.executeAction).toHaveBeenCalledTimes(2);
  for (const [args] of executor.executeAction.mock.calls) {
    expect(args.authHeader).toBe(`Bearer ${jobData.service_token}`);
    expect(args.requestId).toBe("r1");
  }
  // Cross-step token resolved inside the worker run too.
  expect(executor.executeAction.mock.calls[1][0].pending.payload).toEqual({ id: "g-1", title: "M1" });
  expect(plan.status).toBe("executed");

  // 3) Completion push: plan.executed reached the user's goals room, carrying
  // conversation_id so the client can refetch exactly the waiting card.
  expect(emitted).toContainEqual({
    room: "user:ceo-1:goals",
    event: "cos_plan:executed",
    payload: {
      plan_id: "plan-1",
      conversation_id: "conv-1",
      user_id: "ceo-1",
      status: "executed",
    },
  });
});

test("processor skips a plan that is no longer runnable (stalled retry after finish)", async () => {
  const plan = { plan_id: "plan-2", proposed_by_user_id: "ceo-1", business: "pixiegirl", status: "executed" };
  wirePlan(plan, []);

  const out = await processCosPlanExec({
    data: { plan_id: "plan-2", user_id: "ceo-1", service_token: "t", request_id: "r2" },
  });

  expect(out).toEqual({ plan_id: "plan-2", skipped: true });
  expect(executor.executeAction).not.toHaveBeenCalled();
  expect(emitted).toEqual([]);
});

test("a step failure completes the job as partially_failed — no throw, no BullMQ retry", async () => {
  const plan = { plan_id: "plan-3", proposed_by_user_id: "ceo-1", business: "pixiegirl", status: "executing" };
  const steps = [
    { pending_id: "p0", plan_step: 0, status: "confirmed", method: "POST", route: "/api/v1/tasks", business: "pixiegirl", payload: { title: "T" } },
  ];
  wirePlan(plan, steps);
  executor.executeAction.mockResolvedValueOnce({ ok: false, http_status: 422, result: { error: { message: "bad" } } });

  const out = await processCosPlanExec({
    data: { plan_id: "plan-3", user_id: "ceo-1", service_token: "t", request_id: "r3" },
  });

  expect(out).toEqual({ plan_id: "plan-3", status: "partially_failed" });
  expect(emitted).toContainEqual(
    expect.objectContaining({ event: "cos_plan:executed", payload: expect.objectContaining({ status: "partially_failed" }) }),
  );
});

test("worker-crash resume: attempt 2 skips executed steps and finishes the rest", async () => {
  const plan = { plan_id: "plan-4", proposed_by_user_id: "ceo-1", business: "pixiegirl", status: "executing" };
  const steps = [
    { pending_id: "p0", plan_step: 0, status: "executed", method: "POST", route: "/api/v1/goals", business: "pixiegirl", payload: { title: "Launch" }, execution_result: { data: { goal_id: "g-1" } } },
    { pending_id: "p1", plan_step: 1, status: "confirmed", method: "POST", route: "/api/v1/goals/:id/milestones", business: "pixiegirl", payload: { id: "{{step:0.goal_id}}", title: "M1" } },
  ];
  wirePlan(plan, steps);
  executor.executeAction.mockResolvedValueOnce({ ok: true, http_status: 201, result: { data: { milestone_id: "m-1" } } });

  const out = await processCosPlanExec({
    data: { plan_id: "plan-4", user_id: "ceo-1", service_token: "t", request_id: "r4" },
  });

  expect(out).toEqual({ plan_id: "plan-4", status: "executed" });
  // Only the unfinished step ran; the executed one re-seeded its token result.
  expect(executor.executeAction).toHaveBeenCalledTimes(1);
  expect(executor.executeAction.mock.calls[0][0].pending.payload).toEqual({ id: "g-1", title: "M1" });
});
