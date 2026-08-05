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
  lockLevel: jest.fn(),
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
  // Default: the wig is on the shelf. Individual tests starve it to exercise
  // the accountability refusal.
  stockRepo.lockLevel.mockResolvedValue({ on_hand: 1, reserved: 0 });
});

describe("assignStylist — the sale owns the stock draw", () => {
  it("never deducts stock, even when the sale has not drawn the wig yet", async () => {
    // The exact deposit-triggered shape that produced −2: balance unpaid, so
    // the old guard said "the sale hasn't drawn — go ahead and deduct".
    // The order still HOLDS its unit (every order reserves at placement), which
    // is what makes this the healthy deposit case rather than a stock-out.
    stockRepo.outstandingReservationForOrder.mockResolvedValue(1);
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

  it("writes NO stock movement of any kind — it is a custody event", async () => {
    // Assignment used to try to `reserve` here. That call could only ever
    // execute when the sale had neither drawn nor held the unit — dead code on
    // a healthy order, and on an unhealthy one it RAISEd
    // stock_reserved_le_on_hand, aborted the transaction, and surfaced as
    // "Something interrupted that step. Please try again." The wig already
    // left on_hand at payment; assignment moves POSSESSION, not quantity.
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
    expect(stockService.deductForSale).not.toHaveBeenCalled();
    expect(stockService.receiveStock).not.toHaveBeenCalled();
  });

  it("goes through when the order holds the unit at placement", async () => {
    stockRepo.outstandingReservationForOrder.mockResolvedValue(1);
    const job = depositOrderJob();
    repo.getServiceJob.mockResolvedValue(job);
    repo.setServiceJobStatus.mockResolvedValue({ ...job, status: "assigned" });

    await svc.assignStylist({
      ...base,
      id: "job-1",
      assigned_staff_user_id: "stylist-1",
    });

    expect(repo.addCustody).toHaveBeenCalled();
  });

  it("goes through once the sale has drawn the wig", async () => {
    repo.orderAlreadyDrewWig.mockResolvedValue(true);
    const job = depositOrderJob();
    repo.getServiceJob.mockResolvedValue(job);
    repo.setServiceJobStatus.mockResolvedValue({ ...job, status: "assigned" });

    await svc.assignStylist({
      ...base,
      id: "job-1",
      assigned_staff_user_id: "stylist-1",
    });

    expect(repo.addCustody).toHaveBeenCalled();
    expect(stockService.deductForSale).not.toHaveBeenCalled();
  });
});

describe("assignStylist — you cannot hand over a wig that isn't there", () => {
  it("refuses when the sale neither drew nor held the unit (pre-order / shortfall)", async () => {
    // Reachable on a FULLY PAID order: an out-of-stock line sells as a
    // pre-order (reserve rolled back), and markPaid deliberately will not fail
    // a payment over missing stock (savepointed, flags stock_shortfall,
    // proceeds). So the order is paid and the hair does not exist.
    repo.orderAlreadyDrewWig.mockResolvedValue(false);
    stockRepo.outstandingReservationForOrder.mockResolvedValue(0);
    repo.getServiceJob.mockResolvedValue(depositOrderJob());

    await expect(
      svc.assignStylist({
        ...base,
        id: "job-1",
        assigned_staff_user_id: "stylist-1",
      }),
    ).rejects.toMatchObject({ code: "WIG_NOT_IN_STOCK" });
  });

  it("refuses before writing anything — no tag code burned on a wig that doesn't exist", async () => {
    repo.orderAlreadyDrewWig.mockResolvedValue(false);
    stockRepo.outstandingReservationForOrder.mockResolvedValue(0);
    repo.getServiceJob.mockResolvedValue(depositOrderJob({ tag_code: null }));

    await expect(
      svc.assignStylist({
        ...base,
        id: "job-1",
        assigned_staff_user_id: "stylist-1",
      }),
    ).rejects.toMatchObject({ code: "WIG_NOT_IN_STOCK" });

    expect(repo.nextTagSequence).not.toHaveBeenCalled();
    expect(repo.setServiceJobStatus).not.toHaveBeenCalled();
    expect(repo.addCustody).not.toHaveBeenCalled();
  });

  it("hands back the Reception deeplink so the block is a door, not a wall", async () => {
    repo.orderAlreadyDrewWig.mockResolvedValue(false);
    stockRepo.outstandingReservationForOrder.mockResolvedValue(0);
    repo.getServiceJob.mockResolvedValue(depositOrderJob());

    const err = await svc
      .assignStylist({
        ...base,
        id: "job-1",
        assigned_staff_user_id: "stylist-1",
      })
      .catch((e) => e);

    expect(err.metadata.resolve_action.url).toContain("tab=reception");
    expect(err.metadata.resolve_action.url).toContain("variant-1");
  });

  it("exempts a job on the customer's own hair — our stock is not involved", async () => {
    // No tracked variant: the customer brought their own wig, or the job names
    // the hair in free text. Nothing to be in stock, nothing to refuse.
    const ownHair = depositOrderJob({
      reserved_variant_id: null,
      hair_variant_id: null,
      hair_description: "Client's own 22\" body wave",
    });
    repo.getServiceJob.mockResolvedValue(ownHair);
    repo.setServiceJobStatus.mockResolvedValue({
      ...ownHair,
      status: "assigned",
    });

    await svc.assignStylist({
      ...base,
      id: "job-1",
      assigned_staff_user_id: "stylist-1",
    });

    expect(repo.addCustody).toHaveBeenCalled();
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

  it("is still refused when the wig it names is not on the shelf", async () => {
    // No sale has drawn this unit, so it should still be sitting in stock.
    // If it isn't, there is nothing to hand over — acknowledgement or not.
    stockRepo.lockLevel.mockResolvedValue({ on_hand: 0, reserved: 0 });
    repo.getServiceJob.mockResolvedValue(unlinked());

    await expect(
      svc.assignStylist({
        ...base,
        id: "job-1",
        assigned_staff_user_id: "stylist-1",
        acknowledge_unlinked: true,
      }),
    ).rejects.toMatchObject({ code: "WIG_NOT_IN_STOCK" });
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
