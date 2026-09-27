"use strict";

// A customer who paid more than the order costs has money we are holding for
// them. Finance decides refund vs credit — so they're told, in the currency the
// customer paid.

let mockOrder;
const mockNotified = [];

jest.mock("../../../src/shared/outbox/outbox", () => ({ register: jest.fn() }));
jest.mock("../../../src/modules/sales/sales.repo", () => ({
  findById: jest.fn(async () => mockOrder),
}));
jest.mock("../../../src/shared/access/grants.repo", () => ({
  listUsersWithPermission: jest.fn(async () => [
    { user_id: "finance-1" },
    { user_id: "ceo-1" },
  ]),
}));
jest.mock("../../../src/services/notifications.service", () => ({
  notify: jest.fn(async (n) => {
    mockNotified.push(n);
  }),
}));
jest.mock("../../../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const grantsRepo = require("../../../src/shared/access/grants.repo");
const sub = require("../../../src/modules/sales/overpayment.subscribers");

beforeEach(() => {
  jest.clearAllMocks();
  mockNotified.length = 0;
});

test("a USD order's excess is stated in dollars (with the Naira held) to accounting + CEO", async () => {
  mockOrder = {
    order_id: "ord-1",
    order_number: "FLH-SO-0200",
    display_currency: "USD",
    display_total: "333.33",
    fx_rate_used: "1500.000000",
  };
  await sub.onOrderOverpaid({
    brand: "faitlynhair",
    order_id: "ord-1",
    overpaid_ngn: "15000.00",
  });
  expect(grantsRepo.listUsersWithPermission).toHaveBeenCalledWith({
    business: "faitlynhair",
    module: "accounting",
    action: "edit",
  });
  expect(mockNotified).toHaveLength(2);
  expect(mockNotified[0]).toMatchObject({
    type: "order_overpaid",
    title: "Overpayment on FLH-SO-0200",
    reference_type: "sales_order",
    reference_id: "ord-1",
    action_url: "/sales/orders/ord-1",
  });
  expect(mockNotified[0].body).toContain("$10.00 (₦15,000.00)");
});

test("a Naira order's excess is stated in Naira", () => {
  expect(
    sub.excessLabel({ display_currency: "NGN", fx_rate_used: "1" }, "2500.00"),
  ).toBe("₦2,500.00");
});

test("a vanished order sends nothing and never throws", async () => {
  mockOrder = null;
  await expect(
    sub.onOrderOverpaid({ brand: "faitlynhair", order_id: "gone", overpaid_ngn: "10.00" }),
  ).resolves.toBeUndefined();
  expect(mockNotified).toHaveLength(0);
});
