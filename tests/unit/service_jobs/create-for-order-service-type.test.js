"use strict";

/**
 * createForOrder — job opening from an order. Covers two behaviours:
 *
 *   1. A styled-product order must open as Styling, not the arbitrary
 *      display_order=1 default (Installation). getDefaultServiceType returns the
 *      first active type ORDER BY display_order, display_name, and 'installation'
 *      seeds at display_order=1, so styled jobs (none of which set a per-style
 *      default_service_type_id) used to come out mislabelled. Genuine service
 *      lines (styled_id NULL) keep the brand default.
 *
 *   2. One job PER HAIR. Every styling line becomes `quantity` independently
 *      assignable jobs, and creation is idempotent per line (only the shortfall
 *      is opened), so a multi-hair order can be split across stylists and the
 *      subscribers/backfill can re-run without duplicating.
 *
 * Pure-unit: database/transaction, audit, events and the repo are stubbed.
 */

jest.mock("../../../src/config/database", () => ({
  transaction: (fn) => fn({}),
  query: jest.fn(),
  ex: () => jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/modules/service_jobs/service-jobs.events", () => ({
  emit: jest.fn(),
  on: jest.fn(),
}));

const INSTALLATION = {
  service_type_id: "st-installation",
  service_key: "installation",
  standard_cost_ngn: 35000,
  standard_turnaround_days: 1,
};
const STYLING = {
  service_type_id: "st-styling",
  service_key: "styling",
  standard_cost_ngn: 15000,
  standard_turnaround_days: 1,
};

jest.mock("../../../src/modules/service_jobs/service-jobs.repo", () => ({
  allStudioLines: jest.fn(),
  countJobsForLine: jest.fn(),
  getDefaultServiceType: jest.fn(),
  getServiceTypeByKey: jest.fn(),
  getStyledDNA: jest.fn(),
  nextNumber: jest.fn(),
  createServiceJob: jest.fn(),
  setServiceJobStatus: jest.fn(),
}));

const repo = require("../../../src/modules/service_jobs/service-jobs.repo");
const svc = require("../../../src/modules/service_jobs/service-jobs.service");

const ORDER = { order_id: "order-1", contact_id: "contact-1" };
const styledLine = (over = {}) => ({
  line_id: "line-1",
  line_kind: "styled",
  styled_id: "styled-1",
  variant_id: "variant-1",
  quantity: 1,
  notes: null,
  ...over,
});
const jobArgs = () => repo.createServiceJob.mock.calls.map((c) => c[0].job);

beforeEach(() => {
  jest.clearAllMocks();
  // Faitlyn's default (getDefaultServiceType) lands on Installation — the exact
  // arbitrary pick that produced the mislabelling bug.
  repo.getDefaultServiceType.mockResolvedValue({ ...INSTALLATION });
  repo.getServiceTypeByKey.mockImplementation(async ({ key }) =>
    key === "styling" ? { ...STYLING } : null,
  );
  repo.getStyledDNA.mockResolvedValue({
    styled_id: "styled-1",
    base_variant_id: "variant-1",
    style_addon_price_ngn: 20000,
    default_service_type_id: null, // the real-world case: unconfigured
    default_recipe_id: null,
    sop_steps: null,
    standard_turnaround_days: null,
  });
  repo.countJobsForLine.mockResolvedValue(0); // nothing opened yet
  repo.nextNumber.mockResolvedValue("FLH-JOB-0001");
  repo.createServiceJob.mockResolvedValue({
    job_id: "job-1",
    job_number: "FLH-JOB-0001",
  });
  repo.setServiceJobStatus.mockResolvedValue({});
});

