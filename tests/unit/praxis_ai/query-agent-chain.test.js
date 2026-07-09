"use strict";

/**
 * Praxis Query Agent — cross-type read chaining (cut-off fixes).
 *
 * The reported cut-offs ("Let me also pull the contact names…", "Let me trace
 * it to its base product") happened because a follow-up query_* or sql_* tool
 * call after the first lookup was DROPPED, and the model's "Let me…" preamble
 * shipped as the whole answer. These tests prove the follow-up read is now
 * actually dispatched and the chain runs through to a real answer.
 *
 * Names referenced inside a jest.mock() factory MUST be prefixed `mock`.
 */

const mockOrders = {
  key: "orders",
  module: "sales",
  parameters: { type: "object", properties: {} },
  run: jest.fn(),
};
const mockContacts = {
  key: "contacts",
  module: "crm",
  parameters: { type: "object", properties: {} },
  run: jest.fn(),
};
const mockCatalogue = {
  list: () => [mockOrders, mockContacts],
  get: (k) => ({ orders: mockOrders, contacts: mockContacts })[k] || null,
};
jest.mock(
  "../../../src/modules/praxis_ai/query-catalogue",
  () => mockCatalogue,
);

const mockLlm = { chat: jest.fn() };
jest.mock("../../../src/services/llm.service", () => mockLlm);

const mockGemini = {
  isConfigured: jest.fn(() => false),
  chatCompletion: jest.fn(),
};
jest.mock("../../../src/services/gemini.service", () => mockGemini);

const mockExecutor = { executeAction: jest.fn() };
jest.mock("../../../src/modules/praxis_ai/praxis.executor", () => mockExecutor);

const mockSqlAgent = { dispatchTool: jest.fn() };
jest.mock("../../../src/modules/praxis_ai/sql-agent", () => mockSqlAgent);

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

const initialCall = {
  id: "tc1",
  function: { name: "query_orders", arguments: "{}" },
};
const base = {
  vendor: { vendor: "deepseek" },
  user: { is_ceo: true },
  brand: "faitlynhair",
  messages: [{ role: "user", content: "what needs my attention?" }],
  completion: { content: null, tool_calls: [initialCall] },
  toolCall: initialCall,
  args: {},
  allTools: [{ type: "function", function: { name: "query_contacts" } }],
  byName: new Map(),
  authHeader: "Bearer t",
  requestId: "req-1",
};

const queryToolCall = (id, name, args = {}) => ({
  id,
  function: { name, arguments: JSON.stringify(args) },
});

test("chases a follow-up query_* lookup instead of dropping it", async () => {
  mockOrders.run.mockResolvedValue([
    { order_id: "o1", contact_id: "c1" },
    { order_id: "o2", contact_id: "c2" },
  ]);
  mockContacts.run.mockResolvedValue([
    { contact_id: "c1", display_name: "Ada" },
    { contact_id: "c2", display_name: "Bola" },
  ]);
  mockLlm.chat
    // hop 0: model asks for the contact names (the call that used to be dropped)
    .mockResolvedValueOnce({
      content: "Let me also pull the contact names behind those orders.",
      tool_calls: [
        queryToolCall("tc2", "query_contacts", { ids: ["c1", "c2"] }),
      ],
      usage: { total_tokens: 5 },
    })
    // hop 1: model answers using the names it just fetched
    .mockResolvedValueOnce({
      content: "Those two orders belong to Ada and Bola.",
      tool_calls: [],
      usage: { total_tokens: 7 },
    });

  const r = await agent.run(base);

  expect(mockContacts.run).toHaveBeenCalled(); // the follow-up query actually ran
  expect(r.replyText).toBe("Those two orders belong to Ada and Bola.");
  // The "Let me…" preamble is NEVER the final answer.
  expect(r.replyText).not.toMatch(/Let me/);
  expect(r.usage.total_tokens).toBe(12);
});

