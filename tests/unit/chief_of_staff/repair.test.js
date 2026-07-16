"use strict";

/**
 * CoS self-repair (cos.repair.js) — extractJson robustness, and the one-shot
 * repair fn (model corrects its own failed payload, re-checked by pre-flight).
 * llm-router + usage metering are mocked (no vendor, no ledger).
 */

jest.mock("../../../src/services/llm-router", () => ({ chatWithFailover: jest.fn() }));
jest.mock("../../../src/modules/chief_of_staff/cos.usage", () => ({ recordUsageSafe: jest.fn() }));
jest.mock("../../../src/config/logger", () => ({
  logger: { warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

const llmRouter = require("../../../src/services/llm-router");
const usage = require("../../../src/modules/chief_of_staff/cos.usage");
const { makeRepairFn, extractJson } = require("../../../src/modules/chief_of_staff/cos.repair");

const ACTION = {
  action_key: "workspace.create_task",
  payload_schema: {
    type: "object",
    properties: {
      title: { type: "string" },
      priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
    },
    required: ["title"],
  },
};

beforeEach(() => jest.clearAllMocks());

describe("extractJson", () => {
  test("pulls a balanced object out of noisy text", () => {
    expect(extractJson('Sure: {"a":1,"b":"x"} — done')).toEqual({ a: 1, b: "x" });
  });
  test("is string-aware (a brace inside a string doesn't end the object)", () => {
    expect(extractJson('{"a":"has } brace"}')).toEqual({ a: "has } brace" });
  });
  test("returns null when there's no JSON", () => {
    expect(extractJson("no json here")).toBeNull();
    expect(extractJson("{broken")).toBeNull();
  });
});

describe("makeRepairFn", () => {
  const ctx = { user: { user_id: "u1" }, brand: "pixiegirl" };
  const step = { conversation_id: "c1", action_key: "workspace.create_task", payload: { title: "T", priority: "sometime" } };

  test("returns the corrected, pre-flight-cleaned payload and meters usage", async () => {
    llmRouter.chatWithFailover.mockResolvedValue({
      content: '{"title":"T","priority":"high","bogus":"drop me"}',
      vendor: "deepseek",
      model: "deepseek-chat",
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    const repair = makeRepairFn(ctx);
    const fixed = await repair(step, ACTION, "priority is invalid");
    expect(fixed).toEqual({ title: "T", priority: "high" }); // bogus key stripped
    expect(usage.recordUsageSafe).toHaveBeenCalledTimes(1);
  });

  test("returns null when the model's 'fix' is a no-op", async () => {
    llmRouter.chatWithFailover.mockResolvedValue({
      content: JSON.stringify(step.payload),
      vendor: "deepseek",
      model: "deepseek-chat",
      usage: {},
    });
    const repair = makeRepairFn(ctx);
    expect(await repair(step, ACTION, "err")).toBeNull();
  });

  test("returns null (never throws) when the vendor call fails", async () => {
    llmRouter.chatWithFailover.mockRejectedValue(new Error("all vendors down"));
    const repair = makeRepairFn(ctx);
    expect(await repair(step, ACTION, "err")).toBeNull();
  });
});
