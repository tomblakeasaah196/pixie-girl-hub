"use strict";

// A USD order that was short-paid (or is on a dollar instalment plan) must hear
// "we received $150.00 — balance $99.99" with the pay link, not the Naira
// credit the books carry.

let mockOrder;
let mockPayments;
const mockSent = [];

jest.mock("../../../src/shared/outbox/outbox", () => ({ register: jest.fn() }));
jest.mock("../../../src/modules/sales/sales.repo", () => ({
  findById: jest.fn(async () => mockOrder),
  listPayments: jest.fn(async () => mockPayments),
  ensurePublicTrackingToken: jest.fn(async () => "tok-1"),
}));
jest.mock("../../../src/modules/sales/payment-settings.service", () => ({
  getSettings: jest.fn(async () => ({ plan_display_name: "Flexi Pay" })),
}));
jest.mock("../../../src/utils/brand-urls", () => ({
  payLinkUrl: jest.fn(async (_b, t) => `https://shop.example/pay/${t}`),
}));
jest.mock("../../../src/modules/comms_studio/comms-studio.service", () => ({
  dispatch: jest.fn(async (msg) => {
    mockSent.push(msg);
  }),
}));
jest.mock("../../../src/modules/sales/payment-link.service", () => ({
  outstandingUsd: jest.fn(() => "99.99"),
}));
jest.mock("../../../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const comms = require("../../../src/modules/sales/payment-comms.subscribers");

beforeEach(() => {
  jest.clearAllMocks();
  mockSent.length = 0;
});

test("a short USD payment reports dollars and the dollar balance", async () => {
  mockOrder = {
    order_id: "ord-1",
    order_number: "FLH-SO-0200",
    total_ngn: "374985.00",
    amount_paid_ngn: "225000.00",
    display_currency: "USD",
    display_total: "249.99",
    fx_rate_used: "1500.000000",
  };
  mockPayments = [
    {
      payment_id: "pay-1",
      amount_ngn: "225000.00",
      paid_currency: "USD",
      paid_amount: "150.00",
      status: "captured",
    },
  ];
  await comms.onPaymentRecorded({
    brand: "faitlynhair",
    order_id: "ord-1",
    contact_id: "c-1",
    payment_id: "pay-1",
    amount_ngn: "225000.00",
    amount_paid_ngn: "225000.00",
    total_ngn: "374985.00",
  });
  expect(mockSent[0].variables).toMatchObject({
    amount: "$150.00",
    paid_total: "$150.00",
    balance: "$99.99",
    pay_url: "https://shop.example/pay/tok-1",
  });
});

test("a Naira order keeps its Naira figures", async () => {
  mockOrder = {
    order_id: "ord-2",
    order_number: "FLH-SO-0201",
    total_ngn: "100000.00",
    display_currency: "NGN",
    fx_rate_used: "1.000000",
  };
  mockPayments = [
    { payment_id: "pay-2", amount_ngn: "40000.00", paid_currency: null, status: "captured" },
  ];
  await comms.onPaymentRecorded({
    brand: "faitlynhair",
    order_id: "ord-2",
    contact_id: "c-1",
    payment_id: "pay-2",
    amount_ngn: "40000.00",
    amount_paid_ngn: "40000.00",
    total_ngn: "100000.00",
  });
  expect(mockSent[0].variables).toMatchObject({
    amount: "₦40,000.00",
    paid_total: "₦40,000.00",
    balance: "₦60,000.00",
  });
});
