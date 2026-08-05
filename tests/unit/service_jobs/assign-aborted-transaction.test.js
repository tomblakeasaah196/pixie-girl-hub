"use strict";

/**
 * "Something interrupted that step. Please try again." on the assign modal.
 *
 * Reported from Stylist Studio: confirming an assignment failed with that
 * message, and the Kaizen Errors console had no matching row at all.
 *
 * The message is the error-handler's translation of Postgres 25P02
 * (`current transaction is aborted, commands ignored until end of transaction
 * block`), and it was self-inflicted. assignStylist holds the base wig inside
 * its transaction; the Stock SSOT enforces `reserved <= on_hand`, so holding a
 * wig that isn't on hand RAISEs. holdBaseWigForStylist caught that and logged
 * "hold skipped" — but a caught error does NOT un-abort a Postgres
 * transaction. The very next statement, the addCustody INSERT, died with
 * 25P02, and the assignment was lost. Every order-linked job whose base wig
 * was unstocked, oversold, or not yet received was unassignable.
 *
 * These tests run the REAL withSavepoint against a client that models
 * Postgres's abort semantics (see abortingClient below), because that is the
 * only way the regression is visible: a plain try/catch also "handles" the
 * error, so against an inert mock client the old, broken code passes. Here it
 * does not — remove the savepoint and the addCustody INSERT raises 25P02
 * exactly as production did.
 */

const mockCtx = { client: null };

