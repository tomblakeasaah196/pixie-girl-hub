"use strict";

/**
 * SQL agent — never ship a "Let me…" preamble (cut-off fixes).
 *
 * Mirror of the query-agent bug: when the model answered a sql turn with a
 * NON-sql tool call it wanted to chase (plus a "Let me check…" preamble), the
 * agent used to return that preamble verbatim as the whole answer. It must
 * instead synthesise a complete answer from what it already has.
 */

jest.mock("../../../src/config/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

const mockDb = { query: jest.fn(), transaction: jest.fn() };
jest.mock("../../../src/config/database", () => mockDb);

const mockLlm = { chat: jest.fn() };
jest.mock("../../../src/services/llm.service", () => mockLlm);

const mockGemini = {
  isConfigured: jest.fn(() => false),
  chatCompletion: jest.fn(),
};
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
  messages: [{ role: "user", content: "which tables track orders?" }],
  completion: { content: null, tool_calls: [toolCall] },
  toolCall,
  args: {},
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.query.mockResolvedValue({
    rows: [{ table_schema: "faitlynhair", table_name: "sales_orders" }],
  });
});

test("an unhandled non-sql tool call triggers synthesis, not a preamble dump", async () => {
  mockLlm.chat
    // The model returns a "Let me…" preamble AND a non-sql tool call it wants
    // to chase (which the sql agent won't run).
    .mockResolvedValueOnce({
      content: "Let me check that with a curated query instead.",
      tool_calls: [
        {
          id: "tc2",
          function: { name: "query_top_products", arguments: "{}" },
        },
      ],
      usage: { total_tokens: 4 },
    })
    // Forced synthesis pass (no tools) produces a real answer.
    .mockResolvedValueOnce({
      content: "Orders live in the sales_orders table for this brand.",
      tool_calls: [],
      usage: { total_tokens: 6 },
    });

  const r = await sqlAgent.run(baseArgs);

  expect(r.replyText).toBe(
    "Orders live in the sales_orders table for this brand.",
  );
  expect(r.replyText).not.toMatch(/Let me/);
  expect(mockLlm.chat).toHaveBeenCalledTimes(2);
});

describe("dispatchTool", () => {
  test("refuses a non-CEO caller without touching the database", async () => {
    const out = await sqlAgent.dispatchTool({
      user: { is_ceo: false },
      brand: "faitlynhair",
      name: "sql_schema",
      args: {},
    });
    expect(out).toEqual({ error: expect.stringMatching(/CEO/i) });
    expect(mockDb.query).not.toHaveBeenCalled();
  });

  test("runs a schema lookup for the CEO and returns the raw payload", async () => {
    const out = await sqlAgent.dispatchTool({
      user: { is_ceo: true },
      brand: "faitlynhair",
      name: "sql_schema",
      args: {},
    });
    expect(out).toEqual({ tables: ["faitlynhair.sales_orders"] });
  });
});
