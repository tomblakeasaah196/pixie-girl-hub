"use strict";

/**
 * Best-effort steps inside a Studio transaction must be SAVEPOINTed.
 *
 * Origin: "Something interrupted that step. Please try again." on the assign
 * modal, with nothing in the Kaizen Errors console. That message is the
 * error-handler's translation of Postgres 25P02 (`current transaction is
 * aborted, commands ignored until end of transaction block`), and it was
 * self-inflicted — a step that RAISEd was caught and logged, but catching an
 * error in JavaScript does not un-abort a Postgres transaction, so the next
 * statement on the connection died.
 *
 * The assignment path that started it no longer writes stock at all (see
 * assign-stock-ownership.test.js — assignment is a custody event, and an
 * unaccounted wig is now refused outright), so that particular 25P02 is
 * structurally impossible rather than merely handled.
 *
 * Two best-effort steps still write through the caller's transaction, and both
 * call into stock, which RAISEs on ordinary business conditions. They are what
 * this file guards. Note what failure looked like for these two: nothing wrote
 * on the client after the swallow, so instead of a 25P02 the aborted
 * transaction reached COMMIT — which Postgres silently downgrades to ROLLBACK.
 * The API returned 200 and the work vanished.
 *
 * These tests run the REAL withSavepoint against a client that models
 * Postgres's abort semantics, because that is the only way the regression is
 * visible: a plain try/catch also "handles" the error, so against an inert
 * mock the broken code passes.
 */

const mockCtx = { client: null };

jest.mock("../../../src/config/database", () => {
  const actual = jest.requireActual("../../../src/config/database");
  return {
    transaction: (fn) => fn(mockCtx.client),
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
  studioDrawBalanceForJob: jest.fn(),
  addMaterial: jest.fn(),
  markMaterialDeducted: jest.fn(),
  listMaterials: jest.fn(),
}));
jest.mock("../../../src/modules/stock/stock.service", () => ({
  deductForSale: jest.fn(),
  receiveStock: jest.fn(),
  reserveForOrder: jest.fn(),
}));
jest.mock("../../../src/modules/stock/stock.repo", () => ({
  getDefaultLocation: jest.fn(),
  outstandingReservationForOrder: jest.fn(),
  lockLevel: jest.fn(),
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
 *   - …except ROLLBACK TO SAVEPOINT, the only way back to a usable
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

/** Make a stock call RAISE through the transaction client. */
const raiseVia = (fn) =>
  fn.mockImplementation(({ client }) => client.query(RAISING_STATEMENT));

beforeEach(() => {
  jest.clearAllMocks();
  mockCtx.client = abortingClient();
  stockRepo.getDefaultLocation.mockResolvedValue(LOCATION);
});

describe("logMaterial — a failing stock draw must not discard the logged material", () => {
  beforeEach(() => {
    repo.getServiceJob.mockResolvedValue({
      job_id: "job-1",
      status: "in_progress",
    });
    repo.addMaterial.mockResolvedValue({ material_id: "mat-1" });
    repo.listMaterials.mockResolvedValue([{ material_id: "mat-1" }]);
    repo.markMaterialDeducted.mockImplementation(async ({ client }) => {
      await client.query("UPDATE service_job_materials …");
      return {};
    });
  });

  const logOne = () =>
    svc.logMaterial({
      ...base,
      id: "job-1",
      input: { kind: "discrete", variant_id: "variant-1", quantity: 1 },
    });

  it("keeps the material row when the deduction raises", async () => {
    raiseVia(stockService.deductForSale);

    const materials = await logOne();

    expect(repo.addMaterial).toHaveBeenCalled();
    expect(materials).toEqual([{ material_id: "mat-1" }]);
    // Transaction survives, so the material row commits with it rather than
    // being silently rolled back at COMMIT.
    expect(mockCtx.client.isAborted()).toBe(false);
  });

  it("rolls the failed draw back to its savepoint", async () => {
    raiseVia(stockService.deductForSale);

    await logOne();

    expect(mockCtx.client.sql).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^SAVEPOINT pgh_sp_\d+$/),
        expect.stringMatching(/^ROLLBACK TO SAVEPOINT pgh_sp_\d+$/),
      ]),
    );
  });

  it("reports the skipped draw to Kaizen instead of only logging it", async () => {
    // The second half of the original report: the console showed nothing.
    raiseVia(stockService.deductForSale);

    await logOne();

    expect(captureError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "23514" }),
      null,
      expect.objectContaining({
        source: "backend",
        context: expect.objectContaining({
          module: "service_jobs",
          component: "studio material deduction",
        }),
      }),
    );
  });

  it("marks the material deducted and reports nothing when the draw succeeds", async () => {
    stockService.deductForSale.mockResolvedValue({ movement_id: "mv-1" });

    await logOne();

    expect(repo.markMaterialDeducted).toHaveBeenCalled();
    expect(captureError).not.toHaveBeenCalled();
  });
});

describe("unassignStaff — a failing restock must not discard the unassign", () => {
  beforeEach(() => {
    repo.getServiceJob.mockResolvedValue({
      job_id: "job-1",
      status: "assigned",
      assigned_staff_user_id: "stylist-1",
      sales_order_id: "order-1",
      reserved_variant_id: "variant-1",
      hair_variant_id: "variant-1",
    });
    repo.setServiceJobStatus.mockResolvedValue({
      job_id: "job-1",
      status: "pending",
    });
    repo.addCustody.mockResolvedValue({});
    // A LEGACY job that really did draw stock, so the restock actually runs.
    repo.studioDrawBalanceForJob.mockResolvedValue(1);
  });

  it("completes the unassign when the restock raises", async () => {
    // Nothing writes on the client after this step, so a poisoned transaction
    // would reach COMMIT and Postgres would quietly turn it into a ROLLBACK —
    // the API returning 200 with the unassign silently discarded.
    raiseVia(stockService.receiveStock);

    const job = await svc.unassignStaff({ ...base, id: "job-1" });

    expect(job).toMatchObject({ status: "pending" });
    expect(mockCtx.client.isAborted()).toBe(false);
    expect(mockCtx.client.sql).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^ROLLBACK TO SAVEPOINT pgh_sp_\d+$/),
      ]),
    );
  });

  it("reports the skipped restock to Kaizen", async () => {
    raiseVia(stockService.receiveStock);

    await svc.unassignStaff({ ...base, id: "job-1" });

    expect(captureError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "23514" }),
      null,
      expect.objectContaining({
        context: expect.objectContaining({
          component: "studio base-wig restock",
        }),
      }),
    );
  });
});
