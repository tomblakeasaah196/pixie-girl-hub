"use strict";

/**
 * Praxis Query Agent unit tests (§8.2). Verifies the safety contract without
 * infra: read tools are exposed with a stable prefix, queries are gated on the
 * caller's `view` permission (CEO bypasses), and a permitted query runs the
 * catalogue entry + summarises. The LLM, permissions repo, and catalogue are
 * mocked — no DB, no network.
 */

const entry = {
  key: "test_q",
  title: "Test query",
  description: "A test query.",
  module: "dashboards",
  parameters: { type: "object", properties: {} },
  run: jest.fn(),
};

jest.mock("../../../src/modules/praxis_ai/query-catalogue", () => ({
  list: () => [entry],
  get: (k) => (k === "test_q" ? entry : null),
}));

const llm = { chat: jest.fn() };
jest.mock("../../../src/services/llm.service", () => llm);

const permissionsRepo = { findGrants: jest.fn() };
jest.mock("../../../src/shared/org_workflow/permissions.repo", () => permissionsRepo);

jest.mock("../../../src/config/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

const agent = require("../../../src/modules/praxis_ai/query-agent");

beforeEach(() => jest.clearAllMocks());

const toolCall = { id: "tc1", function: { name: "query_test_q", arguments: "{}" } };
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
    permissionsRepo.findGrants.mockResolvedValue([]);
    const r = await agent.run({
      ...baseArgs,
      user: { is_ceo: false, role_ids: ["r1"] },
    });
    expect(r.denied).toBe(true);
    expect(r.replyText).toMatch(/permission/i);
    expect(entry.run).not.toHaveBeenCalled();
    expect(llm.chat).not.toHaveBeenCalled();
  });

  test("CEO bypasses the permission check", async () => {
    entry.run.mockResolvedValue({ paid_orders: 5, revenue_ngn: "1000.00" });
    llm.chat.mockResolvedValue({
      content: "You had 5 paid orders totalling ₦1,000.",
      usage: { total_tokens: 12 },
    });
    const r = await agent.run({ ...baseArgs, user: { is_ceo: true } });
    expect(permissionsRepo.findGrants).not.toHaveBeenCalled();
    expect(entry.run).toHaveBeenCalledWith({
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
    permissionsRepo.findGrants.mockResolvedValue([{ record_scope: "all" }]);
    entry.run.mockResolvedValue({ paid_orders: 2 });
    llm.chat.mockResolvedValue({ content: "2 orders.", usage: {} });
    const r = await agent.run({
      ...baseArgs,
      user: { is_ceo: false, role_ids: ["r1"] },
    });
    expect(entry.run).toHaveBeenCalled();
    expect(r.replyText).toBe("2 orders.");
  });

  test("falls back to a data answer if summarisation fails (never throws)", async () => {
    permissionsRepo.findGrants.mockResolvedValue([{ record_scope: "all" }]);
    entry.run.mockResolvedValue({ paid_orders: 9 });
    llm.chat.mockRejectedValue(new Error("model down"));
    const r = await agent.run({
      ...baseArgs,
      user: { is_ceo: false, role_ids: ["r1"] },
    });
    expect(r.replyText).toMatch(/paid_orders/);
  });
});
