"use strict";

/**
 * Praxis Query Agent unit tests (§8.2). Verifies the safety contract without
 * infra: read tools are exposed with a stable prefix, queries are gated on the
 * caller's `view` permission (CEO bypasses), and a permitted query runs the
 * catalogue entry + summarises. The LLM, permissions repo, and catalogue are
 * mocked — no DB, no network.
 *
 * Names referenced inside a jest.mock() factory MUST be prefixed `mock` (jest
 * hoists the factory above the file, so it can't see normal outer variables).
 */

const mockEntry = {
  key: "test_q",
  title: "Test query",
  description: "A test query.",
  module: "dashboards",
  parameters: { type: "object", properties: {} },
  run: jest.fn(),
};

jest.mock("../../../src/modules/praxis_ai/query-catalogue", () => ({
  list: () => [mockEntry],
  get: (k) => (k === "test_q" ? mockEntry : null),
}));

const mockLlm = { chat: jest.fn() };
jest.mock("../../../src/services/llm.service", () => mockLlm);

const mockGemini = { isConfigured: jest.fn(), chatCompletion: jest.fn() };
jest.mock("../../../src/services/gemini.service", () => mockGemini);

const mockExecutor = { executeAction: jest.fn() };
jest.mock("../../../src/modules/praxis_ai/praxis.executor", () => mockExecutor);

const mockPermissionsRepo = { findGrants: jest.fn() };
jest.mock(
  "../../../src/shared/org_workflow/permissions.repo",
  () => mockPermissionsRepo,
);

