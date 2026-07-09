"use strict";

/**
 * ai-run.service — the metering wrapper that made the Jul 2026 outage
 * visible in the ledger. Two invariants under test:
 *   1. A successful Gemini call writes ONE ledger row with was_successful=true
 *      and the vendor's cost math applied.
 *   2. A failing Gemini call ALSO writes one row, with was_successful=false,
 *      the error code preserved, and cost 0.
 *
 * Both writes are fire-and-forget from the caller's perspective — we
 * await a microtask to let them settle before asserting.
 */

jest.mock("../../../src/services/gemini.service", () => ({
  resolveVendor: jest.fn(),
  chatCompletion: jest.fn(),
}));
jest.mock("../../../src/modules/ai_governance/governance.service", () => ({
  recordUsage: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../../src/modules/ai_governance/health.service", () => ({
  markCallOutcome: jest.fn(),
}));
jest.mock("../../../src/config/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const gemini = require("../../../src/services/gemini.service");
const governance = require("../../../src/modules/ai_governance/governance.service");
const health = require("../../../src/modules/ai_governance/health.service");
const aiRun = require("../../../src/services/ai-run.service");

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  gemini.resolveVendor.mockResolvedValue({
    source: "db",
    vendor: "gemini",
    api_key: "k",
    endpoint_url: "https://generativelanguage.googleapis.com",
    default_model: "gemini-2.5-flash",
    cost_per_1k_input_tokens: 0.075,
    cost_per_1k_output_tokens: 0.3,
  });
});

test("runGeminiCall on success writes a truthy ledger row + marks health green", async () => {
  gemini.chatCompletion.mockResolvedValue({
    text: "hello",
    input_tokens: 1000,
    output_tokens: 500,
    model: "gemini-2.5-flash",
    latency_ms: 420,
  });
  const out = await aiRun.runGeminiCall({
    feature_key: "shop_ai_search",
    business: "faitlynhair",
    gemini: { messages: [{ role: "user", content: "hi" }] },
  });
  expect(out.text).toBe("hello");
  await flush();
  expect(governance.recordUsage).toHaveBeenCalledTimes(1);
  const usage = governance.recordUsage.mock.calls[0][0].usage;
  expect(usage.was_successful).toBe(true);
  expect(usage.business).toBe("faitlynhair");
  expect(usage.provider).toBe("gemini");
  // Cost math: 1k input * 0.075 + 0.5k output * 0.3 = 0.075 + 0.15 = 0.225
  // rounded to 2dp per the project money convention → 0.23.
  expect(Number(usage.cost_ngn)).toBeCloseTo(0.23, 2);
  expect(health.markCallOutcome).toHaveBeenCalledWith(
    expect.objectContaining({ vendor: "gemini", ok: true }),
  );
});

test("runGeminiCall on failure ALSO writes a ledger row + marks health red", async () => {
  const err = new Error("gemini call failed (400)");
  err.code = "GEMINI_CALL_FAILED";
  err.status = 400;
  err.api_message = "API key not valid";
  err.latency_ms = 88;
  gemini.chatCompletion.mockRejectedValue(err);
  await expect(
    aiRun.runGeminiCall({
      feature_key: "shop_ai_search",
      business: "faitlynhair",
      gemini: { messages: [{ role: "user", content: "hi" }] },
    }),
  ).rejects.toThrow(/gemini call failed/);
  await flush();
  expect(governance.recordUsage).toHaveBeenCalledTimes(1);
  const usage = governance.recordUsage.mock.calls[0][0].usage;
  expect(usage.was_successful).toBe(false);
  expect(usage.error_code).toBe("GEMINI_CALL_FAILED");
  expect(usage.error_message).toContain("API key not valid");
  expect(Number(usage.cost_ngn)).toBe(0);
  expect(health.markCallOutcome).toHaveBeenCalledWith(
    expect.objectContaining({ vendor: "gemini", ok: false }),
  );
});