jest.mock("../../../src/config/database", () => {
  const actual = jest.requireActual("../../../src/config/database");
  return {
    transaction: (fn) => fn(mockCtx.client),
    // The real helper — the thing under test.
    withSavepoint: actual.withSavepoint,
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
  setServiceJobStatus: jest.fn(),
  addCustody: jest.fn(),
  jobCustodyBalance: jest.fn(),
  nextTagSequence: jest.fn(),
  deriveTagInitials: jest.fn(() => "NS"),
  orderAlreadyDrewWig: jest.fn(),
  studioDrawBalanceForJob: jest.fn(),
  addMaterial: jest.fn(),
  markMaterialDeducted: jest.fn(),
  listMaterials: jest.fn(),
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
jest.mock("../../../src/modules/kaizen/errors/errors.capture", () => ({
  captureError: jest.fn(),
}));

const repo = require("../../../src/modules/service_jobs/service-jobs.repo");
const stockService = require("../../../src/modules/stock/stock.service");
const stockRepo = require("../../../src/modules/stock/stock.repo");
const salesRepo = require("../../../src/modules/sales/sales.repo");
const {
  captureError,
} = require("../../../src/modules/kaizen/errors/errors.capture");
const svc = require("../../../src/modules/service_jobs/service-jobs.service");

const USER = { user_id: "ops-1", display_name: "Ops" };
const base = { brand: "faitlynhair", user: USER, request_id: "req-1" };
const LOCATION = { location_id: "loc-1", display_name: "Warehouse" };

/** A statement that RAISEs, poisoning the transaction the way Postgres does. */
const RAISING_STATEMENT = "__RAISE__ stock_reserved_le_on_hand";

/**
 * A pg client with Postgres's transaction-abort behaviour, which is the whole
 * mechanism of this bug:
 *   - a RAISE marks the transaction aborted;
 *   - while aborted, EVERY statement fails with 25P02…
 *   - …except ROLLBACK TO SAVEPOINT, which is the only way back to a usable
 *     transaction. Catching the error in JavaScript does nothing.
 */
function abortingClient() {
  const sql = [];
  let aborted = false;
  return {
    sql,
    isAborted: () => aborted,
    query: jest.fn(async (text) => {
      sql.push(text);
      if (/^ROLLBACK TO SAVEPOINT /.test(text)) {
        aborted = false;
        return { rows: [] };
      }
      if (aborted) {
        throw Object.assign(
          new Error(
            "current transaction is aborted, commands ignored until end of transaction block",
          ),
          { code: "25P02" },
        );
      }
      if (text === RAISING_STATEMENT) {
        aborted = true;
        throw Object.assign(
          new Error(
            'new row for relation "stock_levels" violates check constraint "stock_reserved_le_on_hand"',
          ),
          { code: "23514", constraint: "stock_reserved_le_on_hand" },
        );
      }
      return { rows: [] };
    }),
  };
}

// The row setServiceJobStatus hands back — this is what the hold reads from,
// so it must carry the variant, or holdBaseWigForStylist returns before ever
// touching stock and the test passes for the wrong reason.
const ASSIGNED_JOB = {
  job_id: "job-1",
  job_number: "FLH-JOB-0007",
  status: "assigned",
  sales_order_id: "order-1",
  reserved_variant_id: "variant-1",
  hair_variant_id: "variant-1",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCtx.client = abortingClient();

  repo.getServiceJob.mockResolvedValue({
    job_id: "job-1",
    job_number: "FLH-JOB-0007",
    status: "pending",
    sales_order_id: "order-1",
    reserved_variant_id: "variant-1",
    hair_variant_id: "variant-1",
    tag_code: "342NS",
    task_id: null,
  });
  repo.setServiceJobStatus.mockResolvedValue(ASSIGNED_JOB);
  repo.jobCustodyBalance.mockResolvedValue(0);
  repo.orderAlreadyDrewWig.mockResolvedValue(false);
  stockRepo.getDefaultLocation.mockResolvedValue(LOCATION);
  stockRepo.outstandingReservationForOrder.mockResolvedValue(0);

  // The write that used to die with 25P02. It goes through the client, so it
  // fails if the transaction is still aborted when it runs.
  repo.addCustody.mockImplementation(async ({ client }) => {
    await client.query("INSERT INTO wig_custody_ledger …");
    return {};
  });
  repo.markMaterialDeducted.mockImplementation(async ({ client }) => {
    await client.query("UPDATE service_job_materials …");
    return {};
  });
});

/** Hold the wig via a statement that RAISEs, as an unstocked variant does. */
function holdRaises() {
  stockService.reserveForOrder.mockImplementation(({ client }) =>
    client.query(RAISING_STATEMENT),
  );
}

describe("assignStylist — a failing base-wig hold must not sink the assignment", () => {
  it("completes the assignment when the wig cannot be held (the reported 25P02)", async () => {
    holdRaises();

    const job = await svc.assignStylist({
      ...base,
      id: "job-1",
      assigned_staff_user_id: "stylist-1",
    });

    expect(job).toMatchObject({ job_id: "job-1", status: "assigned" });
    // The transaction was rescued, so the custody INSERT actually landed.
    expect(mockCtx.client.isAborted()).toBe(false);
    expect(mockCtx.client.sql).toContain("INSERT INTO wig_custody_ledger …");
  });

  it("rolls the failed hold back to its savepoint", async () => {
    holdRaises();

    await svc.assignStylist({
      ...base,
      id: "job-1",
      assigned_staff_user_id: "stylist-1",
    });

    expect(mockCtx.client.sql).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^SAVEPOINT pgh_sp_\d+$/),
        expect.stringMatching(/^ROLLBACK TO SAVEPOINT pgh_sp_\d+$/),
      ]),
    );
  });

  it("still advances the linked order after a failed hold", async () => {
    holdRaises();

    await svc.assignStylist({
      ...base,
      id: "job-1",
      assigned_staff_user_id: "stylist-1",
    });

    expect(salesRepo.advanceStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: "order-1", to: "assigned" }),
    );
  });

  it("reports the skipped hold to Kaizen instead of only logging it", async () => {
    // The second half of the bug report: the console showed nothing. A skipped
    // step is a real backend fault — it just isn't worth failing the request.
    holdRaises();

    await svc.assignStylist({
      ...base,
      id: "job-1",
      assigned_staff_user_id: "stylist-1",
    });

    expect(captureError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "23514" }),
      null,
      expect.objectContaining({
        source: "backend",
        context: expect.objectContaining({
          module: "service_jobs",
          component: "studio base-wig hold",
        }),
      }),
    );
  });

  it("does not report anything when the hold succeeds", async () => {
    stockService.reserveForOrder.mockResolvedValue({ movement_id: "mv-1" });

    await svc.assignStylist({
      ...base,
      id: "job-1",
      assigned_staff_user_id: "stylist-1",
    });

    expect(stockService.reserveForOrder).toHaveBeenCalled();
    expect(captureError).not.toHaveBeenCalled();
  });

  it("a genuine business rejection still fails the assignment", async () => {
    // The isolation must not turn real guards into silent no-ops: a wig already
    // out with another stylist throws BEFORE the hold and must still 409.
    repo.jobCustodyBalance.mockResolvedValue(1);

    await expect(
      svc.assignStylist({
        ...base,
        id: "job-1",
        assigned_staff_user_id: "stylist-2",
      }),
    ).rejects.toMatchObject({ code: "WIG_ALREADY_OUT" });

    expect(repo.addCustody).not.toHaveBeenCalled();
  });
});

describe("logMaterial — a failing stock draw must not discard the logged material", () => {
  it("keeps the material row when the deduction raises", async () => {
    // Same bug, quieter: nothing wrote on the client after the swallow, so the
    // aborted transaction reached COMMIT and Postgres turned it into a
    // ROLLBACK. The stylist's logged material vanished and the API said OK.
    repo.addMaterial.mockResolvedValue({ material_id: "mat-1" });
    repo.listMaterials.mockResolvedValue([{ material_id: "mat-1" }]);
    stockService.deductForSale.mockImplementation(({ client }) =>
      client.query(RAISING_STATEMENT),
    );

    const materials = await svc.logMaterial({
      ...base,
      id: "job-1",
      input: { kind: "discrete", variant_id: "variant-1", quantity: 1 },
    });

    expect(repo.addMaterial).toHaveBeenCalled();
    expect(materials).toEqual([{ material_id: "mat-1" }]);
    // The transaction survives, so the material row commits with it.
    expect(mockCtx.client.isAborted()).toBe(false);
    expect(captureError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "23514" }),
      null,
      expect.objectContaining({
        context: expect.objectContaining({
          component: "studio material deduction",
        }),
      }),
    );
  });
});
