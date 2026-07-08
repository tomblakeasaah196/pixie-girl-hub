"use strict";

/**
 * Orchestrator action-resolution loop (hallucination fixes PR 1):
 *
 *   • missingRouteParams — proposal-time detection of unfilled :params.
 *   • A catalogue action with missing route params is NOT materialised as a
 *     doomed pending card; the model gets a corrective tool-error round.
 *   • Read-safe actions (is_write=false, requires_confirmation=false) execute
 *     INLINE over loopback and the result is summarised — no confirm card.
 *   • Writes still go through the human gate, with a resolvable route.
 *
 * LLM, repo, governance, embeddings and executor are mocked — no DB/network.
 */

jest.mock("../../../src/config/env", () => ({
  config: {
    PRAXIS_LLM_VENDOR: "deepseek",
    PRAXIS_MAX_TOOLS: 40,
    PRAXIS_RAG_TOP_K: 0,
    PRAXIS_RAG_MIN_SCORE: 0.3,
  },
}));
jest.mock("../../../src/config/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

const mockRepo = {
  retrieveContext: jest.fn().mockResolvedValue([]),
  insertRunStep: jest.fn().mockResolvedValue({}),
  listMessages: jest.fn().mockResolvedValue([]),
  insertMessage: jest.fn(async ({ m }) => ({ message_id: "am-1", ...m })),
  touchConversation: jest.fn().mockResolvedValue(undefined),
  createPendingAction: jest.fn(async ({ p }) => ({ pending_id: "p-1", ...p })),
};
jest.mock("../../../src/modules/praxis_ai/praxis.repo", () => mockRepo);

const mockGovernance = {
  listActions: jest.fn(),
  recordUsage: jest.fn().mockResolvedValue(undefined),
};
jest.mock(
  "../../../src/modules/ai_governance/governance.service",
  () => mockGovernance,
);
jest.mock("../../../src/modules/ai_governance/model-catalogue.repo", () => ({
  resolveActiveModel: jest.fn(),
  computeCost: jest.fn(() => "0"),
}));

jest.mock("../../../src/services/embeddings.service", () => ({
  embed: jest.fn().mockResolvedValue(null), // RAG dormant in these tests
  isConfigured: jest.fn(() => false),
  model: jest.fn(() => "none"),
}));
const mockLlm = { resolveVendor: jest.fn(), chat: jest.fn() };
jest.mock("../../../src/services/llm.service", () => mockLlm);
jest.mock("../../../src/services/gemini.service", () => ({
  isConfigured: jest.fn(() => false),
  chatCompletion: jest.fn(),
}));

const mockExecutor = {
  executeAction: jest.fn(),
  resolveRoute: jest.fn(),
};
jest.mock("../../../src/modules/praxis_ai/praxis.executor", () => mockExecutor);

const orchestrator = require("../../../src/modules/praxis_ai/praxis.orchestrator");

const { missingRouteParams } = orchestrator;

describe("missingRouteParams", () => {
  test("reports unfilled :params", () => {
    expect(
      missingRouteParams("/api/v1/sales-campaigns/:id/praxis/analytics-qna", {
        question: "How did it go?",
      }),
    ).toEqual(["id"]);
  });

  test("empty string and null count as missing", () => {
    expect(missingRouteParams("/x/:id", { id: "" })).toEqual(["id"]);
    expect(missingRouteParams("/x/:id", { id: null })).toEqual(["id"]);
  });

  test("passes when every param is filled", () => {
    expect(missingRouteParams("/x/:id/y/:key", { id: "a", key: "b" })).toEqual(
      [],
    );
    expect(missingRouteParams("/x/no-params", {})).toEqual([]);
  });
});

// ── orchestrate: the action path ───────────────────────────

const VENDOR = {
  vendor: "deepseek",
  api_key: "k",
  endpoint_url: "https://api.deepseek.com",
  default_model: "deepseek-chat",
  cost_per_1k_input_tokens: "1",
  cost_per_1k_output_tokens: "2",
};

const QNA_ACTION = {
  action_id: "a-1",
  action_key: "sales_campaigns.analytics_qna",
  title: "Plain-English campaign analytics Q&A",
  method: "POST",
  route: "/api/v1/sales-campaigns/:id/praxis/analytics-qna",
  description: "Campaign analytics Q&A.",
  payload_schema: { type: "object", properties: {} },
  min_confidence: 0.7,
  is_write: false,
  requires_confirmation: false,
};

const toolCallMsg = (args, { content = "" } = {}) => ({
  content,
  tool_calls: [
    {
      id: "tc1",
      function: {
        name: "sales_campaigns_analytics_qna",
        arguments: JSON.stringify(args),
      },
    },
  ],
  usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
  model: "deepseek-chat",
});

const baseTurn = () => ({
  client: {},
  user: { user_id: "u-1", is_ceo: false, role_ids: ["r1"] },
  brand: "faitlynhair",
  conversation: { conversation_id: "conv-1", provider: null },
  userMsg: {
    message_id: "m-1",
    conversation_id: "conv-1",
    content: "How did our last campaign perform?",
  },
  authHeader: "Bearer tok",
  requestId: "req-1",
});

beforeEach(() => {
  jest.clearAllMocks();
  mockLlm.resolveVendor.mockResolvedValue(VENDOR);
  mockGovernance.listActions.mockResolvedValue([QNA_ACTION]);
});

describe("orchestrate — read-safe catalogue actions run inline", () => {
  test("executes over loopback and returns the summary, no pending card", async () => {
    mockLlm.chat
      .mockResolvedValueOnce(toolCallMsg({ id: "c-1", question: "How did it perform?" }))
      .mockResolvedValueOnce({
        content: "The flash sale made ₦2.1m from 34 orders.",
        tool_calls: [],
        usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 },
        model: "deepseek-chat",
      });
    mockExecutor.executeAction.mockResolvedValue({
      ok: true,
      http_status: 200,
      result: { answer: "₦2.1m from 34 orders" },
    });

    const r = await orchestrator.orchestrate(baseTurn());

    expect(mockExecutor.executeAction).toHaveBeenCalledWith(
      expect.objectContaining({
        authHeader: "Bearer tok",
        requestId: "req-1",
        pending: expect.objectContaining({
          method: "POST",
          route: QNA_ACTION.route,
          payload: { id: "c-1", question: "How did it perform?" },
          business: "faitlynhair",
        }),
      }),
    );
    expect(mockRepo.createPendingAction).not.toHaveBeenCalled();
    expect(r.pending_action).toBeNull();
    expect(r.assistant_message.content).toMatch(/2\.1m/);
  });

  test("without an auth header the action still goes to the confirm gate", async () => {
    mockLlm.chat.mockResolvedValueOnce(
      toolCallMsg({ id: "c-1", question: "How did it perform?" }),
    );
    const turn = { ...baseTurn(), authHeader: undefined };

    const r = await orchestrator.orchestrate(turn);

    expect(mockExecutor.executeAction).not.toHaveBeenCalled();
    expect(mockRepo.createPendingAction).toHaveBeenCalledTimes(1);
    expect(r.pending_action).toMatchObject({ pending_id: "p-1" });
  });
});

