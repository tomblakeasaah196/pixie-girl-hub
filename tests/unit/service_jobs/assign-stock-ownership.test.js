"use strict";

/**
 * THE SALE OWNS THE STOCK DRAW — regression cover for the double deduction.
 *
 * Two paths used to write a 'sale' movement for one physical wig: markPaid on
 * the order, and the Stylist Studio on assignment. The Studio guarded itself
 * with "has the sale drawn this wig yet?" — a question whose answer changes
 * over time. On a deposit-triggered order the job opens and the stylist is
 * assigned while the balance is outstanding, so the answer was "no", the
 * Studio deducted, and markPaid deducted the same unit again: stock lost two
 * units for one wig that left the shelf once. An unlinked job (no sales order)
 * had nothing to ask about and always deducted.
 *
 * These tests pin the rule that replaced it:
 *   1. assignment NEVER deducts — no matter the payment state of the order;
 *   2. it holds the unit instead, and only when the order isn't already
 *      holding it (no stacked reservations);
 *   3. an unlinked job moves no stock and cannot be assigned without an
 *      explicit acknowledgement;
 *   4. the unassign restock is decided from the job's OWN ledger, so a legacy
 *      job that really did deduct still gets its unit back.
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
jest.mock("../../../src/modules/service_jobs/service-jobs.repo", () => ({
  getServiceJob: jest.fn(),
  setServiceJobStatus: jest.fn(),
  addCustody: jest.fn(),
  jobCustodyBalance: jest.fn(),
  nextTagSequence: jest.fn(),
  deriveTagInitials: jest.fn(() => "NS"),
  orderAlreadyDrewWig: jest.fn(),
  studioDrawBalanceForJob: jest.fn(),
}));
jest.mock("../../../src/modules/stock/stock.service", () => ({
  deductForSale: jest.fn(),
  reserveForOrder: jest.fn(),
  receiveStock: jest.fn(),
}));
jest.mock("../../../src/modules/stock/stock.repo", () => ({
  getDefaultLocation: jest.fn(),
  outstandingReservationForOrder: jest.fn(),
}));
jest.mock("../../../src/modules/sales/sales.repo", () => ({
  advanceStatus: jest.fn(),
}));
jest.mock("../../../src/services/notifications.service", () => ({
  notify: jest.fn(),
}));

const repo = require("../../../src/modules/service_jobs/service-jobs.repo");
const stockService = require("../../../src/modules/stock/stock.service");
const stockRepo = require("../../../src/modules/stock/stock.repo");
const svc = require("../../../src/modules/service_jobs/service-jobs.service");

const USER = { user_id: "ops-1", display_name: "Ops" };
const base = { brand: "faitlynhair", user: USER, request_id: "req-1" };

const LOCATION = { location_id: "loc-1", display_name: "Warehouse" };

/** A job opened from an order whose balance is still outstanding. */
function depositOrderJob(extra = {}) {
  return {
    job_id: "job-1",
    job_number: "FLH-JOB-0001",
    status: "pending",
    sales_order_id: "order-1",
    reserved_variant_id: "variant-1",
    hair_variant_id: "variant-1",
    tag_code: "342NS",
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  repo.jobCustodyBalance.mockResolvedValue(0);
  repo.addCustody.mockResolvedValue({});
  repo.orderAlreadyDrewWig.mockResolvedValue(false);
  repo.studioDrawBalanceForJob.mockResolvedValue(0);
  stockRepo.getDefaultLocation.mockResolvedValue(LOCATION);
  stockRepo.outstandingReservationForOrder.mockResolvedValue(0);
});

