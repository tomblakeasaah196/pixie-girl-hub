"use strict";

/**
 * sql-agent summarise fallback chain (hallucination fixes PR 2).
 *
 * Previously a single summarise failure dumped raw information_schema JSON
 * into the chat ("Here's the raw result: {...}"), which the Markdown
 * renderer then shredded. Now: retry primary once → fallback vendor
 * (Gemini) → fenced raw JSON as the true last resort.
 */

jest.mock("../../../src/config/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

const mockDb = { query: jest.fn(), transaction: jest.fn() };
jest.mock("../../../src/config/database", () => mockDb);

const mockLlm = { chat: jest.fn() };
jest.mock("../../../src/services/llm.service", () => mockLlm);

const mockGemini = { isConfigured: jest.fn(), chatCompletion: jest.fn() };
jest.mock("../../../src/services/gemini.service", () => mockGemini);

const sqlAgent = require("../../../src/modules/praxis_ai/sql-agent");

const toolCall = {
  id: "tc1",
  function: { name: "sql_schema", arguments: "{}" },
};
const baseArgs = {
  vendor: { vendor: "deepseek" },
  user: { is_ceo: true, user_id: "u-1" },
  brand: "faitlynhair",
  messages: [{ role: "user", content: "Have the 27 orders been assigned?" }],
  completion: { content: null, tool_calls: [toolCall] },
  toolCall,
  args: {},
};

beforeEach(() => {
  jest.clearAllMocks();
  // sql_schema list-tables path.
  mockDb.query.mockResolvedValue({
    rows: [{ table_schema: "faitlynhair", table_name: "sales_orders" }],
  });
});

describe("sql-agent summarise fallback", () => {
  test("summarise failure retries the primary vendor once", async () => {
    mockLlm.chat
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValueOnce({
        content: "You have a sales_orders table.",
        tool_calls: [],
        usage: { total_tokens: 10 },
      });

    const r = await sqlAgent.run(baseArgs);

    expect(mockLlm.chat).toHaveBeenCalledTimes(2);
    expect(r.replyText).toBe("You have a sales_orders table.");
  });

  test("both primary attempts fail → Gemini summarises", async () => {
    mockLlm.chat.mockRejectedValue(new Error("503"));
    mockGemini.isConfigured.mockReturnValue(true);
    mockGemini.chatCompletion.mockResolvedValue({
      text: "Your database has a sales_orders table for this brand.",
    });

    const r = await sqlAgent.run(baseArgs);

    expect(mockGemini.chatCompletion).toHaveBeenCalledTimes(1);
    const call = mockGemini.chatCompletion.mock.calls[0][0];
    expect(call.messages[0].content).toMatch(/Have the 27 orders/);
    expect(call.messages[0].content).toMatch(/sales_orders/);
    expect(r.replyText).toMatch(/sales_orders table for this brand/);
  });

  test("no fallback vendor → raw result is code-fenced, never bare JSON", async () => {
    mockLlm.chat.mockRejectedValue(new Error("503"));
    mockGemini.isConfigured.mockReturnValue(false);

    const r = await sqlAgent.run(baseArgs);

    expect(r.replyText).toMatch(/```json/);
    expect(r.replyText).toMatch(/couldn't compose a summary/i);
    // The old bare-dump prefix must be gone.
    expect(r.replyText).not.toMatch(/^Here's the raw result:/);
    // Marked degraded so the trace/usage ledger can surface it — previously
    // this silently recorded as an ordinary successful turn.
    expect(r.degraded).toBe(true);
  });

  test("non-CEO users are still refused before any query runs", async () => {
    const r = await sqlAgent.run({
      ...baseArgs,
      user: { is_ceo: false, user_id: "u-2" },
    });
    expect(r.denied).toBe(true);
    expect(mockDb.query).not.toHaveBeenCalled();
  });
});
