"use strict";

/**
 * Stylist Studio — pure-unit coverage for the two behaviours the "0 completed"
 * + "every stylist sees every job" bug fix introduced:
 *
 *   1. `getJob` enforces own-scope by threading `req.permission_scope` and
 *      throws `NO_LONGER_ASSIGNED` with the current assignee's name when a
 *      stylist opens a stale link to a reassigned job. This is what makes
 *      the reassignment banner ("this job was reassigned to X → back to
 *      my jobs") possible instead of a bare 403 wall.
 *
 *   2. `recordQc` on 'pass' now flips status STRAIGHT to `completed` and
 *      stamps `completed_at`, so scorecards + HR `styles_completed` targets
 *      finally accrue for real, shipped work (they used to require three
 *      more manual clicks that nobody made — hence "0 completed" showing
 *      for stylists with 40 shipped wigs).
 *
 * Pure-unit: the repo, audit, events, notifications and logistics deps are
 * stubbed via jest.mock — no DB, no HTTP.
 */

jest.mock("../../../src/config/database", () => {
  // transaction(fn) runs the callback with a fake client whose query calls
  // are ignored — the service under test never inspects the client object,
  // it only forwards it to the (mocked) repo.
  return {
    transaction: (fn) => fn({}),
    // Real withSavepoint is a no-op wrapper when there is no client; the mock
    // transaction passes {}, so run the body straight through.
    withSavepoint: (_client, fn) => fn(),
    query: jest.fn(),
    ex: () => jest.fn(),
  };
});

jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));

jest.mock("../../../src/modules/service_jobs/service-jobs.events", () => ({
  emit: jest.fn(),
  on: jest.fn(),
}));

jest.mock("../../../src/modules/service_jobs/service-jobs.repo", () => ({
  getServiceJob: jest.fn(),
  listServiceJobs: jest.fn().mockResolvedValue({
    data: [],
    page: 1,
    page_size: 25,
    total: 0,
  }),
  setServiceJobStatus: jest.fn(),
  userHasJobAccess: jest.fn(),
  getJobAssigneeName: jest.fn(),
  getUsersOpenSession: jest.fn(),
  addCustody: jest.fn(),
  hasCustodyEvent: jest.fn().mockResolvedValue(true), // avoid double-deduct
  setShipmentForOrderJobs: jest.fn().mockResolvedValue(1),
}));

// An order's "ready" effects are gated on ALL its hairs being done. These tests
// cover the single-hair order, so the gate reports ready; the multi-hair cases
// live in multi-item-order-readiness.test.js.
jest.mock("../../../src/modules/sales/order-readiness", () => ({
  studioProgress: jest
    .fn()
    .mockResolvedValue({ total: 1, done: 1, outstanding: 0, ready: true }),
}));

jest.mock("../../../src/services/notifications.service", () => ({
  notify: jest.fn().mockResolvedValue(undefined),
}));

// Logistics is only touched on QC pass with a linked order. Return a delivery
// so we can also verify the shipment_id stamp path.
jest.mock("../../../src/modules/logistics/logistics.service", () => ({
  createForOrder: jest.fn().mockResolvedValue({ delivery_id: "delivery-1" }),
}));

jest.mock("../../../src/modules/sales/sales.repo", () => ({
  findById: jest.fn(),
  // Returns the moved row on a real transition — that return is what releases
  // the customer message and the delivery.
  advanceStatus: jest.fn().mockResolvedValue({
    order_id: "order-42",
    status: "order_ready",
  }),
}));

const repo = require("../../../src/modules/service_jobs/service-jobs.repo");
const salesRepo = require("../../../src/modules/sales/sales.repo");
const logistics = require("../../../src/modules/logistics/logistics.service");
const svc = require("../../../src/modules/service_jobs/service-jobs.service");

const ACTOR = { user_id: "actor-1", display_name: "Test Ops" };
const STYLIST_A = { user_id: "stylist-a", display_name: "Stylist A" };

beforeEach(() => {
  jest.clearAllMocks();
});