describe("assignStylist — the sale owns the stock draw", () => {
  it("never deducts stock, even when the sale has not drawn the wig yet", async () => {
    // The exact deposit-triggered shape that produced −2: balance unpaid, so
    // the old guard said "the sale hasn't drawn — go ahead and deduct".
    const job = depositOrderJob();
    repo.getServiceJob.mockResolvedValue(job);
    repo.setServiceJobStatus.mockResolvedValue({ ...job, status: "assigned" });

    await svc.assignStylist({
      ...base,
      id: "job-1",
      assigned_staff_user_id: "stylist-1",
    });

    expect(stockService.deductForSale).not.toHaveBeenCalled();
  });

  it("holds the unit instead, so it cannot be sold out from under the stylist", async () => {
    const job = depositOrderJob();
    repo.getServiceJob.mockResolvedValue(job);
    repo.setServiceJobStatus.mockResolvedValue({ ...job, status: "assigned" });

    await svc.assignStylist({
      ...base,
      id: "job-1",
      assigned_staff_user_id: "stylist-1",
    });

    expect(stockService.reserveForOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        variant_id: "variant-1",
        location_id: "loc-1",
        quantity: 1,
        reference_id: "order-1",
      }),
    );
  });

  it("does not stack a second hold when the order already reserves the unit", async () => {
    stockRepo.outstandingReservationForOrder.mockResolvedValue(1);
    const job = depositOrderJob();
    repo.getServiceJob.mockResolvedValue(job);
    repo.setServiceJobStatus.mockResolvedValue({ ...job, status: "assigned" });

    await svc.assignStylist({
      ...base,
      id: "job-1",
      assigned_staff_user_id: "stylist-1",
    });

    expect(stockService.reserveForOrder).not.toHaveBeenCalled();
  });

  it("holds nothing once the sale has already drawn the wig", async () => {
    repo.orderAlreadyDrewWig.mockResolvedValue(true);
    const job = depositOrderJob();
    repo.getServiceJob.mockResolvedValue(job);
    repo.setServiceJobStatus.mockResolvedValue({ ...job, status: "assigned" });

    await svc.assignStylist({
      ...base,
      id: "job-1",
      assigned_staff_user_id: "stylist-1",
    });

    expect(stockService.reserveForOrder).not.toHaveBeenCalled();
    expect(stockService.deductForSale).not.toHaveBeenCalled();
  });
});

describe("assignStylist — a job with no sale behind it", () => {
  const unlinked = () => depositOrderJob({ sales_order_id: null });

  it("is refused without an explicit acknowledgement", async () => {
    repo.getServiceJob.mockResolvedValue(unlinked());

    await expect(
      svc.assignStylist({
        ...base,
        id: "job-1",
        assigned_staff_user_id: "stylist-1",
      }),
    ).rejects.toMatchObject({ code: "UNLINKED_JOB_NOT_ACKNOWLEDGED" });

    expect(repo.setServiceJobStatus).not.toHaveBeenCalled();
  });

  it("goes through once acknowledged — and still moves no stock", async () => {
    const job = unlinked();
    repo.getServiceJob.mockResolvedValue(job);
    repo.setServiceJobStatus.mockResolvedValue({ ...job, status: "assigned" });

    await svc.assignStylist({
      ...base,
      id: "job-1",
      assigned_staff_user_id: "stylist-1",
      acknowledge_unlinked: true,
    });

    expect(repo.setServiceJobStatus).toHaveBeenCalled();
    expect(stockService.deductForSale).not.toHaveBeenCalled();
    expect(stockService.reserveForOrder).not.toHaveBeenCalled();
  });
});

describe("unassignStaff — restock follows the job's own ledger", () => {
  it("puts back a LEGACY job's draw even though the sale has since been paid", async () => {
    // The case that silently lost a unit: assigned before payment (Studio
    // deducted), unassigned after it. The old guard asked "did the sale draw?",
    // got "yes", and skipped the restock.
    repo.orderAlreadyDrewWig.mockResolvedValue(true);
    repo.studioDrawBalanceForJob.mockResolvedValue(1);
    repo.getServiceJob.mockResolvedValue(
      depositOrderJob({
        status: "assigned",
        assigned_staff_user_id: "stylist-1",
      }),
    );
    repo.setServiceJobStatus.mockResolvedValue({
      job_id: "job-1",
      status: "pending",
    });

    await svc.unassignStaff({ ...base, id: "job-1" });

    expect(stockService.receiveStock).toHaveBeenCalledWith(
      expect.objectContaining({ variant_id: "variant-1", quantity: 1 }),
    );
  });

  it("invents no stock for a job that never drew any", async () => {
    repo.studioDrawBalanceForJob.mockResolvedValue(0);
    repo.getServiceJob.mockResolvedValue(
      depositOrderJob({
        status: "assigned",
        assigned_staff_user_id: "stylist-1",
      }),
    );
    repo.setServiceJobStatus.mockResolvedValue({
      job_id: "job-1",
      status: "pending",
    });

    await svc.unassignStaff({ ...base, id: "job-1" });

    expect(stockService.receiveStock).not.toHaveBeenCalled();
  });
});
