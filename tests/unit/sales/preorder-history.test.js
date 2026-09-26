"use strict";

/**
 * The "Fulfilled pre-orders" modal reads fulfilled + waiting pre-orders and the
 * last run, and its "Run backfill" runs the reconcile for the ACTIVE BRAND with
 * notifications ON (a manual run must behave like a real receipt).
 */

jest.mock("../../../src/modules/sales/sales.repo", () => ({
  listFulfilledPreorders: jest.fn(),
  listWaitingPreorders: jest.fn(),
  lastAllocationRun: jest.fn(),
}));
jest.mock("../../../src/modules/sales/preorder-allocation.service", () => ({
  allocateForBrand: jest.fn(),
}));

const repo = require("../../../src/modules/sales/sales.repo");
const allocation = require("../../../src/modules/sales/preorder-allocation.service");
const {
  getHistory,
  runBackfill,
} = require("../../../src/modules/sales/preorder-history.service");

beforeEach(() => jest.clearAllMocks());

describe("preorder history service", () => {
  it("assembles fulfilled + waiting + last_run for one brand", async () => {
    repo.listFulfilledPreorders.mockResolvedValue([{ order_id: "a" }]);
    repo.listWaitingPreorders.mockResolvedValue([{ order_id: "b" }]);
    repo.lastAllocationRun.mockResolvedValue({ ok: true, orders_fulfilled: 2 });

    const res = await getHistory({ brand: "faitlynhair" });

    expect(res).toEqual({
      fulfilled: [{ order_id: "a" }],
      waiting: [{ order_id: "b" }],
      last_run: { ok: true, orders_fulfilled: 2 },
    });
    for (const fn of [
      repo.listFulfilledPreorders,
      repo.listWaitingPreorders,
      repo.lastAllocationRun,
    ]) {
      expect(fn).toHaveBeenCalledWith(
        expect.objectContaining({ brand: "faitlynhair" }),
      );
    }
  });

  it("runs the reconcile for the active brand, manual mode, notifications on", async () => {
    allocation.allocateForBrand.mockResolvedValue({
      ok: true,
      units_deducted: 3,
    });

    const res = await runBackfill({
      brand: "pixiegirl",
      user: { user_id: "u-1" },
    });

    expect(allocation.allocateForBrand).toHaveBeenCalledWith({
      brand: "pixiegirl",
      mode: "manual",
      actor_user_id: "u-1",
      notify: true,
    });
    expect(res.units_deducted).toBe(3);
  });
});
