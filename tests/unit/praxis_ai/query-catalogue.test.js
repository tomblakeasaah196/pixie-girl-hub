"use strict";

/**
 * Praxis Query Catalogue — insights_open (§8.2). DeepSeek kept picking
 * insights_open over the more specific insights_list even when the user
 * explicitly asked for root causes / affected records, so insights_open now
 * carries a sample of the underlying records itself — the answer is correct
 * regardless of which of the two tools the model reaches for.
 */

const mockInsightsRepo = { summary: jest.fn(), list: jest.fn() };
jest.mock("../../../src/modules/ai_insights/insights.repo", () => mockInsightsRepo);

const catalogue = require("../../../src/modules/praxis_ai/query-catalogue");

beforeEach(() => jest.clearAllMocks());

describe("insights_open", () => {
  test("returns the per-module summary AND a sample of the underlying records", async () => {
    mockInsightsRepo.summary.mockResolvedValue([
      { module: "sales", open: 27, urgent: 27 },
    ]);
    mockInsightsRepo.list.mockResolvedValue([
      { module: "sales", title: "Order 1234 paid but not dispatched (7d)" },
    ]);

    const entry = catalogue.get("insights_open");
    const result = await entry.run({ brand: "faitlynhair", args: {} });

    expect(mockInsightsRepo.summary).toHaveBeenCalledWith({
      business: "faitlynhair",
    });
    // The sample spans ALL modules ordered by recency, so it must be large
    // enough that a single busy module (e.g. 27 undispatched sales orders)
    // isn't partly pushed out of the sample by other modules' findings.
    expect(mockInsightsRepo.list).toHaveBeenCalledWith({
      business: "faitlynhair",
      status: "open",
      page: 1,
      page_size: 60,
    });
    expect(result.summary).toEqual([{ module: "sales", open: 27, urgent: 27 }]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].title).toMatch(/Order 1234/);
  });
});
