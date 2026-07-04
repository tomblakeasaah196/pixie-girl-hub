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
jest.mock("../../../src/services/notifications.service", () => ({
  notify: jest.fn(),
}));
jest.mock("../../../src/config/database", () => ({ query: jest.fn() }));

const repo = require("../../../src/modules/ai_insights/insights.repo");
const notifications = require("../../../src/services/notifications.service");
const db = require("../../../src/config/database");
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

describe("registry — Wave-3 batch 3 detectors", () => {
  test("pricing/margin_breach: below cost → critical + price_below_cost", async () => {
    repo.marginBreaches.mockResolvedValue([
      { variant_id: "v-1", product_id: "p-1", sku: "PXG-001", variant_name: "18in", cost_price_ngn: "10000.00", min_price_ngn: "12000.00", price_storefront_ngn: "8000.00", product_name: "HD Lace" },
    ]);
    const [f] = await det("pricing", "margin_breach").run({ brand: "pixiegirl" });
    expect(f).toMatchObject({
      module: "pricing",
      detector: "price_below_cost",
      severity: "critical", // 8000 < 10000*0.9
      amount_ngn: "8000.00",
      suppression_key: "margin:v-1",
    });
  });

  test("pricing/margin_breach: below floor but above cost → medium", async () => {
    repo.marginBreaches.mockResolvedValue([
      { variant_id: "v-2", product_id: "p-2", sku: "PXG-002", cost_price_ngn: "5000.00", min_price_ngn: "9000.00", price_storefront_ngn: "8000.00", product_name: "Body Wave" },
    ]);
    const [f] = await det("pricing", "margin_breach").run({ brand: "pixiegirl" });
    expect(f.detector).toBe("price_below_floor");
    expect(f.severity).toBe("medium");
  });

  test("retail_partners/settlement_unpaid: disputed → high + disputed detector", async () => {
    repo.unpaidPartnerSettlements.mockResolvedValue([
      { settlement_id: "s-1", settlement_number: "PXG-SET-1", partner_id: "pt-1", status: "disputed", total_partner_share_ngn: "40000.00", age_days: 3 },
    ]);
    const [f] = await det("retail_partners", "settlement_unpaid").run({ brand: "pixiegirl" });
    expect(f).toMatchObject({ detector: "settlement_disputed", severity: "high", suppression_key: "settle:s-1" });
  });

  test("tasks/overdue: urgent priority → high, per-business, /workspace drill", async () => {
    repo.overdueTasks.mockResolvedValue([
      { task_id: "tk-1", business: "faitlynhair", title: "Call supplier", priority: "urgent", assigned_to: "u-1", days_overdue: 2 },
    ]);
    const [f] = await det("tasks", "overdue").run();
    expect(f).toMatchObject({
      module: "tasks",
      business: "faitlynhair",
      severity: "high",
      drill_route: "/workspace",
      suppression_key: "task_overdue:tk-1",
    });
  });
});

describe("registry — Wave-3 batch 4 detectors", () => {
  test("stylist_programme/payout_unpaid: failed → high, cross-brand (null business)", async () => {
    repo.pendingStylistPayouts.mockResolvedValue([
      { payout_id: "po-1", payout_number: "PXS-PO-1", stylist_id: "st-1", amount_ngn: "60000.00", status: "failed", age_days: 1 },
    ]);
    const [f] = await det("stylist_programme", "payout_unpaid").run();
    expect(f).toMatchObject({
      module: "stylist_programme",
      detector: "payout_failed",
      business: null,
      severity: "high",
      suppression_key: "payout:po-1",
    });
  });

  test("sales_campaigns/campaign_stuck: live past end → ended_not_closed", async () => {
    repo.stuckCampaigns.mockResolvedValue([
      { campaign_id: "ca-1", name: "Black Friday", status: "live", starts_at: "x", ends_at: "y", days_past_end: 3 },
    ]);
    const [f] = await det("sales_campaigns", "campaign_stuck").run({ brand: "pixiegirl" });
    expect(f).toMatchObject({
      detector: "ended_not_closed",
      drill_route: "/sales-campaigns/ca-1",
      suppression_key: "campaign:ca-1",
    });
  });

  test("marketing/ad_no_conversions: big spend → high, carries business", async () => {
    repo.wastefulAdCampaigns.mockResolvedValue([
      { ad_campaign_id: "ad-1", name: "IG Retarget", business: "faitlynhair", spend_ngn: "80000.00", conversions: 0 },
    ]);
    const [f] = await det("marketing", "ad_no_conversions").run();
    expect(f).toMatchObject({ business: "faitlynhair", severity: "high", amount_ngn: "80000.00", suppression_key: "ad_waste:ad-1" });
  });

  test("smartcomm/unanswered: >24h waiting → high", async () => {
    repo.unansweredThreads.mockResolvedValue([
      { channel_id: "ch-1", business: "pixiegirl", external_platform: "whatsapp", name: null, last_at: "x", hours_waiting: 30 },
    ]);
    const [f] = await det("smartcomm", "unanswered").run();
    expect(f).toMatchObject({
      module: "smartcomm",
      severity: "high",
      drill_route: "/smartcomm?channel=ch-1",
      suppression_key: "unanswered:ch-1",
    });
  });
});

