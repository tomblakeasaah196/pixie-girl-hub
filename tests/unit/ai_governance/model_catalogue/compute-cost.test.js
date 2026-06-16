"use strict";

/**
 * Model catalogue cost tests — the single point that turns "tokens in
 * × rate + tokens out × rate" into the NGN figure the spend meter
 * displays. Rate switches in the UI must change this number immediately.
 */

jest.mock("../../../../src/config/database", () => ({
  query: jest.fn(),
}));

const repo = require("../../../../src/modules/ai_governance/model-catalogue.repo");

describe("model-catalogue.computeCost", () => {
  test("zero tokens → ₦0", () => {
    const cost = repo.computeCost({
      model: { input_cost_per_1m_ngn: 450, output_cost_per_1m_ngn: 3600 },
      input_tokens: 0,
      output_tokens: 0,
    });
    expect(parseFloat(cost)).toBe(0);
  });

  test("100k input + 25k output on Gemini Flash rates", () => {
    // 100,000 tokens × ₦450 / 1,000,000 = ₦45
    // 25,000 tokens × ₦3,600 / 1,000,000 = ₦90
    // Total = ₦135
    const cost = repo.computeCost({
      model: { input_cost_per_1m_ngn: 450, output_cost_per_1m_ngn: 3600 },
      input_tokens: 100_000,
      output_tokens: 25_000,
    });
    expect(parseFloat(cost)).toBeCloseTo(135, 2);
  });

  test("switching to Flash Lite drops the cost roughly 6×", () => {
    const flash = repo.computeCost({
      model: { input_cost_per_1m_ngn: 450, output_cost_per_1m_ngn: 3600 },
      input_tokens: 100_000,
      output_tokens: 25_000,
    });
    const flashLite = repo.computeCost({
      model: { input_cost_per_1m_ngn: 150, output_cost_per_1m_ngn: 600 },
      input_tokens: 100_000,
      output_tokens: 25_000,
    });
    // Flash ≈ ₦135, Flash Lite ≈ ₦30 → ratio ~4.5×
    expect(parseFloat(flash) / parseFloat(flashLite)).toBeGreaterThan(3);
  });

  test("DeepSeek primary rates", () => {
    // Migration seeds: input 420, output 1680
    // 50k in × ₦420 / 1M = ₦21
    // 15k out × ₦1680 / 1M = ₦25.20
    const cost = repo.computeCost({
      model: { input_cost_per_1m_ngn: 420, output_cost_per_1m_ngn: 1680 },
      input_tokens: 50_000,
      output_tokens: 15_000,
    });
    expect(parseFloat(cost)).toBeCloseTo(46.2, 2);
  });

  test("embeddings only count input cost", () => {
    const cost = repo.computeCost({
      model: { input_cost_per_1m_ngn: 30, output_cost_per_1m_ngn: 0 },
      input_tokens: 1_000_000,
      output_tokens: 0,
    });
    expect(parseFloat(cost)).toBe(30);
  });
});