jest.mock("../../../src/config/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

const agent = require("../../../src/modules/praxis_ai/query-agent");

beforeEach(() => jest.clearAllMocks());

const toolCall = {
  id: "tc1",
  function: { name: "query_test_q", arguments: "{}" },
};
const baseArgs = {
  vendor: { vendor: "x" },
  brand: "pixiegirl",
  messages: [{ role: "user", content: "how many sales?" }],
  completion: { content: null, tool_calls: [toolCall] },
  toolCall,
  args: {},
};

describe("tool exposure", () => {
  test("exposes catalogue entries as prefixed READ tools", () => {
    const tools = agent.tools();
    expect(tools).toHaveLength(1);
    expect(tools[0].function.name).toBe("query_test_q");
    expect(tools[0].function.description).toMatch(/^\[READ\]/);
  });

  test("isQueryTool only matches the prefix", () => {
    expect(agent.isQueryTool("query_test_q")).toBe(true);
    expect(agent.isQueryTool("invoicing_create")).toBe(false);
    expect(agent.isQueryTool(null)).toBe(false);
  });
});

describe("permission gating", () => {
  test("denies a user without the module's view grant — never runs the query", async () => {
    mockPermissionsRepo.findGrants.mockResolvedValue([]);
    const r = await agent.run({
      ...baseArgs,
      user: { is_ceo: false, role_ids: ["r1"] },
    });
    expect(r.denied).toBe(true);
    expect(r.replyText).toMatch(/permission/i);
    expect(mockEntry.run).not.toHaveBeenCalled();
    expect(mockLlm.chat).not.toHaveBeenCalled();
  });

  test("CEO bypasses the permission check", async () => {
    mockEntry.run.mockResolvedValue({ paid_orders: 5, revenue_ngn: "1000.00" });
    mockLlm.chat.mockResolvedValue({
      content: "You had 5 paid orders totalling ₦1,000.",
      usage: { total_tokens: 12 },
    });
    const r = await agent.run({ ...baseArgs, user: { is_ceo: true } });
    expect(mockPermissionsRepo.findGrants).not.toHaveBeenCalled();
    expect(mockEntry.run).toHaveBeenCalledWith({
      brand: "pixiegirl",
      args: {},
      user: { is_ceo: true },
    });
    expect(r.replyText).toMatch(/5 paid orders/);
    expect(r.usage.total_tokens).toBe(12);
    expect(r.queryKey).toBe("test_q");
  });
});

describe("execution", () => {
  test("a permitted user runs the query and gets the summary", async () => {
    mockPermissionsRepo.findGrants.mockResolvedValue([{ record_scope: "all" }]);
    mockEntry.run.mockResolvedValue({ paid_orders: 2 });
    mockLlm.chat.mockResolvedValue({ content: "2 orders.", usage: {} });
    const r = await agent.run({
      ...baseArgs,
      user: { is_ceo: false, role_ids: ["r1"] },
    });
    expect(mockEntry.run).toHaveBeenCalled();
    expect(r.replyText).toBe("2 orders.");
  });

  test("falls back to a data answer if summarisation fails and no fallback vendor is configured", async () => {
    mockPermissionsRepo.findGrants.mockResolvedValue([{ record_scope: "all" }]);
    mockEntry.run.mockResolvedValue({ paid_orders: 9 });
    mockLlm.chat.mockRejectedValue(new Error("model down"));
    mockGemini.isConfigured.mockReturnValue(false);
    const r = await agent.run({
      ...baseArgs,
      user: { is_ceo: false, role_ids: ["r1"] },
    });
    expect(r.replyText).toMatch(/paid_orders/);
    expect(r.degraded).toBe(true);
  });

  test("summarisation failure tries the Gemini fallback before dumping raw JSON", async () => {
    mockPermissionsRepo.findGrants.mockResolvedValue([{ record_scope: "all" }]);
    mockEntry.run.mockResolvedValue({ paid_orders: 9 });
    mockLlm.chat.mockRejectedValue(new Error("model down"));
    mockGemini.isConfigured.mockReturnValue(true);
    mockGemini.chatCompletion.mockResolvedValue({
      text: "You had 9 paid orders.",
    });
    const r = await agent.run({
      ...baseArgs,
      user: { is_ceo: false, role_ids: ["r1"] },
    });
    expect(r.replyText).toBe("You had 9 paid orders.");
    expect(r.degraded).toBeFalsy();
    expect(mockGemini.chatCompletion.mock.calls[0][0].thinkingBudget).toBe(0);
  });
});

describe("chaining into a second tool after the lookup", () => {
  const analyticsAction = {
    action_key: "sales_campaigns.analytics_qna",
    title: "Plain-English campaign analytics Q&A",
    method: "POST",
    route: "/api/v1/sales-campaigns/:id/praxis/analytics-qna",
    is_write: false,
    requires_confirmation: false,
  };
  const writeAction = {
    action_key: "sales_campaigns.draft_copy",
    title: "Draft hero copy",
    method: "POST",
    route: "/api/v1/sales-campaigns/:id/praxis/draft-copy",
    is_write: false,
    requires_confirmation: true,
  };
  const byName = new Map([
    ["sales_campaigns_analytics_qna", analyticsAction],
    ["sales_campaigns_draft_copy", writeAction],
  ]);

  beforeEach(() => {
    mockPermissionsRepo.findGrants.mockResolvedValue([{ record_scope: "all" }]);
    mockEntry.run.mockResolvedValue([{ campaign_id: "camp-1", name: "Summer Sale" }]);
  });

  test("a read-safe follow-up action is chased inline over loopback", async () => {
    mockLlm.chat
      .mockResolvedValueOnce({
        content: null,
        tool_calls: [
          {
            id: "tc2",
            function: {
              name: "sales_campaigns_analytics_qna",
              arguments: JSON.stringify({ id: "camp-1", question: "was it a success?" }),
            },
          },
        ],
        usage: { total_tokens: 5 },
      })
      .mockResolvedValueOnce({
        content: "Yes — it beat the prior campaign by 12% revenue.",
        usage: { total_tokens: 8 },
      });
    mockExecutor.executeAction.mockResolvedValue({
      ok: true,
      http_status: 200,
      result: { revenue_ngn: "500000", vs_prior_pct: 12 },
    });

    const r = await agent.run({
      ...baseArgs,
      user: { is_ceo: true },
      allTools: [{ type: "function", function: { name: "sales_campaigns_analytics_qna" } }],
      byName,
      authHeader: "Bearer test-token",
      requestId: "req-1",
    });

    expect(mockExecutor.executeAction).toHaveBeenCalledWith({
      pending: {
        method: "POST",
        route: "/api/v1/sales-campaigns/:id/praxis/analytics-qna",
        payload: { id: "camp-1", question: "was it a success?" },
        business: "pixiegirl",
      },
      authHeader: "Bearer test-token",
      requestId: "req-1",
    });
    expect(r.replyText).toBe("Yes — it beat the prior campaign by 12% revenue.");
    expect(r.chainedAction).toBe("sales_campaigns.analytics_qna");
    expect(r.usage.total_tokens).toBe(13);
  });

  test("a write / confirmation-gated follow-up is NOT chased — answers with what's already known", async () => {
    mockLlm.chat.mockResolvedValueOnce({
      content: "Here's the last campaign; I can't draft copy without your go-ahead.",
      tool_calls: [
        {
          id: "tc2",
          function: {
            name: "sales_campaigns_draft_copy",
            arguments: JSON.stringify({ id: "camp-1", section: "hero" }),
          },
        },
      ],
      usage: {},
    });

    const r = await agent.run({
      ...baseArgs,
      user: { is_ceo: true },
      allTools: [{ type: "function", function: { name: "sales_campaigns_draft_copy" } }],
      byName,
      authHeader: "Bearer test-token",
      requestId: "req-1",
    });

    expect(mockExecutor.executeAction).not.toHaveBeenCalled();
    expect(r.replyText).toBe(
      "Here's the last campaign; I can't draft copy without your go-ahead.",
    );
    expect(r.chainedAction).toBeUndefined();
  });
});