test("chases a follow-up sql_* read (styled product -> base product)", async () => {
  mockOrders.run.mockResolvedValue([{ styled_id: "s1", product_id: "p1" }]);
  mockSqlAgent.dispatchTool.mockResolvedValue({
    row_count: 1,
    rows: [
      { product_id: "p1", name: "Black 4mm Curl HD13x4 Pixie Wig - Small" },
    ],
  });
  mockLlm.chat
    .mockResolvedValueOnce({
      content: "Let me trace it to its base product.",
      tool_calls: [
        queryToolCall("tc2", "sql_query", {
          sql: "SELECT name FROM products WHERE product_id = 'p1'",
        }),
      ],
      usage: { total_tokens: 4 },
    })
    .mockResolvedValueOnce({
      content:
        "The base product is the Black 4mm Curl HD13x4 Pixie Wig - Small.",
      tool_calls: [],
      usage: { total_tokens: 9 },
    });

  const r = await agent.run(base);

  expect(mockSqlAgent.dispatchTool).toHaveBeenCalledWith({
    user: base.user,
    brand: "faitlynhair",
    name: "sql_query",
    args: { sql: "SELECT name FROM products WHERE product_id = 'p1'" },
  });
  expect(r.replyText).toMatch(/Black 4mm Curl HD13x4 Pixie Wig - Small/);
  expect(r.replyText).not.toMatch(/Let me/);
});

test("answers every dispatchable tool call the model emits in one turn", async () => {
  mockOrders.run.mockResolvedValue([{ order_id: "o1" }]);
  mockContacts.run.mockResolvedValue([
    { contact_id: "c1", display_name: "Ada" },
  ]);
  mockSqlAgent.dispatchTool.mockResolvedValue({ rows: [{ n: 1 }] });
  mockLlm.chat
    .mockResolvedValueOnce({
      content: null,
      tool_calls: [
        queryToolCall("tcA", "query_contacts", {}),
        queryToolCall("tcB", "sql_query", { sql: "SELECT 1" }),
      ],
      usage: { total_tokens: 6 },
    })
    .mockResolvedValueOnce({
      content: "Here's the combined picture.",
      tool_calls: [],
      usage: { total_tokens: 3 },
    });

  const r = await agent.run(base);

  expect(mockContacts.run).toHaveBeenCalled();
  expect(mockSqlAgent.dispatchTool).toHaveBeenCalled();
  // The batch must be replayed BALANCED: one assistant message carrying both
  // answered calls, and a matching tool response for each (a mismatch 400s the
  // vendor). The initial query's own tool response is also present (tc1).
  const hop1Messages = mockLlm.chat.mock.calls[1][0].messages;
  const batchAsst = hop1Messages.find(
    (m) =>
      m.role === "assistant" &&
      Array.isArray(m.tool_calls) &&
      m.tool_calls.length === 2,
  );
  expect(batchAsst.tool_calls.map((c) => c.id)).toEqual(["tcA", "tcB"]);
  const toolIds = hop1Messages
    .filter((m) => m.role === "tool")
    .map((m) => m.tool_call_id);
  expect(toolIds).toEqual(expect.arrayContaining(["tcA", "tcB"]));
  expect(r.replyText).toBe("Here's the combined picture.");
});

describe("clampToolResult", () => {
  test("keeps whole rows and reports how many were omitted — never cuts mid-record", () => {
    const rows = Array.from({ length: 27 }, (_, i) => ({
      order_number: `FLH-SO-${1000 + i}`,
      amount_ngn: "329000.00",
      note: "paid but not dispatched",
    }));
    const out = agent.clampToolResult(rows, 400);
    // Still valid JSON (not truncated mid-object) and self-describing.
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed.rows)).toBe(true);
    expect(parsed.rows.length).toBeGreaterThan(0);
    expect(parsed.rows.length).toBeLessThan(27);
    expect(parsed._note).toMatch(/of 27 rows/);
    // Every kept row is complete.
    for (const row of parsed.rows) {
      expect(row).toHaveProperty("order_number");
      expect(row).toHaveProperty("amount_ngn");
      expect(row).toHaveProperty("note");
    }
  });

  test("passes small results through untouched", () => {
    const out = agent.clampToolResult({ paid_orders: 5 }, 24000);
    expect(out).toBe(JSON.stringify({ paid_orders: 5 }));
  });
});
