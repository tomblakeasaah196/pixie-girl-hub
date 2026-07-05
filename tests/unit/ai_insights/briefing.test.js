"use strict";

// Tier-2 briefing narration (V2.2 §6.30): the daily briefing narrates the
// summarised counts with the LLM only when a module opted in AND the feature is
// usable AND a vendor is configured — otherwise it keeps the deterministic
// text. Everything external is mocked, so these are pure-logic tests.

jest.mock("../../../src/config/database", () => ({ query: jest.fn() }));
jest.mock("../../../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../../src/config/env", () => ({
  config: { PRAXIS_LLM_VENDOR: "deepseek" },
}));
jest.mock("../../../src/config/brands", () => ({ BRANDS: ["pixiegirl"] }));
jest.mock("../../../src/modules/ai_insights/insights.service", () => ({
  summary: jest.fn(),
}));
jest.mock("../../../src/modules/ai_insights/insights.repo", () => ({
  narrationModules: jest.fn(),
  topOpenInsights: jest.fn(),
  insertBriefingRefs: jest.fn(),
}));
jest.mock("../../../src/modules/ai_governance/governance.service", () => ({
  canUseFeature: jest.fn(),
  recordUsage: jest.fn(),
}));
jest.mock("../../../src/services/llm.service", () => ({
  resolveVendor: jest.fn(),
  chat: jest.fn(),
}));

const db = require("../../../src/config/database");
const insights = require("../../../src/modules/ai_insights/insights.service");
const insightsRepo = require("../../../src/modules/ai_insights/insights.repo");
const governance = require("../../../src/modules/ai_governance/governance.service");
const llm = require("../../../src/services/llm.service");
const { runDailyAiBriefing } = require("../../../src/jobs/schedulers/ai-briefing");

// query() is called: 1) CEO lookup, 2..) the briefing INSERT(s).
function insertCall() {
  return db.query.mock.calls.find((c) =>
    String(c[0]).includes("INSERT INTO shared.ai_briefings"),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockImplementation((sql) => {
    if (String(sql).includes("FROM shared.users"))
      return Promise.resolve({ rows: [{ user_id: "ceo-1" }] });
    return Promise.resolve({ rows: [] });
  });
  insights.summary.mockResolvedValue({ invoicing: { open: 2, urgent: 1 } });
});

test("no module opted into narration → deterministic briefing", async () => {
  insightsRepo.narrationModules.mockResolvedValue([]);
  const res = await runDailyAiBriefing();
  expect(res.narrated).toBe(0);
  const params = insertCall()[1];
  expect(params[5]).toBe("deterministic"); // provider
  expect(params[3]).toMatch(/^Good morning/); // deterministic text
  expect(llm.chat).not.toHaveBeenCalled();
});

test("narration on but no vendor configured → deterministic", async () => {
  insightsRepo.narrationModules.mockResolvedValue(["invoicing"]);
  governance.canUseFeature.mockResolvedValue({ ok: true });
  llm.resolveVendor.mockResolvedValue(null);
  const res = await runDailyAiBriefing();
  expect(res.narrated).toBe(0);
  expect(insertCall()[1][5]).toBe("deterministic");
});

test("narration on + vendor + budget ok → AI text, metered", async () => {
  insightsRepo.narrationModules.mockResolvedValue(["invoicing"]);
  governance.canUseFeature.mockResolvedValue({ ok: true });
  llm.resolveVendor.mockResolvedValue({
    vendor: "deepseek",
    cost_per_1k_input_tokens: "0",
    cost_per_1k_output_tokens: "0",
  });
  llm.chat.mockResolvedValue({
    content: "Two invoices are overdue; chase the urgent one first.",
    model: "deepseek-chat",
    usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
  });

  const res = await runDailyAiBriefing();

  expect(res.narrated).toBe(1);
  const params = insertCall()[1];
  expect(params[5]).toBe("deepseek"); // provider
  expect(params[3]).toBe("Two invoices are overdue; chase the urgent one first.");
  expect(params[7]).toBe(70); // tokens
  expect(governance.recordUsage).toHaveBeenCalledWith(
    expect.objectContaining({
      usage: expect.objectContaining({ call_type: "insight_narration" }),
    }),
  );
});

test("budget hard-capped → deterministic (tier-1 keeps running)", async () => {
  insightsRepo.narrationModules.mockResolvedValue(["invoicing"]);
  governance.canUseFeature.mockResolvedValue({ ok: false, reason: "BUDGET_HARD_CAP" });
  const res = await runDailyAiBriefing();
  expect(res.narrated).toBe(0);
  expect(insertCall()[1][5]).toBe("deterministic");
  expect(llm.resolveVendor).not.toHaveBeenCalled();
});

test("links the briefing to its top open findings (paragraph → alert refs)", async () => {
  insightsRepo.narrationModules.mockResolvedValue([]);
  db.query.mockImplementation((sql) => {
    if (String(sql).includes("FROM shared.users"))
      return Promise.resolve({ rows: [{ user_id: "ceo-1" }] });
    if (String(sql).includes("INSERT INTO shared.ai_briefings"))
      return Promise.resolve({ rows: [{ briefing_id: "b-1" }] });
    return Promise.resolve({ rows: [] });
  });
  insightsRepo.topOpenInsights.mockResolvedValue([
    { insight_id: "i-1", module: "invoicing", title: "Invoice overdue 12 days", severity: "high" },
  ]);
  await runDailyAiBriefing();
  expect(insightsRepo.topOpenInsights).toHaveBeenCalledWith({
    business: "pixiegirl",
    limit: 10,
  });
  expect(insightsRepo.insertBriefingRefs).toHaveBeenCalledWith({
    briefing_id: "b-1",
    refs: [
      { insight_id: "i-1", module: "invoicing", title: "Invoice overdue 12 days", severity: "high" },
    ],
  });
});
