"use strict";

/**
 * A multi-item order is ready only when EVERY item is ready.
 *
 * Origin (owner directive): a client ordered three different products. Each
 * became its own Stylist Studio job. The moment the FIRST wig passed QC the
 * system emailed her "Order Ready", moved the order to `order_ready`, and
 * queued a Logistics parcel — with two wigs still on a stylist's bench.
 *
 * The rule these tests pin down: nothing customer-facing happens until the last
 * hair lands. Concretely, on a three-item order:
 *
 *   QC #1 → no status move, no mail, no delivery
 *   QC #2 → no status move, no mail, no delivery
 *   QC #3 → order_ready, exactly one mail, one delivery for the whole parcel
 *
 * Pure-unit: repo, audit, events, comms and logistics are stubbed, and the
 * readiness predicate is driven directly so each QC pass can be posed as "this
 * is the Nth of three". The predicate's own SQL is exercised separately against
 * a real database by the integration suite.
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
  setShipmentForOrderJobs: jest.fn().mockResolvedValue(3),
  addCustody: jest.fn(),
  hasCustodyEvent: jest.fn().mockResolvedValue(true),
  listServiceJobs: jest.fn(),
  getUsersOpenSession: jest.fn(),
  userHasJobAccess: jest.fn(),
  getJobAssigneeName: jest.fn(),
}));

jest.mock("../../../src/services/notifications.service", () => ({
  notify: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../../src/modules/logistics/logistics.service", () => ({
  createForOrder: jest.fn().mockResolvedValue({ delivery_id: "delivery-1" }),
}));

jest.mock("../../../src/modules/sales/order-comms", () => ({
  orderReady: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../../src/modules/sales/sales.repo", () => ({
  findById: jest.fn(),
  advanceStatus: jest.fn(),
}));

jest.mock("../../../src/modules/sales/order-readiness", () => ({
  studioProgress: jest.fn(),
}));

const repo = require("../../../src/modules/service_jobs/service-jobs.repo");
const salesRepo = require("../../../src/modules/sales/sales.repo");
const orderComms = require("../../../src/modules/sales/order-comms");
const logistics = require("../../../src/modules/logistics/logistics.service");
const orderReadiness = require("../../../src/modules/sales/order-readiness");
const svc = require("../../../src/modules/service_jobs/service-jobs.service");

const ACTOR = { user_id: "ops-1", display_name: "Ops" };
const ORDER_ID = "order-3wigs";

/** Pose the next QC pass as "the Nth hair of `total` just finished". */
function poseOrder({ done, total }) {
  const outstanding = total - done;
  orderReadiness.studioProgress.mockResolvedValue({
    total,
    done,
    outstanding,
    ready: total > 0 && outstanding === 0,
  });
  // advanceStatus only moves an order that is BEHIND order_ready; it returns
  // null otherwise, which is what stops a repeat release.
  salesRepo.advanceStatus.mockImplementation(async ({ from }) =>
    from.includes("paid") ? { order_id: ORDER_ID, status: "order_ready" } : null,
  );
  salesRepo.findById.mockResolvedValue({
    order_id: ORDER_ID,
    order_number: "SO-3WIGS",
    contact_id: "contact-1",
  });
}

/** Run one QC pass against a job on the three-wig order. */
function qcPass(jobId) {
  const base = {
    job_id: jobId,
    job_number: `SJ-${jobId}`,
    assigned_staff_user_id: "stylist-a",
    rework_count: 0,
    sales_order_id: ORDER_ID,
  };
  repo.getServiceJob.mockResolvedValueOnce(base).mockResolvedValue({
    ...base,
    status: "completed",
    shipment_id: "delivery-1",
  });
  repo.setServiceJobStatus.mockImplementation(
    async ({ status, fields = {} }) => ({ ...base, status, ...fields }),
  );
  return svc.recordQc({
    brand: "faitlynhair",
    user: ACTOR,
    request_id: "req-1",
    id: jobId,
    input: { result: "pass" },
  });
}

beforeEach(() => jest.clearAllMocks());