describe("orchestrate — proposal-time route validation", () => {
  test("missing :id triggers a corrective round; filled retry then executes", async () => {
    mockLlm.chat
      // Round 1: model forgets the campaign id.
      .mockResolvedValueOnce(toolCallMsg({ question: "How did it perform?" }))
      // Round 2 (after the tool-error feedback): id filled in.
      .mockResolvedValueOnce(toolCallMsg({ id: "c-9", question: "How did it perform?" }))
      // Summary of the inline execution.
      .mockResolvedValueOnce({
        content: "It brought in ₦900k.",
        tool_calls: [],
        usage: { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 },
        model: "deepseek-chat",
      });
    mockExecutor.executeAction.mockResolvedValue({
      ok: true,
      http_status: 200,
      result: { answer: "₦900k" },
    });

    const r = await orchestrator.orchestrate(baseTurn());

    // The corrective round passed the error back as a tool message.
    // (The convo array is shared across rounds, so search rather than index.)
    const retryCall = mockLlm.chat.mock.calls[1][0];
    const errorFeedback = retryCall.messages.find(
      (m) => m.role === "tool" && /missing/i.test(m.content),
    );
    expect(errorFeedback).toBeDefined();
    expect(errorFeedback.content).toMatch(/query_campaigns_recent/);

    expect(mockExecutor.executeAction).toHaveBeenCalledTimes(1);
    expect(
      mockExecutor.executeAction.mock.calls[0][0].pending.payload.id,
    ).toBe("c-9");
    expect(mockRepo.createPendingAction).not.toHaveBeenCalled();
    expect(r.assistant_message.content).toMatch(/900k/);
  });

  test("no doomed pending card is created when the model can't fill the param", async () => {
    mockLlm.chat
      .mockResolvedValueOnce(toolCallMsg({ question: "How did it perform?" }))
      // Retry: the model gives up and asks in text instead.
      .mockResolvedValueOnce({
        content: "Which campaign do you mean — the flash sale or the VIP drop?",
        tool_calls: [],
        usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 },
        model: "deepseek-chat",
      });

    const r = await orchestrator.orchestrate(baseTurn());

    expect(mockRepo.createPendingAction).not.toHaveBeenCalled();
    expect(mockExecutor.executeAction).not.toHaveBeenCalled();
    expect(r.pending_action).toBeNull();
    expect(r.assistant_message.content).toMatch(/which campaign/i);
  });
});

describe("orchestrate — writes keep the human gate", () => {
  test("a confirmation-required action with a resolvable route becomes a pending card", async () => {
    mockGovernance.listActions.mockResolvedValue([
      { ...QNA_ACTION, requires_confirmation: true },
    ]);
    mockLlm.chat.mockResolvedValueOnce(
      toolCallMsg({ id: "c-2", question: "Summarise performance" }),
    );

    const r = await orchestrator.orchestrate(baseTurn());

    expect(mockExecutor.executeAction).not.toHaveBeenCalled();
    expect(mockRepo.createPendingAction).toHaveBeenCalledTimes(1);
    const p = mockRepo.createPendingAction.mock.calls[0][0].p;
    expect(p.payload).toEqual({ id: "c-2", question: "Summarise performance" });
    expect(p.confidence).toBe(0.7);
    expect(r.pending_action).toMatchObject({ pending_id: "p-1" });
    expect(r.assistant_message.content).toMatch(/confirm it to run/);
  });
});
