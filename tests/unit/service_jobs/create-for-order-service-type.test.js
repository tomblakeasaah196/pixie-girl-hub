"use strict";

/**
 * Regression: a job auto-opened from a styled-product order must open as
 * Styling — not the arbitrary display_order=1 default (Installation).
 *
 * Root cause this guards: createForOrder used getDefaultServiceType() as the
 * fallback service type. That helper returns the first active service type
 * `ORDER BY display_order, display_name` — and 'installation' seeds at
 * display_order=1, so every styled-product job (none of which set a per-style
 * `default_service_type_id`) came out mislabelled "Installation".
 *
 * The fix: a styled line (styled_id set) resolves its type via
 * getServiceTypeByKey('styling'); a genuine service line (styled_id NULL) keeps
 * the brand default, unchanged. The job's cost/turnaround defaults are derived
 * from the type actually used.
 *
 * Pure-unit: database/transaction, audit, events and the repo are stubbed —
 * no DB, no HTTP.
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
  serviceJobExistsForOrder: jest.fn(),
  firstStudioLine: jest.fn(),
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
const jobArg = () => repo.createServiceJob.mock.calls[0][0].job;

beforeEach(() => {
  jest.clearAllMocks();
  // Faitlyn's default (getDefaultServiceType) lands on Installation — the exact
  // arbitrary pick that produced the bug.
  repo.serviceJobExistsForOrder.mockResolvedValue(false);
  repo.getDefaultServiceType.mockResolvedValue({ ...INSTALLATION });
  repo.getServiceTypeByKey.mockImplementation(async ({ key }) =>
    key === "styling" ? { ...STYLING } : null,
  );
  repo.nextNumber.mockResolvedValue("FLH-JOB-0001");
  repo.createServiceJob.mockResolvedValue({
    job_id: "job-1",
    job_number: "FLH-JOB-0001",
  });
  repo.setServiceJobStatus.mockResolvedValue({});
});

describe("createForOrder — styled products open as Styling, not Installation", () => {
  it("uses the Styling type for a styled line, never the display_order=1 default", async () => {
    repo.firstStudioLine.mockResolvedValue({
      line_id: "line-1",
      line_kind: "styled",
      styled_id: "styled-1",
      variant_id: "variant-1",
      notes: null,
    });
    repo.getStyledDNA.mockResolvedValue({
      styled_id: "styled-1",
      base_variant_id: "variant-1",
      style_addon_price_ngn: 20000,
      default_service_type_id: null, // the real-world case: unconfigured
      default_recipe_id: null,
      sop_steps: null,
      standard_turnaround_days: null,
    });

    await svc.createForOrder({ brand: "faitlynhair", order: ORDER });

    expect(repo.getServiceTypeByKey).toHaveBeenCalledWith(
      expect.objectContaining({ brand: "faitlynhair", key: "styling" }),
    );
    expect(jobArg().service_type_id).toBe("st-styling");
    expect(jobArg().service_type_id).not.toBe("st-installation");
  });

  it("leaves a genuine (non-styled) service line on the brand default", async () => {
    repo.firstStudioLine.mockResolvedValue({
      line_id: "line-2",
      line_kind: "service",
      styled_id: null,
      variant_id: null,
      unit_price_ngn: 69000,
      notes: null,
    });

    await svc.createForOrder({ brand: "faitlynhair", order: ORDER });

    expect(repo.getServiceTypeByKey).not.toHaveBeenCalled();
    expect(repo.getStyledDNA).not.toHaveBeenCalled();
    expect(jobArg().service_type_id).toBe("st-installation");
  });

  it("prices a styled job from the Styling type when the style carries no add-on price", async () => {
    repo.firstStudioLine.mockResolvedValue({
      line_id: "line-3",
      line_kind: "styled",
      styled_id: "styled-2",
      variant_id: null,
      notes: null,
    });
    repo.getStyledDNA.mockResolvedValue({
      styled_id: "styled-2",
      style_addon_price_ngn: null, // no add-on → fall back to the type's cost
      default_service_type_id: null,
    });

    await svc.createForOrder({ brand: "faitlynhair", order: ORDER });

    expect(jobArg().service_type_id).toBe("st-styling");
    // Styling's 15,000 — not Installation's 35,000.
    expect(Number(jobArg().agreed_cost_ngn)).toBe(15000);
  });

  it("still no-ops on a brand with no styling services (e.g. PXG)", async () => {
    repo.getDefaultServiceType.mockResolvedValue(null); // PXG runs no services
    repo.getServiceTypeByKey.mockResolvedValue(null);
    repo.firstStudioLine.mockResolvedValue({
      line_id: "line-4",
      line_kind: "styled",
      styled_id: "styled-3",
      variant_id: null,
      notes: null,
    });
    repo.getStyledDNA.mockResolvedValue({
      styled_id: "styled-3",
      style_addon_price_ngn: 10000,
      default_service_type_id: null,
    });

    const res = await svc.createForOrder({ brand: "pixiegirl", order: ORDER });

    expect(res).toBeNull();
    expect(repo.createServiceJob).not.toHaveBeenCalled();
  });
});
