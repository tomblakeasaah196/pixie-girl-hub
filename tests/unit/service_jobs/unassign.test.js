"use strict";

/**
 * unassignStaff — the CEO-only "revert to unassigned" override. Reverses an
 * assignment: clears the assignee, drops the job back to 'pending', and balances
 * the assignment's custody OUT with a matching RETURN so the wig frees up.
 * Guarded to jobs still in 'assigned' (not yet started).
 *
 * Pure-unit: database/transaction, audit, events and the repo are stubbed. The
 * restock is decided from the job's OWN movement ledger
 * (studioDrawBalanceForJob → 0 means this job never drew stock, which is the
 * case for every job assigned since the sale became the sole owner of the
 * draw), so the stock modules never load.
 */

jest.mock("../../../src/config/database", () => ({
  transaction: (fn) => fn({}),
  // Real withSavepoint is a no-op wrapper when there is no client; the mock
  // transaction passes {}, so run the body straight through.
  withSavepoint: (_client, fn) => fn(),
  query: jest.fn(),
  ex: () => jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/modules/service_jobs/service-jobs.events", () => ({
  emit: jest.fn(),
  on: jest.fn(),
}));
jest.mock("../../../src/modules/service_jobs/service-jobs.repo", () => ({
  getServiceJob: jest.fn(),
  setServiceJobStatus: jest.fn(),
  addCustody: jest.fn(),
  orderAlreadyDrewWig: jest.fn(),
  studioDrawBalanceForJob: jest.fn(),
}));

const repo = require("../../../src/modules/service_jobs/service-jobs.repo");
const svc = require("../../../src/modules/service_jobs/service-jobs.service");

const CEO = { user_id: "ceo-1", display_name: "Owner" };
const base = { brand: "faitlynhair", user: CEO, request_id: "req-1" };

beforeEach(() => {
  jest.clearAllMocks();
  repo.orderAlreadyDrewWig.mockResolvedValue(true);
  // Nothing of this job's own is out — assignment no longer deducts, so there
  // is nothing to put back.
  repo.studioDrawBalanceForJob.mockResolvedValue(0);
  repo.setServiceJobStatus.mockResolvedValue({
    job_id: "job-1",
    status: "pending",
  });
  repo.addCustody.mockResolvedValue({});
});

describe("unassignStaff — CEO revert to unassigned", () => {
  it("clears the assignee, sets pending, and returns custody for an assigned job", async () => {
    repo.getServiceJob.mockResolvedValue({
      job_id: "job-1",
      status: "assigned",
      assigned_staff_user_id: "stylist-1",
      sales_order_id: "order-1",
      reserved_variant_id: "variant-1",
    });

    await svc.unassignStaff({ ...base, id: "job-1" });

    const statusCall = repo.setServiceJobStatus.mock.calls[0][0];
    expect(statusCall.status).toBe("pending");
    expect(statusCall.fields).toEqual({
      assigned_staff_user_id: null,
      assigned_at: null,
    });
    const custody = repo.addCustody.mock.calls[0][0].c;
    expect(custody.event).toBe("return");
    expect(custody.stylist_user_id).toBe("stylist-1");
  });

  it("rejects a job that isn't assigned to anyone", async () => {
    repo.getServiceJob.mockResolvedValue({
      job_id: "job-1",
      status: "pending",
      assigned_staff_user_id: null,
    });

    await expect(svc.unassignStaff({ ...base, id: "job-1" })).rejects.toThrow(
      /not assigned/i,
    );
    expect(repo.setServiceJobStatus).not.toHaveBeenCalled();
  });

  it("rejects a job that has already started (status past 'assigned')", async () => {
    repo.getServiceJob.mockResolvedValue({
      job_id: "job-1",
      status: "in_progress",
      assigned_staff_user_id: "stylist-1",
    });

    await expect(svc.unassignStaff({ ...base, id: "job-1" })).rejects.toThrow(
      /can't be reverted|still in 'assigned'|not yet started/i,
    );
    expect(repo.setServiceJobStatus).not.toHaveBeenCalled();
  });
});