describe("registry — Wave-3 batch 5 detectors (final 6 modules)", () => {
  test("social_media/post_failed: failed status", async () => {
    repo.failedSocialPosts.mockResolvedValue([
      { post_id: "sp-1", business: "pixiegirl", status: "failed", scheduled_for: "x" },
    ]);
    const [f] = await det("social_media", "post_failed").run();
    expect(f).toMatchObject({ module: "social_media", detector: "post_failed", business: "pixiegirl", suppression_key: "post:sp-1" });
  });

  test("social_media/token_expiring: <=1 day → high", async () => {
    repo.expiringSocialTokens.mockResolvedValue([
      { account_id: "sa-1", business: "faitlynhair", platform: "instagram", token_expires_at: "x", days_left: 1 },
    ]);
    const [f] = await det("social_media", "token_expiring").run();
    expect(f).toMatchObject({ detector: "token_expiring", severity: "high", suppression_key: "token:sa-1" });
  });

  test("storefront/payment_failed: recent → high, drills to order", async () => {
    repo.failedStorefrontPayments.mockResolvedValue([
      { payment_id: "pf-1", order_id: "o-1", amount_ngn: "25000.00", method: "paystack_card", failure_reason: "declined", hours_ago: 2 },
    ]);
    const [f] = await det("storefront", "payment_failed").run({ brand: "pixiegirl" });
    expect(f).toMatchObject({ module: "storefront", severity: "high", amount_ngn: "25000.00", drill_route: "/sales/orders/o-1", suppression_key: "pay_fail:pf-1" });
  });

  test("iam_security/access_review_overdue: cross-brand, >=30d → high", async () => {
    repo.overdueAccessReviews.mockResolvedValue([
      { review_id: "ar-1", status: "open", due_date: "x", days_overdue: 45 },
    ]);
    const [f] = await det("iam_security", "access_review_overdue").run();
    expect(f).toMatchObject({ business: null, severity: "high", drill_route: "/iam-security/reviews", suppression_key: "review:ar-1" });
  });

  test("payroll/contract_expiring: <=7d → high, business via join", async () => {
    repo.expiringContracts.mockResolvedValue([
      { contract_id: "ct-1", profile_id: "pr-1", contract_type: "full_time", effective_to: "x", business: "pixiegirl", days_left: 5 },
    ]);
    const [f] = await det("payroll", "contract_expiring").run();
    expect(f).toMatchObject({ business: "pixiegirl", severity: "high", suppression_key: "contract:ct-1" });
  });

  test("customer_onboarding/onboarding_stalled: unprocessed submission", async () => {
    repo.stalledOnboarding.mockResolvedValue([
      { submission_id: "ob-1", business: "faitlynhair", created_at: "x", age_days: 9 },
    ]);
    const [f] = await det("customer_onboarding", "onboarding_stalled").run();
    expect(f).toMatchObject({ module: "customer_onboarding", business: "faitlynhair", severity: "medium", suppression_key: "onboard:ob-1" });
  });

  test("catalogue/visible_unbuyable: visible product, no priced variant", async () => {
    repo.unbuyableProducts.mockResolvedValue([
      { product_id: "pd-1", name: "HD Lace 20in" },
    ]);
    const [f] = await det("catalogue", "visible_unbuyable").run({ brand: "pixiegirl" });
    expect(f).toMatchObject({ module: "catalogue", drill_route: "/catalogue/styled/pd-1", suppression_key: "unbuyable:pd-1" });
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

  test("notifies the CEO's bell for a NEW urgent finding only", async () => {
    repo.enabledModules.mockResolvedValue(["invoicing"]);
    repo.overdueInvoices.mockResolvedValue([
      { invoice_id: "inv-9", customer_contact_id: "c", net_due_ngn: "1.00", days_overdue: 95 }, // critical
    ]);
    // raise returns the inserted row (a genuinely new insight)…
    repo.raise.mockImplementation(async ({ insight }) => ({
      insight_id: "ins-1",
      severity: insight.severity,
      business: insight.business,
      title: insight.title,
      body: insight.body,
      drill_route: insight.drill_route,
    }));
    db.query.mockResolvedValue({ rows: [{ user_id: "ceo-1" }] });

    await service.runDetectorSweep();

    expect(notifications.notify).toHaveBeenCalled();
    expect(notifications.notify.mock.calls[0][0]).toMatchObject({
      user_id: "ceo-1",
      type: "insight",
      priority: "urgent",
      reference_type: "ai_insight",
      reference_id: "ins-1",
    });
  });

  test("does NOT notify when raise suppressed the finding (already open)", async () => {
    repo.enabledModules.mockResolvedValue(["invoicing"]);
    repo.overdueInvoices.mockResolvedValue([
      { invoice_id: "inv-9", customer_contact_id: "c", net_due_ngn: "1.00", days_overdue: 95 },
    ]);
    repo.raise.mockResolvedValue(null); // suppressed duplicate → no new row
    await service.runDetectorSweep();
    expect(notifications.notify).not.toHaveBeenCalled();
  });
});