describe("multi-item order — the client hears from us once, at the end", () => {
  it("first of three: completes the hair but releases nothing", async () => {
    poseOrder({ done: 1, total: 3 });
    const job = await qcPass("job-1");

    // The stylist's work is credited immediately — that part never waited.
    expect(job.status).toBe("completed");
    expect(repo.addCustody).toHaveBeenCalledWith(
      expect.objectContaining({
        c: expect.objectContaining({ event: "dispatched" }),
      }),
    );

    // ...but the ORDER stays put, and the customer hears nothing.
    expect(salesRepo.advanceStatus).not.toHaveBeenCalled();
    expect(orderComms.orderReady).not.toHaveBeenCalled();
    expect(logistics.createForOrder).not.toHaveBeenCalled();
  });

  it("second of three: still nothing", async () => {
    poseOrder({ done: 2, total: 3 });
    await qcPass("job-2");

    expect(salesRepo.advanceStatus).not.toHaveBeenCalled();
    expect(orderComms.orderReady).not.toHaveBeenCalled();
    expect(logistics.createForOrder).not.toHaveBeenCalled();
  });

  it("third of three: moves the order, sends ONE mail, books ONE delivery", async () => {
    poseOrder({ done: 3, total: 3 });
    await qcPass("job-3");

    expect(salesRepo.advanceStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: ORDER_ID, to: "order_ready" }),
    );
    expect(orderComms.orderReady).toHaveBeenCalledTimes(1);
    expect(orderComms.orderReady).toHaveBeenCalledWith(
      expect.objectContaining({
        order: expect.objectContaining({ order_id: ORDER_ID }),
      }),
    );
    expect(logistics.createForOrder).toHaveBeenCalledTimes(1);
    // One parcel, and every hair on the order carries it.
    expect(repo.setShipmentForOrderJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: ORDER_ID,
        shipment_id: "delivery-1",
      }),
    );
  });

  it("a cancelled sibling does not strand the order", async () => {
    // Two hairs, one styled and one written off: outstanding is 0, so the
    // finished one releases the order rather than waiting forever.
    poseOrder({ done: 1, total: 2 });
    orderReadiness.studioProgress.mockResolvedValue({
      total: 2,
      done: 1,
      outstanding: 0,
      ready: true,
    });
    await qcPass("job-1");

    expect(salesRepo.advanceStatus).toHaveBeenCalled();
    expect(orderComms.orderReady).toHaveBeenCalledTimes(1);
  });

  it("re-QC after rework does not send a second mail", async () => {
    poseOrder({ done: 3, total: 3 });
    // The order already sits at order_ready, so advanceStatus (which only
    // accepts orders BEHIND that stage) declines the move and returns null.
    // That null is what tells the QC path this pass did not release anything.
    salesRepo.advanceStatus.mockResolvedValue(null);
    await qcPass("job-3");

    expect(orderComms.orderReady).not.toHaveBeenCalled();
    // The delivery creator DOES still run — deliberately. It is idempotent
    // (no-ops when the order already has one) and it is the backstop for an
    // order that reached order_ready some other way, e.g. a manual early
    // release from the order drawer, which books no parcel of its own.
    expect(logistics.createForOrder).toHaveBeenCalled();
  });

  it("does not book a parcel while items are still outstanding, even on a re-QC", async () => {
    // The guard for the backstop above is readiness, NOT the status move — so
    // an unfinished order must still get nothing.
    poseOrder({ done: 1, total: 3 });
    salesRepo.advanceStatus.mockResolvedValue(null);
    await qcPass("job-1");

    expect(logistics.createForOrder).not.toHaveBeenCalled();
    expect(orderComms.orderReady).not.toHaveBeenCalled();
    expect(repo.setShipmentForOrderJobs).not.toHaveBeenCalled();
  });

  it("a QC fail never touches the order, whatever the progress", async () => {
    poseOrder({ done: 3, total: 3 });
    const base = {
      job_id: "job-3",
      job_number: "SJ-job-3",
      assigned_staff_user_id: "stylist-a",
      rework_count: 1,
      sales_order_id: ORDER_ID,
    };
    repo.getServiceJob.mockResolvedValue(base);
    repo.setServiceJobStatus.mockImplementation(
      async ({ status, fields = {} }) => ({ ...base, status, ...fields }),
    );

    const job = await svc.recordQc({
      brand: "faitlynhair",
      user: ACTOR,
      request_id: "req-1",
      id: "job-3",
      input: { result: "fail", quality_notes: "lace too dark" },
    });

    expect(job.status).toBe("rework");
    expect(salesRepo.advanceStatus).not.toHaveBeenCalled();
    expect(orderComms.orderReady).not.toHaveBeenCalled();
  });
});
