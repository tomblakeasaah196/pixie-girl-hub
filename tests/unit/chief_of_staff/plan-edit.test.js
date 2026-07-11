"use strict";

/**
 * Chief of Staff plan continuation + step editing (cos.service.js) —
 * continuePlan appends the owed steps to the SAME plan (no new plan, no
 * duplicates) and updatePlanStep lets the CEO adjust a payload before firing
 * (or after a failure). Heavy deps are mocked: no DB, no LLM, no HTTP.
 */

jest.mock("../../../src/config/database", () => ({
  query: jest.fn(),
  ex: jest.fn(() => jest.fn()),
  transaction: jest.fn((fn) => fn({})),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/services/transcription.service", () => ({ transcribe: jest.fn() }));
jest.mock("../../../src/services/llm-router", () => ({ chatWithFailover: jest.fn() }));
jest.mock("../../../src/config/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));
jest.mock("../../../src/modules/ai_governance/governance.service", () => ({
  listActions: jest.fn(),
  canUseFeature: jest.fn(),
  recordUsage: jest.fn(),
}));
jest.mock("../../../src/modules/ai_governance/model-catalogue.repo", () => ({
  resolveActiveModel: jest.fn().mockResolvedValue(null),
  computeCost: jest.fn(),
}));
jest.mock("../../../src/modules/praxis_ai/praxis.repo", () => ({
  findConversation: jest.fn(),
  listMessages: jest.fn(),
  insertMessage: jest.fn(),
  touchConversation: jest.fn(),
  listConversations: jest.fn(),
  createConversation: jest.fn(),
  archiveConversation: jest.fn(),
}));
jest.mock("../../../src/modules/chief_of_staff/cos.repo");
jest.mock("../../../src/modules/chief_of_staff/cos.plan-executor", () => ({
  confirmPlan: jest.fn(),
  rejectPlan: jest.fn(),
  executePlan: jest.fn(),
}));
jest.mock("../../../src/modules/chief_of_staff/cos.settings.repo", () => ({
  get: jest.fn().mockResolvedValue(null),
}));
jest.mock("../../../src/modules/chief_of_staff/cos.memory", () => ({
  retrieve: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../../src/shared/goals/goals.repo", () => ({
  listGoals: jest.fn().mockResolvedValue({ data: [] }),
  findActiveByTitle: jest.fn(),
}));
jest.mock("../../../src/shared/goals/notes.repo", () => ({
  findNoteByCosConversation: jest.fn(),
  upsertCosNote: jest.fn(),
}));

const cosRepo = require("../../../src/modules/chief_of_staff/cos.repo");
const praxisRepo = require("../../../src/modules/praxis_ai/praxis.repo");
const governance = require("../../../src/modules/ai_governance/governance.service");
const llmRouter = require("../../../src/services/llm-router");
const service = require("../../../src/modules/chief_of_staff/cos.service");

const USER = { user_id: "u1", is_ceo: true };
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

const TASK_ACTION = {
  action_id: "a-task",
  action_key: "workspace.create_task",
  title: "Create a task",
  method: "POST",
  route: "/api/v1/tasks",
  surface: "workspace",
  min_confidence: 0.7,
  payload_schema: { type: "object", properties: { title: { type: "string" } } },
};
const GOAL_ACTION = {
  action_id: "a-goal",
  action_key: "workspace.create_goal",
  title: "Create a goal",
  method: "POST",
  route: "/api/v1/goals",
  surface: "workspace",
  min_confidence: 0.7,
  payload_schema: { type: "object", properties: { title: { type: "string" } } },
};

beforeEach(() => jest.clearAllMocks());

describe("continuePlan", () => {
  const PLAN = {
    plan_id: "pl1",
    conversation_id: "c1",
    proposed_by_user_id: "u1",
    business: "faitlynhair",
    title: "UK Popup Pilot",
    status: "proposed",
    is_complete: false,
    expires_at: FUTURE,
  };
  const EXISTING = [
    {
      pending_id: "p0",
      plan_step: 0,
      status: "proposed",
      action_key: "workspace.create_goal",
      human_summary: "Create a goal “G”",
    },
  ];

  test("appends the owed steps to the SAME plan, numbering after the existing ones", async () => {
    cosRepo.findPlan.mockResolvedValue({ ...PLAN });
    cosRepo.listPlanSteps
      .mockResolvedValueOnce(EXISTING) // before the build
      .mockResolvedValue([...EXISTING, { pending_id: "p1", plan_step: 1, status: "proposed" }]);
    cosRepo.createPlanStep.mockImplementation(async ({ s }) => ({ ...s, pending_id: "p1" }));
    cosRepo.setPlanBuildState.mockResolvedValue({ ...PLAN, is_complete: true });
    governance.canUseFeature.mockResolvedValue({ ok: true });
    governance.listActions.mockResolvedValue([TASK_ACTION, GOAL_ACTION]);
    praxisRepo.findConversation.mockResolvedValue({
      conversation_id: "c1",
      user_id: "u1",
      kind: "chief_of_staff",
    });
    praxisRepo.listMessages.mockResolvedValue([]);
    llmRouter.chatWithFailover.mockResolvedValue({
      content: "",
      tool_calls: [
        {
          id: "x",
          type: "function",
          function: { name: "workspace_create_task", arguments: '{"title":"T"}' },
        },
      ],
      finish_reason: "stop",
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      vendor: "deepseek",
      model: "m",
    });

    const out = await service.continuePlan({ user: USER, brand: "faitlynhair", request_id: "r", id: "pl1" });

    expect(cosRepo.createPlanStep).toHaveBeenCalledTimes(1);
    expect(cosRepo.createPlanStep.mock.calls[0][0].s.plan_step).toBe(1); // appended, not renumbered
    expect(cosRepo.createPlanStep.mock.calls[0][0].s.plan_id).toBe("pl1"); // SAME plan — no duplicate
    expect(cosRepo.setPlanBuildState).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pl1", is_complete: true }),
    );
    expect(out.steps).toHaveLength(2);
    // The build prompt tells the model what is already queued.
    const msgs = llmRouter.chatWithFailover.mock.calls[0][0].messages;
    expect(msgs.at(-1).content).toContain("0. Create a goal “G”");
    expect(msgs.at(-1).content).toContain("continuing from step 1");
  });

  test("an already-complete plan returns as-is without an LLM call", async () => {
    cosRepo.findPlan.mockResolvedValue({ ...PLAN, is_complete: true });
    cosRepo.listPlanSteps.mockResolvedValue(EXISTING);

    const out = await service.continuePlan({ user: USER, brand: "faitlynhair", request_id: "r", id: "pl1" });

    expect(llmRouter.chatWithFailover).not.toHaveBeenCalled();
    expect(out.steps).toEqual(EXISTING);
  });

  test("only a proposed plan can keep building", async () => {
    cosRepo.findPlan.mockResolvedValue({ ...PLAN, status: "executed" });
    await expect(
      service.continuePlan({ user: USER, brand: "faitlynhair", request_id: "r", id: "pl1" }),
    ).rejects.toMatchObject({ code: "BAD_STATE" });
  });

  test("another user's plan is invisible (404)", async () => {
    cosRepo.findPlan.mockResolvedValue({ ...PLAN, proposed_by_user_id: "someone-else" });
    await expect(
      service.continuePlan({ user: USER, brand: "faitlynhair", request_id: "r", id: "pl1" }),
    ).rejects.toMatchObject({ http_status: 404 });
  });
});

describe("updatePlanStep", () => {
  const PLAN = {
    plan_id: "pl1",
    conversation_id: "c1",
    proposed_by_user_id: "u1",
    business: "faitlynhair",
    title: "UK Popup Pilot",
    status: "proposed",
    is_complete: true,
    expires_at: FUTURE,
  };
  const STEP = {
    pending_id: "p0",
    plan_step: 0,
    status: "proposed",
    action_key: "workspace.create_goal",
    payload: { title: "Old title" },
  };

  test("replaces the payload and regenerates the step summary", async () => {
    cosRepo.findPlan.mockResolvedValue({ ...PLAN });
    cosRepo.listPlanSteps
      .mockResolvedValueOnce([STEP])
      .mockResolvedValue([{ ...STEP, payload: { title: "New title" } }]);
    cosRepo.updateStepPayload.mockResolvedValue({ ...STEP, payload: { title: "New title" } });
    governance.listActions.mockResolvedValue([GOAL_ACTION]);

    const out = await service.updatePlanStep({
      user: USER,
      request_id: "r",
      planId: "pl1",
      stepId: "p0",
      payload: { title: "New title" },
    });

    const call = cosRepo.updateStepPayload.mock.calls[0][0];
    expect(call.payload).toEqual({ title: "New title" });
    expect(call.human_summary).toContain("Create a goal");
    expect(call.human_summary).toContain("New title");
    expect(out.steps[0].payload).toEqual({ title: "New title" });
  });

  test("steps of an executing/executed plan are immutable", async () => {
    cosRepo.findPlan.mockResolvedValue({ ...PLAN, status: "executed" });
    await expect(
      service.updatePlanStep({
        user: USER,
        request_id: "r",
        planId: "pl1",
        stepId: "p0",
        payload: { title: "X" },
      }),
    ).rejects.toMatchObject({ code: "BAD_STATE" });
  });

  test("a partially_failed plan allows fixing the failed step (edit → retry)", async () => {
    cosRepo.findPlan.mockResolvedValue({ ...PLAN, status: "partially_failed" });
    cosRepo.listPlanSteps
      .mockResolvedValueOnce([{ ...STEP, status: "failed" }])
      .mockResolvedValue([{ ...STEP, status: "confirmed", payload: { title: "Renamed" } }]);
    cosRepo.updateStepPayload.mockResolvedValue({ ...STEP, status: "confirmed" });
    governance.listActions.mockResolvedValue([GOAL_ACTION]);

    const out = await service.updatePlanStep({
      user: USER,
      request_id: "r",
      planId: "pl1",
      stepId: "p0",
      payload: { title: "Renamed" },
    });
    expect(cosRepo.updateStepPayload).toHaveBeenCalled();
    expect(out.steps[0].payload).toEqual({ title: "Renamed" });
  });

  test("a step that already ran cannot be edited (repo refuses → 422)", async () => {
    cosRepo.findPlan.mockResolvedValue({ ...PLAN });
    cosRepo.listPlanSteps.mockResolvedValue([STEP]);
    cosRepo.updateStepPayload.mockResolvedValue(null);
    governance.listActions.mockResolvedValue([GOAL_ACTION]);

    await expect(
      service.updatePlanStep({
        user: USER,
        request_id: "r",
        planId: "pl1",
        stepId: "p0",
        payload: { title: "X" },
      }),
    ).rejects.toMatchObject({ code: "BAD_STATE" });
  });
});
