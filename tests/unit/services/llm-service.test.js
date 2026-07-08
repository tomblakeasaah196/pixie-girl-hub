"use strict";

/**
 * llm.service — tool-markup leak containment (hallucination fixes PR 2).
 *
 * DeepSeek occasionally emits its internal DSML tool-call markup as plain
 * `content` instead of a parsed `tool_calls` array; users saw raw
 * "<｜DSML｜>… invoke name=…" as Praxis's answer. chat() must detect the
 * leak, retry once, and never return raw markup.
 */

jest.mock("../../../src/config/env", () => ({
  config: { PRAXIS_LLM_VENDOR: "deepseek" },
}));
jest.mock("../../../src/config/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));
jest.mock("../../../src/modules/ai_governance/governance.service", () => ({
  getVendorConfig: jest.fn(),
}));

const mockPost = jest.fn();
jest.mock("axios", () => ({ post: (...a) => mockPost(...a) }));

const llm = require("../../../src/services/llm.service");

const VENDOR = {
  vendor: "deepseek",
  api_key: "k",
  endpoint_url: "https://api.deepseek.com",
  default_model: "deepseek-chat",
};

const reply = (content, tool_calls = []) => ({
  data: {
    choices: [{ message: { content, tool_calls } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    model: "deepseek-chat",
  },
});

// The shape observed in production Praxis chats (screenshot: raw DSML
// markup with an invoke block rendered to the CEO as the answer).
const LEAKED =
  '<｜DSML｜tool▁calls▁begin｜><｜DSML｜invoke name="sql_schema"></｜DSML｜invoke><｜DSML｜tool▁calls▁end｜>';

beforeEach(() => jest.clearAllMocks());

describe("isToolMarkupLeak", () => {
  test("matches leaked DSML / tool-call markup", () => {
    expect(llm.isToolMarkupLeak(LEAKED)).toBe(true);
    expect(llm.isToolMarkupLeak('<|DSML|toolcalls> <invoke name="x">')).toBe(
      true,
    );
    expect(llm.isToolMarkupLeak("<|tool_calls|> stuff")).toBe(true);
    expect(llm.isToolMarkupLeak("prefix <tool_call> suffix")).toBe(true);
  });

  test("does not match ordinary answers mentioning tools or snake_case", () => {
    expect(llm.isToolMarkupLeak("Your revenue was ₦2.1m this week.")).toBe(
      false,
    );
    expect(
      llm.isToolMarkupLeak("I checked sales_orders and call_type columns."),
    ).toBe(false);
    expect(llm.isToolMarkupLeak("I can run sql_schema for you.")).toBe(false);
    expect(llm.isToolMarkupLeak("")).toBe(false);
    expect(llm.isToolMarkupLeak(null)).toBe(false);
  });
});

describe("chat — leak retry", () => {
  const args = {
    vendor: VENDOR,
    messages: [{ role: "user", content: "hi" }],
  };

  test("clean response returns on the first attempt", async () => {
    mockPost.mockResolvedValueOnce(reply("Hello!"));
    const r = await llm.chat(args);
    expect(r.content).toBe("Hello!");
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  test("a parsed tool_call is honoured even if content looks odd", async () => {
    const tc = [{ id: "t1", function: { name: "x", arguments: "{}" } }];
    mockPost.mockResolvedValueOnce(reply(LEAKED, tc));
    const r = await llm.chat(args);
    expect(r.tool_calls).toHaveLength(1);
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  test("leaked markup with no tool_calls triggers exactly one retry", async () => {
    mockPost
      .mockResolvedValueOnce(reply(LEAKED))
      .mockResolvedValueOnce(reply("You had 5 orders today."));
    const r = await llm.chat(args);
    expect(r.content).toBe("You had 5 orders today.");
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  test("a double leak never ships raw markup to the caller", async () => {
    mockPost
      .mockResolvedValueOnce(reply(LEAKED))
      .mockResolvedValueOnce(reply("Before markup.\n" + LEAKED));
    const r = await llm.chat(args);
    expect(r.content).not.toMatch(/DSML/);
    expect(r.content).not.toMatch(/invoke name=/);
    // Salvaged the readable line that surrounded the markup.
    expect(r.content).toBe("Before markup.");
    expect(mockPost).toHaveBeenCalledTimes(2);
  });

  test("a double leak with nothing salvageable degrades to an honest message", async () => {
    mockPost
      .mockResolvedValueOnce(reply(LEAKED))
      .mockResolvedValueOnce(reply(LEAKED));
    const r = await llm.chat(args);
    expect(r.content).not.toMatch(/DSML/);
    expect(r.content).toMatch(/ask me again/i);
  });
});
