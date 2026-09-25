"use strict";

/**
 * When new stock fulfils pre-orders, the people who act on it must be told —
 * both ops (whoever can move stock) and sales (whoever can edit orders), and a
 * person holding both permissions is told once, not twice.
 */

jest.mock("../../../src/shared/outbox/outbox", () => ({
  register: jest.fn(),
  enqueue: jest.fn(),
}));
jest.mock("../../../src/modules/sales/sales.events", () => ({
  on: jest.fn(),
  emit: jest.fn(),
}));
jest.mock("../../../src/modules/sales/preorder-allocation.service", () => ({
  allocateForVariant: jest.fn(),
}));
jest.mock("../../../src/shared/access/grants.repo", () => ({
  listUsersWithPermission: jest.fn(),
}));
jest.mock("../../../src/services/notifications.service", () => ({
  notify: jest.fn(),
}));

const grantsRepo = require("../../../src/shared/access/grants.repo");
const notifications = require("../../../src/services/notifications.service");
const {
  onPreorderAllocated,
  onStockReceived,
} = require("../../../src/modules/sales/preorder-allocation.subscribers");
const allocation = require("../../../src/modules/sales/preorder-allocation.service");

const PAYLOAD = {
  brand: "pixiegirl",
  variant_id: "variant-1",
  units_deducted: 3,
  units_reserved: 2,
  orders: [
    { order_id: "o-1", order_number: "PXG-1", is_paid: true, units: 3 },
    { order_id: "o-2", order_number: "PXG-2", is_paid: false, units: 2 },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("preorder.allocated → ops + sales told once each", () => {
  it("notifies stock-editors and sales-editors, deduped", async () => {
    grantsRepo.listUsersWithPermission.mockImplementation(({ module }) =>
      module === "stock"
        ? Promise.resolve([{ user_id: "u-ops" }, { user_id: "u-both" }])
        : Promise.resolve([{ user_id: "u-sales" }, { user_id: "u-both" }]),
    );

    await onPreorderAllocated(PAYLOAD);

    expect(grantsRepo.listUsersWithPermission).toHaveBeenCalledWith(
      expect.objectContaining({ module: "stock", action: "edit" }),
    );
    expect(grantsRepo.listUsersWithPermission).toHaveBeenCalledWith(
      expect.objectContaining({ module: "sales", action: "edit" }),
    );
    // u-ops, u-sales, u-both — three distinct people, u-both only once.
    expect(notifications.notify).toHaveBeenCalledTimes(3);
    const body = notifications.notify.mock.calls[0][0].body;
    expect(body).toContain("3 drawn");
    expect(body).toContain("2 reserved");
    expect(body).toContain("PXG-1");
  });

  it("does nothing for an empty payload", async () => {
    await onPreorderAllocated({ brand: "pixiegirl", orders: [] });
    await onPreorderAllocated(null);
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it("never throws back into the emitter when notifying fails", async () => {
    grantsRepo.listUsersWithPermission.mockRejectedValue(new Error("db down"));
    await expect(onPreorderAllocated(PAYLOAD)).resolves.toBeUndefined();
  });
});

describe("stock.received outbox handler → allocate", () => {
  it("allocates for the received variant using the event's brand", async () => {
    allocation.allocateForVariant.mockResolvedValue({ allocated: true });
    await onStockReceived(
      { variant_id: "variant-9", location_id: "loc-1" },
      { business: "faitlynhair" },
    );
    expect(allocation.allocateForVariant).toHaveBeenCalledWith(
      expect.objectContaining({
        brand: "faitlynhair",
        variant_id: "variant-9",
        location_id: "loc-1",
        notify: true,
      }),
    );
  });

  it("ignores an event with no variant", async () => {
    await onStockReceived({}, { business: "pixiegirl" });
    expect(allocation.allocateForVariant).not.toHaveBeenCalled();
  });
});
