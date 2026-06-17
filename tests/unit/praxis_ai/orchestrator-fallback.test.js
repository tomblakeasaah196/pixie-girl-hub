"use strict";

/**
 * Orchestrator.generateSmartcommDraft — focus: vendor fallback path
 * (primary fails → fallback used) and the cost calc reads from the
 * model catalogue.
 */

jest.mock("../../../src/config/env", () => ({
  config: {
    PRAXIS_LLM_VENDOR: "deepseek",
    PRAXIS_LLM_FALLBACK_VENDOR: "gemini",
  },
}));

jest.mock("../../../src/services/llm.service", () => ({
  resolveVendor: jest.fn(),
  chat: jest.fn(),
}));
jest.mock("../../../src/services/gemini.service", () => ({
  isConfigured: jest.fn(),
  chatCompletion: jest.fn(),
}));
jest.mock("../../../src/modules/ai_governance/model-catalogue.repo", () => ({
  resolveActiveModel: jest.fn(),
  computeCost: jest.fn(() => "12.3456"),
}));
jest.mock("../../../src/modules/ai_governance/governance.service", () => ({
  recordUsage: jest.fn().mockResolvedValue(undefined),
}));

const llm = require("../../../src/services/llm.service");
const gemini = require("../../../src/services/gemini.service");
const modelCatalogue = require("../../../src/modules/ai_governance/model-catalogue.repo");
const governance = require("../../../src/modules/ai_governance/governance.service");
const orchestrator = require("../../../src/modules/praxis_ai/praxis.orchestrator");

const baseArgs = {
  user: { user_id: "user-1" },
  brand: "pixiegirl",
  context: {
    brand: "pixiegirl",
    platform: "whatsapp",
    tone: "warm",
    voice_summary: "Confident best friend.",
    primary_emojis: ["🌹"],
    do_donts: { do: ["Greet by name"], dont: ["Promise dates"] },
    customer_name: "Ada",
    transcript: "Customer: Hi, when will my wig ship?",
  },
};

describe("orchestrator.generateSmartcommDraft", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    modelCatalogue.resolveActiveModel.mockResolvedValue({
      model_id: "deepseek-chat",
      vendor: "deepseek",
      input_cost_per_1m_ngn: 420,
      output_cost_per_1m_ngn: 1680,
    });
  });

  test("happy path uses primary vendor (DeepSeek)", async () => {
    llm.resolveVendor.mockResolvedValue({
      vendor: "deepseek",
      api_key: "x",
      endpoint_url: "https://api.deepseek.com",
      default_model: "deepseek-chat",
    });
    llm.chat.mockResolvedValue({
      content: "Hi Ada! Your order will ship by Friday 🌹",
      usage: { prompt_tokens: 250, completion_tokens: 30 },
      model: "deepseek-chat",
    });

    const result = await orchestrator.generateSmartcommDraft(baseArgs);

    expect(result.text).toMatch(/Ada/);
    expect(result.usage.provider).toBe("deepseek");
    expect(result.usage.input_tokens).toBe(250);
    expect(result.usage.output_tokens).toBe(30);
    expect(result.usage.cost_ngn).toBe("12.3456");
    expect(gemini.chatCompletion).not.toHaveBeenCalled();
    expect(governance.recordUsage).toHaveBeenCalledTimes(1);
  });

  test("falls back to Gemini when primary throws a retryable error", async () => {
    llm.resolveVendor.mockResolvedValue({
      vendor: "deepseek",
      api_key: "x",
      endpoint_url: "https://api.deepseek.com",
      default_model: "deepseek-chat",
    });
    llm.chat.mockRejectedValue(
      Object.assign(new Error("503 Service Unavailable"), {
        retryable: true,
      }),
    );
    gemini.isConfigured.mockReturnValue(true);
    gemini.chatCompletion.mockResolvedValue({
      text: "Hi Ada! We'll ship by Friday ✨",
      input_tokens: 300,
      output_tokens: 25,
      model: "gemini-2.5-flash",
      vendor: "gemini",
    });

    const result = await orchestrator.generateSmartcommDraft(baseArgs);

    expect(result.usage.provider).toBe("gemini");
    expect(result.usage.model).toBe("gemini-2.5-flash");
    expect(gemini.chatCompletion).toHaveBeenCalledTimes(1);
    expect(governance.recordUsage).toHaveBeenCalledTimes(1);
  });

  test("falls back to Gemini when primary vendor not configured", async () => {
    llm.resolveVendor.mockResolvedValue(null);
    gemini.isConfigured.mockReturnValue(true);
    gemini.chatCompletion.mockResolvedValue({
      text: "Hi Ada!",
      input_tokens: 10,
      output_tokens: 5,
      model: "gemini-2.5-flash",
      vendor: "gemini",
    });

    const result = await orchestrator.generateSmartcommDraft(baseArgs);
    expect(result.usage.provider).toBe("gemini");
  });

  test("throws AI_UNAVAILABLE when both vendors fail", async () => {
    llm.resolveVendor.mockResolvedValue(null);
    gemini.isConfigured.mockReturnValue(false);

    await expect(
      orchestrator.generateSmartcommDraft(baseArgs),
    ).rejects.toMatchObject({ code: "AI_UNAVAILABLE" });
  });
});
