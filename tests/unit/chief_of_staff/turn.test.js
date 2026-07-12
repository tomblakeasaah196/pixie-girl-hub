"use strict";

/**
 * The CoS chat turn end-to-end (cos.service.postMessage/runTurn) — the
 * transaction split (user message survives an LLM failure), stub-history
 * exclusion + the back-online pickup note, immediate read execution over the
 * loopback executor, and plan anchoring. Real planner/plan-rounds/persona;
 * DB, LLM, executor and governance are mocked.
 */

const mockTxn = jest.fn((fn) => fn({}));
jest.mock("../../../src/config/database", () => ({
  query: jest.fn(),
  ex: jest.fn(() => jest.fn()),
  transaction: (fn) => mockTxn(fn),
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
jest.mock("../../../src/modules/praxis_ai/praxis.executor", () => ({
  executeAction: jest.fn(),
}));
jest.mock("../../../src/modules/chief_of_staff/cos.repo", () => ({
  createPlan: jest.fn(),
  createPlanStep: jest.fn(),
  supersedeOtherProposedPlans: jest.fn(),
  setPlanAnchor: jest.fn(),
  findPlan: jest.fn(),
  listPlanSteps: jest.fn(),
  listPlansForConversation: jest.fn(),
  setPlanStatus: jest.fn(),
  setPlanBuildState: jest.fn(),
  setStepStatus: jest.fn(),
  updateStepPayload: jest.fn(),
}));
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
const praxisExecutor = require("../../../src/modules/praxis_ai/praxis.executor");
const governance = require("../../../src/modules/ai_governance/governance.service");
const llmRouter = require("../../../src/services/llm-router");
const service = require("../../../src/modules/chief_of_staff/cos.service");

const USER = { user_id: "u1", is_ceo: true };
const CONV = { conversation_id: "c1", user_id: "u1", kind: "chief_of_staff" };
const STUB_TEXT =
  "Your Chief of Staff is switched off. Turn it on in AI Control → Feature Flags (enable “Chief of Staff”) and I'll start planning with you — no redeploy needed.";

const GOAL_ACTION = {
  action_id: "a-goal",
  action_key: "workspace.create_goal",
  title: "Create a goal",
  method: "POST",
  route: "/api/v1/goals",
  surface: "workspace",
  is_write: true,
  min_confidence: 0.7,
  payload_schema: { type: "object", properties: { title: { type: "string" } } },
};
const LIST_GOALS_ACTION = {
  action_id: "a-list",
  action_key: "workspace.list_goals",
  title: "List goals",
  method: "GET",
  route: "/api/v1/goals",
  surface: "workspace",
  is_write: false,
  min_confidence: 0.7,
  payload_schema: { type: "object", properties: { status: { type: "string" } } },
};

const okCompletion = (over = {}) => ({
  content: "",
  tool_calls: [],
  finish_reason: "stop",
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  vendor: "deepseek",
  model: "m",
  ...over,
});

function baseWiring({ prior = [] } = {}) {
  praxisRepo.findConversation.mockResolvedValue({ ...CONV });
  praxisRepo.listMessages.mockResolvedValue(prior);
  let msgSeq = 0;
  praxisRepo.insertMessage.mockImplementation(async ({ m }) => ({
    ...m,
    message_id: `msg-${++msgSeq}`,
  }));
  governance.canUseFeature.mockResolvedValue({ ok: true });
  governance.listActions.mockResolvedValue([GOAL_ACTION, LIST_GOALS_ACTION]);
  cosRepo.createPlan.mockImplementation(async ({ p }) => ({ ...p, plan_id: "pl-1", status: "proposed" }));
  cosRepo.createPlanStep.mockImplementation(async ({ s }) => ({ ...s, pending_id: `pd-${s.plan_step}` }));
  cosRepo.supersedeOtherProposedPlans.mockResolvedValue([]);
  cosRepo.setPlanAnchor.mockImplementation(async ({ id, message_id }) => ({
    plan_id: id,
    anchor_message_id: message_id,
    status: "proposed",
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTxn.mockClear();
  mockTxn.mockImplementation((fn) => fn({}));
});

test("transaction split: the user message commits before the LLM runs and survives its failure", async () => {
  baseWiring();
  llmRouter.chatWithFailover.mockRejectedValue(new Error("all vendors down"));

  const out = await service.postMessage({
    user: USER,
    brand: "faitlynhair",
    request_id: "r1",
    id: "c1",
    input: { content: "hello" },
    auth_header: "Bearer x",
  });

  // Two separate short transactions: user message, then the stub reply.
  expect(mockTxn).toHaveBeenCalledTimes(2);
  expect(praxisRepo.insertMessage).toHaveBeenCalledTimes(2);
  expect(out.user_message.role).toBe("user");
  expect(out.assistant_message.content).toMatch(/no AI vendor|switched off/);
  expect(out.plan).toBeNull();
});

test("stub replies are excluded from model history and trigger the back-online pickup note", async () => {
  const prior = [
    { message_id: "m1", role: "user", content: "Big London brief…" },
    { message_id: "m2", role: "assistant", content: STUB_TEXT },
  ];
  baseWiring({ prior });
  llmRouter.chatWithFailover.mockResolvedValue(okCompletion({ content: "Picking it up now." }));

  await service.postMessage({
    user: USER,
    brand: "faitlynhair",
    request_id: "r1",
    id: "c1",
    input: { content: "are you on now?" },
    auth_header: "Bearer x",
  });

  const msgs = llmRouter.chatWithFailover.mock.calls[0][0].messages;
  // The stub text never reaches the model as something "it said"…
  expect(msgs.some((m) => m.role === "assistant" && m.content.startsWith("Your Chief of Staff"))).toBe(false);
  // …but the CEO's unanswered brief does, plus the pickup note.
  expect(msgs.some((m) => m.role === "user" && m.content.includes("Big London brief"))).toBe(true);
  expect(msgs.some((m) => m.role === "system" && /offline.*automatic stubs/i.test(m.content))).toBe(true);
});

test("read tools execute immediately via the loopback executor; only writes become plan steps; the plan anchors to the reply", async () => {
  baseWiring();
  praxisExecutor.executeAction.mockResolvedValue({
    ok: true,
    http_status: 200,
    result: { data: [{ goal_id: "g-old", title: "Existing goal" }] },
  });
  llmRouter.chatWithFailover
    .mockResolvedValueOnce(
      okCompletion({
        content: "Checking your goals first.",
        tool_calls: [
          { id: "r1", type: "function", function: { name: "workspace_list_goals", arguments: '{"status":"active"}' } },
        ],
      }),
    )
    .mockResolvedValueOnce(
      okCompletion({
        tool_calls: [
          { id: "w1", type: "function", function: { name: "workspace_create_goal", arguments: '{"title":"Fresh goal"}' } },
        ],
      }),
    );

  const out = await service.postMessage({
    user: USER,
    brand: "faitlynhair",
    request_id: "r1",
    id: "c1",
    input: { content: "set up the popup goal" },
    auth_header: "Bearer x",
  });

  // The read ran now, as the CEO, over loopback (GET + query payload).
  expect(praxisExecutor.executeAction).toHaveBeenCalledTimes(1);
  const readCall = praxisExecutor.executeAction.mock.calls[0][0];
  expect(readCall.pending.method).toBe("GET");
  expect(readCall.pending.route).toBe("/api/v1/goals");
  expect(readCall.authHeader).toBe("Bearer x");
  // Only the WRITE became a plan step.
  expect(cosRepo.createPlanStep).toHaveBeenCalledTimes(1);
  expect(cosRepo.createPlanStep.mock.calls[0][0].s.action_key).toBe("workspace.create_goal");
  // The plan is anchored under the assistant reply that proposed it.
  expect(cosRepo.setPlanAnchor).toHaveBeenCalledWith(
    expect.objectContaining({ id: "pl-1", message_id: out.assistant_message.message_id }),
  );
  expect(out.plan.anchor_message_id).toBe(out.assistant_message.message_id);
});