describe("service_jobs.service.getJob — own-scope enforcement", () => {
  it("returns the job when the caller is (or was) the assignee", async () => {
    repo.getServiceJob.mockResolvedValue({
      job_id: "job-1",
      job_number: "SJ-000001",
      assigned_staff_user_id: STYLIST_A.user_id,
    });
    repo.userHasJobAccess.mockResolvedValue(true);

    const job = await svc.getJob({
      brand: "faitlynhair",
      id: "job-1",
      scope: "own",
      user: STYLIST_A,
    });
    expect(job.job_id).toBe("job-1");
    expect(repo.getJobAssigneeName).not.toHaveBeenCalled();
  });

  it("throws NO_LONGER_ASSIGNED with the current assignee's name on reassigned jobs", async () => {
    repo.getServiceJob.mockResolvedValue({
      job_id: "job-1",
      job_number: "SJ-000001",
      assigned_staff_user_id: "someone-else",
    });
    repo.userHasJobAccess.mockResolvedValue(false);
    repo.getJobAssigneeName.mockResolvedValue("Chidera Okafor");

    let caught;
    try {
      await svc.getJob({
        brand: "faitlynhair",
        id: "job-1",
        scope: "own",
        user: STYLIST_A,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.code).toBe("NO_LONGER_ASSIGNED");
    expect(caught.http_status).toBe(403);
    // The metadata is what the error-handler surfaces to the client as
    // error.reassigned — that's what the JobBoard drawer reads.
    expect(caught.metadata).toEqual({
      reassigned: { to_name: "Chidera Okafor", job_number: "SJ-000001" },
    });
    expect(caught.user_message).toMatch(/reassigned to Chidera Okafor/);
  });

  it("skips the scope check entirely on 'all' scope (Ops / CEO)", async () => {
    repo.getServiceJob.mockResolvedValue({
      job_id: "job-1",
      job_number: "SJ-000001",
      assigned_staff_user_id: "someone-else",
    });

    const job = await svc.getJob({
      brand: "faitlynhair",
      id: "job-1",
      scope: "all",
      user: ACTOR,
    });
    expect(job.job_id).toBe("job-1");
    expect(repo.userHasJobAccess).not.toHaveBeenCalled();
    expect(repo.getJobAssigneeName).not.toHaveBeenCalled();
  });
});

describe("service_jobs.service.listJobs — 'My Jobs' vs. board scoping", () => {
  it("own scope always narrows to the caller (stylist board == my board)", async () => {
    await svc.listJobs({ brand: "faitlynhair", scope: "own", user: STYLIST_A });
    expect(repo.listServiceJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        brand: "faitlynhair",
        own_user_id: STYLIST_A.user_id,
      }),
    );
  });

  it("all scope with no `mine` returns the WHOLE brand (the Ops Job Board)", async () => {
    await svc.listJobs({ brand: "faitlynhair", scope: "all", user: ACTOR });
    const args = repo.listServiceJobs.mock.calls[0][0];
    expect(args.own_user_id).toBeUndefined();
  });

  it("`mine:true` narrows to the caller EVEN on all scope (the CEO/Ops 'My Jobs' tab)", async () => {
    await svc.listJobs({
      brand: "faitlynhair",
      scope: "all",
      user: ACTOR,
      mine: true,
    });
    expect(repo.listServiceJobs).toHaveBeenCalledWith(
      expect.objectContaining({ own_user_id: ACTOR.user_id }),
    );
  });

  it("does not leak `scope`/`user`/`mine` control fields into the repo call", async () => {
    await svc.listJobs({
      brand: "faitlynhair",
      scope: "all",
      user: ACTOR,
      mine: true,
      status: "assigned",
    });
    const args = repo.listServiceJobs.mock.calls[0][0];
    expect(args).not.toHaveProperty("scope");
    expect(args).not.toHaveProperty("user");
    expect(args).not.toHaveProperty("mine");
    expect(args.status).toBe("assigned");
  });
});

