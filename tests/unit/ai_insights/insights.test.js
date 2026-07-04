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

describe("registry — Wave-3 fan-out detectors", () => {
  test("hr_attendance/off_site: high when far, per-business, dated suppression", async () => {
    repo.offsiteAttendance.mockResolvedValue([
      { business: "pixiegirl", profile_id: "p-1", work_date: "2026-07-01", offsite_distance_m: "1500.00" },
    ]);
    const [f] = await det("hr_attendance", "off_site").run();
    expect(f).toMatchObject({
      module: "hr_attendance",
      business: "pixiegirl",
      severity: "high",
      source_id: "p-1",
      suppression_key: "offsite:p-1:2026-07-01",
    });
  });

  test("purchasing/delivery_overdue: severity escalates with days", async () => {
    repo.overduePurchaseOrders.mockResolvedValue([
      { po_id: "po-1", po_number: "PXG-PO-1", supplier_id: "s-1", total_ngn: "500000.00", days_overdue: 40 },
    ]);
    const [f] = await det("purchasing", "delivery_overdue").run({ brand: "pixiegirl" });
    expect(f).toMatchObject({
      module: "purchasing",
      severity: "critical",
      amount_ngn: "500000.00",
      drill_route: "/purchasing",
      suppression_key: "po_overdue:po-1",
    });
  });

  test("logistics/delivery_problem: lost → critical + failed detector key", async () => {
    repo.problemDeliveries.mockResolvedValue([
      { delivery_id: "d-1", delivery_number: "PXG-DEL-1", order_id: "o-1", status: "lost", pod_amount_expected_ngn: "20000.00", overdue_hours: 0 },
    ]);
    const [f] = await det("logistics", "delivery_problem").run({ brand: "pixiegirl" });
    expect(f).toMatchObject({
      module: "logistics",
      detector: "delivery_failed",
      severity: "critical",
      suppression_key: "del:d-1",
    });
  });

  test("logistics/delivery_problem: in-flight past ETA → overdue detector key", async () => {
    repo.problemDeliveries.mockResolvedValue([
      { delivery_id: "d-2", delivery_number: "PXG-DEL-2", order_id: "o-2", status: "in_transit", pod_amount_expected_ngn: null, overdue_hours: 60 },
    ]);
    const [f] = await det("logistics", "delivery_problem").run({ brand: "pixiegirl" });
    expect(f.detector).toBe("delivery_overdue");
    expect(f.severity).toBe("high"); // >= 48h
  });

  test("expenses/advance_unsettled: overdue_settlement status → high + overdue key", async () => {
    repo.unsettledAdvances.mockResolvedValue([
      { advance_id: "a-1", advance_number: "PXG-ADV-1", purpose: "Fuel", status: "overdue_settlement", amount_ngn: "30000.00", age_days: 20 },
    ]);
    const [f] = await det("expenses", "advance_unsettled").run({ brand: "pixiegirl" });
    expect(f).toMatchObject({
      module: "expenses",
      detector: "advance_overdue",
      severity: "high",
      amount_ngn: "30000.00",
      suppression_key: "adv:a-1",
    });
  });
});

describe("registry — Wave-3 batch 2 detectors", () => {
  test("sales/fulfillment_delayed: paid+undispatched escalates by age", async () => {
    repo.fulfillmentDelayedOrders.mockResolvedValue([
      { order_id: "o-1", order_number: "PXG-SO-1", contact_id: "c-1", total_ngn: "90000.00", status: "paid", age_days: 15 },
    ]);
    const [f] = await det("sales", "fulfillment_delayed").run({ brand: "pixiegirl" });
    expect(f).toMatchObject({
      module: "sales",
      severity: "critical", // >= 14d
      amount_ngn: "90000.00",
      drill_route: "/sales/orders/o-1",
      suppression_key: "fulfil:o-1",
    });
  });

  test("crm/deal_stalled: >=30d in stage → high", async () => {
    repo.stalledDeals.mockResolvedValue([
      { deal_id: "d-1", title: "HD Lace 18in", current_stage_id: "st-1", expected_value_ngn: "250000.00", days_in_stage: 45 },
    ]);
    const [f] = await det("crm", "deal_stalled").run({ brand: "pixiegirl" });
    expect(f).toMatchObject({ module: "crm", severity: "high", drill_route: "/crm/deals/d-1", suppression_key: "stalled:d-1" });
  });

  test("production/run_delayed: arrival overdue escalates", async () => {
    repo.delayedProductionRuns.mockResolvedValue([
      { run_id: "r-1", run_number: "PXG-RUN-1", status: "in_transit", total_landed_cost_ngn: "1200000.00", days_late: 9 },
    ]);
    const [f] = await det("production", "run_delayed").run({ brand: "pixiegirl" });
    expect(f).toMatchObject({ module: "production", severity: "high", suppression_key: "run_late:r-1" });
    expect(f.amount_ngn).toBe("1200000.00");
  });

  test("accounting/journal_draft_aging: unposted draft flagged", async () => {
    repo.agingDraftJournals.mockResolvedValue([
      { entry_id: "j-1", entry_number: "PXG-JE-1", description: "Accrual", age_days: 40 },
    ]);
    const [f] = await det("accounting", "journal_draft_aging").run({ brand: "pixiegirl" });
    expect(f).toMatchObject({ module: "accounting", severity: "high", suppression_key: "je_draft:j-1" });
  });

  test("retention/churn_risk: critical band → critical, drills to contact", async () => {
    repo.churnRiskContacts.mockResolvedValue([
      { score_id: "s-1", contact_id: "c-9", risk_score: 88, risk_band: "critical", computed_at: "2026-07-01" },
    ]);
    const [f] = await det("retention", "churn_risk").run({ brand: "pixiegirl" });
    expect(f).toMatchObject({
      module: "retention",
      severity: "critical",
      drill_route: "/contacts/c-9",
      suppression_key: "churn:c-9",
    });
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
