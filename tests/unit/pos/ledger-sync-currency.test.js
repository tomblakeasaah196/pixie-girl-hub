"use strict";

// The Nomba ledger sweep parks credits the Hub has no payment for. Nomba holds
// a Naira account AND a USD wallet: a USD credit's `amount` is dollars, and must
// never be parked as that many Naira. And an online checkout recorded under our
// orderReference must be recognised from ANY reference the ledger row carries.

let mockLedger = [];
let mockKnown = false;
const mockParked = [];

jest.mock("../../../src/config/brands", () => ({
  VALID_BRANDS: new Set(["faitlynhair"]),
}));
jest.mock("../../../src/services/nomba.service", () => ({
  fetchLedgerTransactions: jest.fn(async () => ({ results: mockLedger, cursor: null })),
}));
jest.mock("../../../src/modules/business_setup/payment-gateways.service", () => ({
  resolveCredentials: jest.fn(async () => ({ client_id: "c" })),
}));
jest.mock("../../../src/modules/sales/sales.repo", () => ({
  paymentExistsForNombaLedgerRefs: jest.fn(async () => mockKnown),
}));
jest.mock("../../../src/modules/pos/pos.repo", () => ({
  enqueueReconciliation: jest.fn(async ({ row }) => {
    mockParked.push(row);
    return { recon_id: `r-${mockParked.length}`, ...row };
  }),
}));
jest.mock("../../../src/modules/pos/pos.events", () => ({ emit: jest.fn() }));
jest.mock("../../../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const salesRepo = require("../../../src/modules/sales/sales.repo");
const events = require("../../../src/modules/pos/pos.events");
const sync = require("../../../src/modules/pos/ledger-sync.service");

const credit = (over = {}) => ({
  transactionType: "CREDIT",
  status: "SUCCESS",
  amount: 249.99,
  timeUpdated: "2026-09-27T10:00:00Z",
  meta: { transactionId: "NOMBA-TXN-1", orderReference: "nomba-FLH-SO-0200-abc" },
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockParked.length = 0;
  mockKnown = false;
});

test("a USD wallet credit parks with its dollars, not as ₦249.99", async () => {
  mockLedger = [credit({ currency: "USD" })];
  await sync.runNombaLedgerSync();
  expect(mockParked).toHaveLength(1);
  expect(mockParked[0]).toMatchObject({
    amount_ngn: "0",
    paid_currency: "USD",
    paid_amount: 249.99,
    provider_reference: "NOMBA-TXN-1",
  });
  expect(mockParked[0].note).toMatch(/USD 249.99 credited to the Nomba USD wallet/);
  expect(events.emit).toHaveBeenCalledWith(
    "pending",
    expect.objectContaining({ paid_currency: "USD", paid_amount: 249.99 }),
  );
});

test("a Naira credit parks exactly as before", async () => {
  mockLedger = [credit({ amount: 330800 })];
  await sync.runNombaLedgerSync();
  expect(mockParked[0]).toMatchObject({ amount_ngn: 330800 });
  expect(mockParked[0].paid_currency).toBeUndefined();
});

test("every reference the row carries is checked — a known checkout isn't parked", async () => {
  mockKnown = true;
  mockLedger = [credit()];
  await sync.runNombaLedgerSync();
  expect(salesRepo.paymentExistsForNombaLedgerRefs).toHaveBeenCalledWith({
    brand: "faitlynhair",
    refs: ["NOMBA-TXN-1", "nomba-FLH-SO-0200-abc"],
  });
  expect(mockParked).toHaveLength(0);
});

test("currency is read from the row or its meta, defaulting to Naira", () => {
  expect(sync.rowCurrency({ currency: "usd" })).toBe("USD");
  expect(sync.rowCurrency({ meta: { currency: "USD" } })).toBe("USD");
  expect(sync.rowCurrency({})).toBe("NGN");
});