describe("createForOrder — styled products open as Styling, not Installation", () => {
  it("uses the Styling type for a styled line, never the display_order=1 default", async () => {
    repo.allStudioLines.mockResolvedValue([styledLine()]);

    await svc.createForOrder({ brand: "faitlynhair", order: ORDER });

    expect(repo.getServiceTypeByKey).toHaveBeenCalledWith(
      expect.objectContaining({ brand: "faitlynhair", key: "styling" }),
    );
    expect(jobArgs()[0].service_type_id).toBe("st-styling");
    expect(jobArgs()[0].service_type_id).not.toBe("st-installation");
  });

  it("leaves a genuine (non-styled) service line on the brand default", async () => {
    repo.allStudioLines.mockResolvedValue([
      { line_id: "line-2", line_kind: "service", styled_id: null, quantity: 1, unit_price_ngn: 69000, notes: null },
    ]);

    await svc.createForOrder({ brand: "faitlynhair", order: ORDER });

    expect(repo.getServiceTypeByKey).not.toHaveBeenCalled();
    expect(repo.getStyledDNA).not.toHaveBeenCalled();
    expect(jobArgs()[0].service_type_id).toBe("st-installation");
  });

  it("prices a styled job from the Styling type when the style carries no add-on price", async () => {
    repo.allStudioLines.mockResolvedValue([styledLine({ variant_id: null })]);
    repo.getStyledDNA.mockResolvedValue({
      styled_id: "styled-1",
      style_addon_price_ngn: null, // no add-on → fall back to the type's cost
      default_service_type_id: null,
    });

    await svc.createForOrder({ brand: "faitlynhair", order: ORDER });

    expect(jobArgs()[0].service_type_id).toBe("st-styling");
    // Styling's 15,000 — not Installation's 35,000.
    expect(Number(jobArgs()[0].agreed_cost_ngn)).toBe(15000);
  });

  it("still no-ops on a brand with no styling services (e.g. PXG)", async () => {
    repo.getDefaultServiceType.mockResolvedValue(null); // PXG runs no services
    repo.getServiceTypeByKey.mockResolvedValue(null);
    repo.allStudioLines.mockResolvedValue([styledLine({ variant_id: null })]);

    const res = await svc.createForOrder({ brand: "pixiegirl", order: ORDER });

    expect(res).toBeNull();
    expect(repo.createServiceJob).not.toHaveBeenCalled();
  });
});

describe("createForOrder — one job per hair (multi-hair fan-out)", () => {
  it("opens one job per unit of a quantity>1 styled line", async () => {
    repo.allStudioLines.mockResolvedValue([styledLine({ quantity: 3 })]);

    const res = await svc.createForOrder({ brand: "faitlynhair", order: ORDER });

    expect(repo.createServiceJob).toHaveBeenCalledTimes(3);
    expect(res).toHaveLength(3);
    // Each hair is its own Styling job pointing at the same line.
    for (const job of jobArgs()) {
      expect(job.service_type_id).toBe("st-styling");
      expect(job.sales_order_line_id).toBe("line-1");
    }
  });

  it("opens one job per line for a multi-line order", async () => {
    repo.allStudioLines.mockResolvedValue([
      styledLine({ line_id: "line-1", styled_id: "styled-1", quantity: 1 }),
      styledLine({ line_id: "line-2", styled_id: "styled-2", quantity: 1 }),
    ]);

    await svc.createForOrder({ brand: "faitlynhair", order: ORDER });

    expect(repo.createServiceJob).toHaveBeenCalledTimes(2);
    expect(jobArgs().map((j) => j.sales_order_line_id).sort()).toEqual([
      "line-1",
      "line-2",
    ]);
  });

  it("is idempotent per line — only opens the missing hairs", async () => {
    // Line wants 3 hairs but 2 jobs already exist → open just 1 more.
    repo.allStudioLines.mockResolvedValue([styledLine({ quantity: 3 })]);
    repo.countJobsForLine.mockResolvedValue(2);

    await svc.createForOrder({ brand: "faitlynhair", order: ORDER });

    expect(repo.createServiceJob).toHaveBeenCalledTimes(1);
  });

  it("no-ops when a line is already fully covered", async () => {
    repo.allStudioLines.mockResolvedValue([styledLine({ quantity: 2 })]);
    repo.countJobsForLine.mockResolvedValue(2);

    const res = await svc.createForOrder({ brand: "faitlynhair", order: ORDER });

    expect(repo.createServiceJob).not.toHaveBeenCalled();
    expect(res).toBeNull();
  });

  it("returns null and opens nothing for a plain product order (no studio lines)", async () => {
    repo.allStudioLines.mockResolvedValue([]);

    const res = await svc.createForOrder({ brand: "faitlynhair", order: ORDER });

    expect(res).toBeNull();
    expect(repo.createServiceJob).not.toHaveBeenCalled();
  });
});
