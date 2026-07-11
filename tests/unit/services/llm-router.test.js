"use strict";

/**
 * LLM failover router (src/services/llm-router.js) — vendor chain order,
 * health-skip, unconfigured-skip, failover incident write, and total failure.
 * All vendor plumbing is mocked.
 */

jest.mock("../../../src/services/llm.service", () => ({
  resolveVendor: jest.fn(),
  chat: jest.fn(),
  isToolMarkupLeak: jest.fn(() => false),
}));
jest.mock("../../../src/modules/ai_governance/governance.service", () => ({
  listVendors: jest.fn(async () => []),
}));
jest.mock("../../../src/modules/ai_governance/model-catalogue.repo", () => ({
  resolveActiveModel: jest.fn(async () => null),
}));
jest.mock("../../../src/modules/ai_governance/health.service", () => ({
  markCallOutcome: jest.fn(),
  recordFailover: jest.fn(async () => ({})),
}));
jest.mock("../../../src/config/env", () => ({
  config: { PRAXIS_LLM_VENDOR: "deepseek", PRAXIS_LLM_FALLBACK_VENDOR: "gemini" },
}));
jest.mock("../../../src/config/logger", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

const llm = require("../../../src/services/llm.service");
const governance = require("../../../src/modules/ai_governance/governance.service");
const health = require("../../../src/modules/ai_governance/health.service");
const router = require("../../../src/services/llm-router");

const okCompletion = (vendor) => ({
  content: "hi",
  tool_calls: [],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  model: `m-${vendor}`,
});
const cfgFor = (vendor) => ({ vendor, default_model: `m-${vendor}`, endpoint_url: "http://x", api_key: "k" });
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => jest.clearAllMocks());

test("advances to the next vendor on failure and records a failover incident", async () => {
  llm.resolveVendor.mockImplementation(async (v) => cfgFor(v));
  llm.chat
    .mockRejectedValueOnce(new Error("deepseek network timeout"))
    .mockResolvedValueOnce(okCompletion("gemini"));

  const res = await router.chatWithFailover({ messages: [], brand: "pixiegirl" });
  await flush();

  expect(res.vendor).toBe("gemini");
  expect(health.recordFailover).toHaveBeenCalledTimes(1);
  expect(health.recordFailover.mock.calls[0][0]).toMatchObject({
    primary_vendor: "deepseek",
    fallback_vendor: "gemini",
  });
  expect(health.markCallOutcome).toHaveBeenCalledWith(expect.objectContaining({ vendor: "deepseek", ok: false }));
  expect(health.markCallOutcome).toHaveBeenCalledWith(expect.objectContaining({ vendor: "gemini", ok: true }));
});

test("skips a vendor flagged 'red' by pushing it to the back of the chain", async () => {
  governance.listVendors.mockResolvedValueOnce([{ vendor: "deepseek", last_health_status: "red" }]);
  llm.resolveVendor.mockImplementation(async (v) => cfgFor(v));
  llm.chat.mockResolvedValueOnce(okCompletion("gemini"));

  const res = await router.chatWithFailover({ messages: [] });

  expect(res.vendor).toBe("gemini");
  // gemini was tried FIRST (deepseek demoted), so only one chat call happened.
  expect(llm.chat).toHaveBeenCalledTimes(1);
  expect(llm.chat.mock.calls[0][0].vendor.vendor).toBe("gemini");
  expect(health.recordFailover).not.toHaveBeenCalled();
});

test("skips an unconfigured vendor without treating it as a failover", async () => {
  llm.resolveVendor.mockImplementation(async (v) => (v === "deepseek" ? null : cfgFor(v)));
  llm.chat.mockResolvedValueOnce(okCompletion("gemini"));

  const res = await router.chatWithFailover({ messages: [] });
  await flush();

  expect(res.vendor).toBe("gemini");
  expect(health.recordFailover).not.toHaveBeenCalled(); // unconfigured ≠ failed
});

test("throws AI_UNAVAILABLE when every vendor fails", async () => {
  llm.resolveVendor.mockImplementation(async (v) => cfgFor(v));
  llm.chat.mockRejectedValue(new Error("down"));

  await expect(router.chatWithFailover({ messages: [] })).rejects.toMatchObject({
    code: "AI_UNAVAILABLE",
  });
});

test("resolveChain de-dupes and defaults to deepseek → gemini → openai", async () => {
  const chain = await router.resolveChain();
  expect(chain).toEqual(["deepseek", "gemini", "openai"]);
});