describe("service_jobs.service.recordQc — QC pass auto-completes", () => {
  it("on pass, sets status='completed', stamps completed_at, and adds a 'dispatched' custody row", async () => {
    repo.getServiceJob.mockResolvedValue({
      job_id: "job-1",
      job_number: "SJ-000001",
      assigned_staff_user_id: STYLIST_A.user_id,
      rework_count: 0,
      sales_order_id: null, // no logistics leg on this run
    });
    repo.setServiceJobStatus.mockImplementation(
      async ({ status, fields = {} }) => ({
        job_id: "job-1",
        job_number: "SJ-000001",
        status,
        ...fields,
      }),
    );

    const result = await svc.recordQc({
      brand: "faitlynhair",
      user: ACTOR,
      request_id: "req-1",
      id: "job-1",
      input: { result: "pass", quality_rating: 5, quality_notes: "clean" },
    });

    expect(result.status).toBe("completed");
    expect(result.completed_at).toBeTruthy();

    // The FIRST setServiceJobStatus call is the one that carries the fields we
    // care about (the auto-complete transition). A second call may follow to
    // stamp shipment_id when logistics returns a delivery — that path is
    // separately covered below.
    const firstCall = repo.setServiceJobStatus.mock.calls[0][0];
    expect(firstCall.status).toBe("completed");
    expect(firstCall.fields.qc_by).toBe(ACTOR.user_id);
    expect(firstCall.fields.completed_at).toBeTruthy();
    expect(firstCall.fields.quality_rating).toBe(5);

    expect(repo.addCustody).toHaveBeenCalledWith(
      expect.objectContaining({
        c: expect.objectContaining({ event: "dispatched" }),
      }),
    );
  });

  it("on pass with a linked order, creates the logistics delivery and stamps shipment_id", async () => {
    const BASE = {
      job_id: "job-1",
      job_number: "SJ-000001",
      assigned_staff_user_id: STYLIST_A.user_id,
      rework_count: 0,
      sales_order_id: "order-42",
    };
    // First read is the in-transaction "before" row; the second is the
    // post-commit read-back after the shipment was stamped across the order.
    repo.getServiceJob
      .mockResolvedValueOnce(BASE)
      .mockResolvedValue({
        ...BASE,
        status: "completed",
        shipment_id: "delivery-1",
      });
    repo.setServiceJobStatus.mockImplementation(
      async ({ status, fields = {} }) => ({
        job_id: "job-1",
        job_number: "SJ-000001",
        status,
        sales_order_id: "order-42",
        ...fields,
      }),
    );
    salesRepo.findById.mockResolvedValue({
      order_id: "order-42",
      channel: "shipping",
    });

    const result = await svc.recordQc({
      brand: "faitlynhair",
      user: ACTOR,
      request_id: "req-1",
      id: "job-1",
      input: { result: "pass" },
    });

    expect(logistics.createForOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        brand: "faitlynhair",
        order: expect.objectContaining({ order_id: "order-42" }),
      }),
    );
    // The shipment is stamped across every job on the order (they all travel in
    // the one parcel), then the fresh row is read back for the caller.
    expect(repo.setShipmentForOrderJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: "order-42",
        shipment_id: "delivery-1",
      }),
    );
    expect(result.shipment_id).toBe("delivery-1");
    expect(result.status).toBe("completed");
  });

  it("returns null current-session for the caller when no clock is running", async () => {
    repo.getUsersOpenSession.mockResolvedValue(null);
    const result = await svc.getMyCurrentSession({
      brand: "faitlynhair",
      user: STYLIST_A,
    });
    expect(result).toBeNull();
    expect(repo.getUsersOpenSession).toHaveBeenCalledWith({
      brand: "faitlynhair",
      user_id: STYLIST_A.user_id,
    });
  });

  it("short-circuits current-session to null when no user is on the request", async () => {
    const result = await svc.getMyCurrentSession({
      brand: "faitlynhair",
      user: null,
    });
    expect(result).toBeNull();
    expect(repo.getUsersOpenSession).not.toHaveBeenCalled();
  });

  it("on fail, keeps the rework flow: status=rework, wig back out to the stylist", async () => {
    repo.getServiceJob.mockResolvedValue({
      job_id: "job-1",
      job_number: "SJ-000001",
      assigned_staff_user_id: STYLIST_A.user_id,
      rework_count: 2,
      sales_order_id: null,
    });
    repo.setServiceJobStatus.mockImplementation(
      async ({ status, fields = {} }) => ({
        job_id: "job-1",
        status,
        ...fields,
      }),
    );

    const result = await svc.recordQc({
      brand: "faitlynhair",
      user: ACTOR,
      request_id: "req-1",
      id: "job-1",
      input: { result: "rework", quality_notes: "redo the edges" },
    });

    expect(result.status).toBe("rework");
    // rework_count bumps by 1
    const args = repo.setServiceJobStatus.mock.calls[0][0];
    expect(args.fields.rework_count).toBe(3);
    // No completed_at on rework
    expect(args.fields.completed_at).toBeUndefined();
    // Wig goes back out
    expect(repo.addCustody).toHaveBeenCalledWith(
      expect.objectContaining({
        c: expect.objectContaining({ event: "out", reason: "rework" }),
      }),
    );
  });
});
