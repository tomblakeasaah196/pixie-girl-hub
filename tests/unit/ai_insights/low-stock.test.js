"use strict";

// Stock insight sweep (J-1): reorder + negative-stock signals, per-brand
// auto-resolve, urgent notify, and the transient-error safety (a failed brand
// query must never wipe that brand's live alerts). All I/O mocked.

jest.mock("../../../src/config/database", () => ({ query: jest.fn() }));
jest.mock("../../../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../../src/config/brands", () => ({ BRANDS: ["pixiegirl"] }));
jest.mock("../../../src/modules/ai_insights/insights.service", () => ({
  raiseInsight: jest.fn(),
  notifyUrgent: jest.fn(),
}));
jest.mock("../../../src/modules/ai_insights/insights.repo", () => ({
  autoResolveStale: jest.fn(),
}));
jest.mock("../../../src/modules/ai_insights/insights.events", () => ({
  emit: jest.fn(),
}));

const db = require("../../../src/config/database");
const service = require("../../../src/modules/ai_insights/insights.service");
const repo = require("../../../src/modules/ai_insights/insights.repo");
const { runLowStockAlerts } = require("../../../src/jobs/schedulers/low-stock");

beforeEach(() => {
  jest.clearAllMocks();
  repo.autoResolveStale.mockResolvedValue(0);
  service.raiseInsight.mockResolvedValue(null);
});

test("negative stock → negative_stock detector, always critical", async () => {
  db.query.mockResolvedValue({
    rows: [
      { variant_id: "v-1", location_id: "l-1", on_hand: -2, reorder_point: 0, product_id: "p-1", sku: "PXG-001" },
    ],
  });
  await runLowStockAlerts();
  const insight = service.raiseInsight.mock.calls[0][0];
  expect(insight).toMatchObject({
    module: "stock",
    detector: "negative_stock",
    business: "pixiegirl",
    severity: "critical",
    suppression_key: "v-1:l-1:negative",
  });
  expect(insight.title).toContain("negative stock");
});

test("reorder signal keeps the legacy :low_stock key + severity ladder", async () => {
  db.query.mockResolvedValue({
    rows: [
      { variant_id: "v-2", location_id: "l-1", on_hand: 0, reorder_point: 10, product_id: "p-2", sku: "PXG-002" }, // critical
      { variant_id: "v-3", location_id: "l-1", on_hand: 4, reorder_point: 10, product_id: "p-3", sku: "PXG-003" }, // high (4*2<=10)
      { variant_id: "v-4", location_id: "l-1", on_hand: 9, reorder_point: 10, product_id: "p-4", sku: "PXG-004" }, // medium
    ],
  });
  await runLowStockAlerts();
  const calls = service.raiseInsight.mock.calls.map((c) => c[0]);
  expect(calls[0]).toMatchObject({ detector: "reorder_point", severity: "critical", suppression_key: "v-2:l-1:low_stock" });
  expect(calls[1].severity).toBe("high");
  expect(calls[2].severity).toBe("medium");
});

test("auto-resolves the brand's stale stock findings with the live keys", async () => {
  db.query.mockResolvedValue({
    rows: [
      { variant_id: "v-1", location_id: "l-1", on_hand: 2, reorder_point: 10, product_id: "p-1", sku: "S" },
    ],
  });
  repo.autoResolveStale.mockResolvedValue(3);
  const res = await runLowStockAlerts();
  expect(repo.autoResolveStale).toHaveBeenCalledWith({
    module: "stock",
    business: "pixiegirl",
    liveKeys: ["v-1:l-1:low_stock"],
  });
  expect(res.resolved).toBe(3);
});

test("brand query error → no raise, NO auto-resolve for that brand", async () => {
  db.query.mockRejectedValue(new Error("boom"));
  await runLowStockAlerts();
  expect(service.raiseInsight).not.toHaveBeenCalled();
  expect(repo.autoResolveStale).not.toHaveBeenCalled();
});

test("genuinely-new findings are passed to notifyUrgent", async () => {
  db.query.mockResolvedValue({
    rows: [
      { variant_id: "v-1", location_id: "l-1", on_hand: -1, reorder_point: 0, product_id: "p-1", sku: "S" },
    ],
  });
  service.raiseInsight.mockResolvedValue({ insight_id: "i-1", severity: "critical" });
  await runLowStockAlerts();
  expect(service.notifyUrgent).toHaveBeenCalledWith([
    { insight_id: "i-1", severity: "critical" },
  ]);
});
