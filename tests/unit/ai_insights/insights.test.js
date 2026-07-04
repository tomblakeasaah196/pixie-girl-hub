"use strict";

// Unit coverage for the unified AI Insights engine (V2.2 §6.30):
//   1. Registry detectors emit correctly-shaped, correctly-severity'd findings.
//   2. The legacy {category,row} ingest adapter maps onto unified insights.
//   3. The detector sweep runs ONLY modules enabled in the AI Control matrix.
//
// The repo (all DB access) is mocked, so these are pure-logic tests.

jest.mock("../../../src/modules/ai_insights/insights.repo");
jest.mock("../../../src/modules/ai_insights/insights.events", () => ({
  emit: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../../src/config/brands", () => ({
  listBrands: () => ["pixiegirl", "faitlynhair"],
}));

const repo = require("../../../src/modules/ai_insights/insights.repo");
const registry = require("../../../src/modules/ai_insights/insights.registry");
const service = require("../../../src/modules/ai_insights/insights.service");

const det = (module, detector) =>
  registry.DETECTORS.find((d) => d.module === module && d.detector === detector);

beforeEach(() => jest.clearAllMocks());

describe("registry — invoicing/overdue detector", () => {
  test("maps an overdue invoice to a unified finding with escalating severity", async () => {
    repo.overdueInvoices.mockResolvedValue([
      { invoice_id: "inv-1", customer_contact_id: "c-1", net_due_ngn: "125000.00", days_overdue: 95 },
    ]);
    const [f] = await det("invoicing", "overdue").run({ brand: "pixiegirl" });
    expect(f).toMatchObject({
      module: "invoicing",
      detector: "overdue_long", // >= 60d
      business: "pixiegirl",
      severity: "critical", // >= 90d
      amount_ngn: "125000.00",
      source_table: "invoices",
      source_id: "inv-1",
      drill_route: "/invoicing/inv-1",
      suppression_key: "overdue:inv-1",
    });
    expect(f.context.days_overdue).toBe(95);
  });

  test.each([
    [10, "low", "overdue"],
    [40, "medium", "overdue"],
    [65, "high", "overdue_long"],
    [120, "critical", "overdue_long"],
  ])("%i days overdue → %s / %s", async (days, severity, detector) => {
    repo.overdueInvoices.mockResolvedValue([
      { invoice_id: "x", customer_contact_id: "c", net_due_ngn: "1.00", days_overdue: days },
    ]);
    const [f] = await det("invoicing", "overdue").run({ brand: "pixiegirl" });
    expect(f.severity).toBe(severity);
    expect(f.detector).toBe(detector);
  });
});

describe("registry — service_jobs/no_sale_linked detector", () => {
  test("high severity when the expected amount is large", async () => {
    repo.unlinkedServiceJobs.mockResolvedValue([
      { job_id: "j-1", job_number: "SJ-1", actual_cost_ngn: "80000.00", agreed_cost_ngn: null },
    ]);
    const [f] = await det("service_jobs", "no_sale_linked").run({ brand: "faitlynhair" });
    expect(f).toMatchObject({ module: "service_jobs", severity: "high", suppression_key: "no_sale:j-1" });
    expect(f.amount_ngn).toBe("80000.00");
  });
  test("medium severity for a small job", async () => {
    repo.unlinkedServiceJobs.mockResolvedValue([
      { job_id: "j-2", job_number: "SJ-2", actual_cost_ngn: "5000.00" },
    ]);
    const [f] = await det("service_jobs", "no_sale_linked").run({ brand: "faitlynhair" });
    expect(f.severity).toBe("medium");
  });
});

describe("registry — intercompany detector is cross-brand", () => {
  test("emits a finding with null business", async () => {
    repo.staleIntercompany.mockResolvedValue([
      { ic_transaction_id: "ic-1", seller_brand: "pixiegirl", buyer_brand: "faitlynhair", amount_ngn: "10.00", age_days: 40 },
    ]);
    const [f] = await det("intercompany", "pending_too_long").run();
    expect(f.business).toBeNull();
    expect(f.severity).toBe("critical"); // >= 30d
    expect(f.suppression_key).toBe("stale:ic-1");
  });
});

describe("service.raise — legacy category adapter", () => {
  test("stock category maps to module stock / detector reorder_point", async () => {
    repo.raise.mockResolvedValue(undefined);
    await service.raise({
      category: "stock",
      row: {
        business: "pixiegirl",
        product_id: "p-1",
        variant_id: "v-1",
        current_stock: 2,
        reorder_point: 10,
        severity: "high",
        suppression_key: "v-1:loc:low_stock",
      },
    });
    expect(repo.raise).toHaveBeenCalledTimes(1);
    const { insight } = repo.raise.mock.calls[0][0];
    expect(insight).toMatchObject({
      module: "stock",
      detector: "reorder_point",
      business: "pixiegirl",
      severity: "high",
      suppression_key: "v-1:loc:low_stock",
    });
  });

  test("unknown category throws BAD_CATEGORY", async () => {
    await expect(service.raise({ category: "nope", row: {} })).rejects.toMatchObject({
      code: "BAD_CATEGORY",
    });
  });
});

describe("service.runDetectorSweep — gated by AI Control matrix", () => {
  test("runs only enabled modules and skips the rest", async () => {
    repo.enabledModules.mockResolvedValue(["invoicing"]); // approvals/intercompany/service_jobs OFF
    repo.overdueInvoices.mockResolvedValue([
      { invoice_id: "inv-1", customer_contact_id: "c", net_due_ngn: "1.00", days_overdue: 5 },
    ]);
    repo.raise.mockResolvedValue(undefined);

    const result = await service.runDetectorSweep();

    // invoicing is brand-scoped → ran once per brand (2 brands) → 2 findings.
    expect(result).toEqual({ invoicing: 2 });
    expect(repo.raise).toHaveBeenCalledTimes(2);
    // Disabled modules' source reads never fired.
    expect(repo.staleIntercompany).not.toHaveBeenCalled();
    expect(repo.staleApprovals).not.toHaveBeenCalled();
    expect(repo.unlinkedServiceJobs).not.toHaveBeenCalled();
  });

  test("no enabled modules → empty result, nothing raised", async () => {
    repo.enabledModules.mockResolvedValue([]);
    const result = await service.runDetectorSweep();
    expect(result).toEqual({});
    expect(repo.raise).not.toHaveBeenCalled();
  });
});
