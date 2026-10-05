"use strict";

/**
 * REASSIGNING A WIG THAT IS ALREADY OUT — custody transfer, not a refusal.
 *
 * Assignment used to hard-stop with WIG_ALREADY_OUT ("have it returned first")
 * whenever the job's custody balance was positive, forcing a physical hand-back
 * through the desk before the job could move stylist. It now transfers: with
 * the assigner's explicit acknowledgement the service posts the balancing
 * RETURN against the current holder and re-issues the OUT to the new stylist,
 * in that order, so the ledger never shows one unit in two pairs of hands.
 *
 * These tests pin:
 *   1. without the acknowledgement it is still refused — but with a transfer
 *      prompt naming the current holder, not a dead end;
 *   2. with it, a return-then-out pair is written and the assignment lands;
 *   3. the stylist the wig left is notified they are no longer accountable;
 *   4. a clean job (balance 0) is unaffected — no spurious return row.
 */

jest.mock("../../../src/config/database", () => ({
  transaction: (fn) => fn({}),
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
  jobCustodyBalance: jest.fn(),
  currentCustodyHolder: jest.fn(),
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
  lockLevel: jest.fn(),
}));
jest.mock("../../../src/modules/sales/sales.repo", () => ({
  advanceStatus: jest.fn(),
}));
jest.mock("../../../src/services/notifications.service", () => ({
  notify: jest.fn(),
}));

const repo = require("../../../src/modules/service_jobs/service-jobs.repo");
const stockRepo = require("../../../src/modules/stock/stock.repo");
const notifications = require("../../../src/services/notifications.service");
const svc = require("../../../src/modules/service_jobs/service-jobs.service");

const USER = { user_id: "ops-1", display_name: "Ops" };
const base = { brand: "faitlynhair", user: USER, request_id: "req-1" };

function assignedJob(extra = {}) {
  return {
    job_id: "job-1",
    job_number: "FLH-JOB-0174",
    status: "assigned",
    sales_order_id: "order-1",
    reserved_variant_id: "variant-1",
    hair_variant_id: "variant-1",
    tag_code: "342NS",
    assigned_staff_user_id: "stylist-old",
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  repo.addCustody.mockResolvedValue({});
  repo.orderAlreadyDrewWig.mockResolvedValue(false);
  repo.studioDrawBalanceForJob.mockResolvedValue(0);
  repo.currentCustodyHolder.mockResolvedValue({
    user_id: "stylist-old",
    display_name: "Ape Boluwatife",
  });
  stockRepo.getDefaultLocation.mockResolvedValue({ location_id: "loc-1" });
  stockRepo.outstandingReservationForOrder.mockResolvedValue(1);
  stockRepo.lockLevel.mockResolvedValue({ on_hand: 1, reserved: 0 });
  const job = assignedJob();
  repo.getServiceJob.mockResolvedValue(job);
  repo.setServiceJobStatus.mockResolvedValue(job);
});

describe("assignStylist — custody transfer on reassignment", () => {
  it("refuses without acknowledgement, naming the current holder", async () => {
    repo.jobCustodyBalance.mockResolvedValue(1);

    await expect(
      svc.assignStylist({
        ...base,
        id: "job-1",
        assigned_staff_user_id: "stylist-new",
      }),
    ).rejects.toMatchObject({
      code: "WIG_TRANSFER_NOT_ACKNOWLEDGED",
    });
    expect(repo.addCustody).not.toHaveBeenCalled();
  });

  it("returns off the old holder then issues to the new one", async () => {
    repo.jobCustodyBalance.mockResolvedValue(1);

    await svc.assignStylist({
      ...base,
      id: "job-1",
      assigned_staff_user_id: "stylist-new",
      acknowledge_transfer: true,
    });

    const events = repo.addCustody.mock.calls.map(([{ c }]) => c);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      event: "return",
      quantity: 1,
      stylist_user_id: "stylist-old",
    });
    expect(events[1]).toMatchObject({
      event: "out",
      stylist_user_id: "stylist-new",
    });
  });

  it("tells the previous stylist the wig is off them", async () => {
    repo.jobCustodyBalance.mockResolvedValue(1);

    await svc.assignStylist({
      ...base,
      id: "job-1",
      assigned_staff_user_id: "stylist-new",
      acknowledge_transfer: true,
    });

    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "stylist-old",
        type: "service_job_custody_transferred",
      }),
    );
  });

  it("writes no return row when nothing is out", async () => {
    repo.jobCustodyBalance.mockResolvedValue(0);

    await svc.assignStylist({
      ...base,
      id: "job-1",
      assigned_staff_user_id: "stylist-new",
    });

    const events = repo.addCustody.mock.calls.map(([{ c }]) => c);
    expect(events).toEqual([expect.objectContaining({ event: "out" })]);
  });
});
