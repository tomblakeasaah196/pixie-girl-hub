"use strict";

// Realised FX is posted only against a REAL rate lock.
//
// addPayment used to post "realised FX" whenever a payment carried a foreign
// paid_currency, measuring it against order.fx_rate_used — whose column default
// is 1.0. A USD capture on a Naira order (a Quick Sale, or a currency flipped
// through the public pay link) therefore booked paid_amount × 1.0 as the
// "expected" Naira and posted almost the whole order value as an FX gain.
//
// Now the variance posts only when the order is denominated in the paid
// currency at a captured rate, and not when the capture was converted at that
// same locked rate (every Nomba USD credit) — that is not an FX event.

let mockOrder;
let mockPaidSoFar;

jest.mock("../../../src/modules/sales/sales.repo", () => ({
  findById: jest.fn(async () => ({
    ...mockOrder,
    amount_paid_ngn: mockPaidSoFar,
  })),
  nextNumber: jest.fn(async () => "FLH-PAY-0001"),
  addPayment: jest.fn(async ({ payment }) => {
    mockPaidSoFar = (Number(mockPaidSoFar) + Number(payment.amount_ngn)).toFixed(2);
    return { ...payment, payment_id: "pay-1", _alreadyExisted: false };
  }),
  setStatus: jest.fn(async ({ status }) => ({
    ...mockOrder,
    status,
    amount_paid_ngn: mockPaidSoFar,
  })),
}));
jest.mock("../../../src/modules/invoicing/invoicing.repo", () => ({
  findByOrderId: jest.fn(async () => null),
  applyPayment: jest.fn(),
}));
jest.mock("../../../src/modules/accounting/accounting.service", () => ({
  postEntry: jest.fn(),
  postFxGainLoss: jest.fn(),
}));
jest.mock("../../../src/shared/outbox/outbox", () => ({
  enqueue: jest.fn(),
  register: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(async (fn) => fn({})),
  query: jest.fn(async () => ({ rows: [] })),
}));

const service = require("../../../src/modules/sales/sales.service");
const accounting = require("../../../src/modules/accounting/accounting.service");

const BASE_ORDER = {
  order_id: "ord-1",
  order_number: "FLH-SO-0300",
  contact_id: "contact-1",
  status: "pending_payment",
  total_ngn: "500000.00",
  payment_plan: "full",
  payment_model: "standard",
  required_deposit_ngn: null,
  lines: [],
};

// A part payment keeps the test off the markPaid settle path.
const payUsd = ({ amount_ngn, paid_amount, fx_rate_used }) =>
  service.addPayment({
    brand: "faitlynhair",
    user: { user_id: null },
    request_id: "webhook:wh-1",
    id: BASE_ORDER.order_id,
    input: {
      method: "nomba_online",
      provider: "nomba",
      provider_reference: "nomba-FLH-SO-0300-abc",
      amount_ngn,
      paid_currency: "USD",
      paid_amount,
      fx_rate_used,
      payment_path: "gateway",
    },
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockPaidSoFar = "0.00";
});

test("a USD capture on an unlocked Naira order posts no phantom FX gain", async () => {
  mockOrder = { ...BASE_ORDER, display_currency: "NGN", fx_rate_used: "1.000000" };
  await payUsd({ amount_ngn: "150000.00", paid_amount: "100.00", fx_rate_used: "1500" });
  expect(accounting.postFxGainLoss).not.toHaveBeenCalled();
});

test("a capture converted at the order's own locked rate is not an FX event", async () => {
  mockOrder = { ...BASE_ORDER, display_currency: "USD", fx_rate_used: "1500.000000" };
  await payUsd({ amount_ngn: "150000.00", paid_amount: "100.00", fx_rate_used: "1500.000000" });
  expect(accounting.postFxGainLoss).not.toHaveBeenCalled();
});

test("a capture at a different rate than the lock still books the real variance", async () => {
  mockOrder = { ...BASE_ORDER, display_currency: "USD", fx_rate_used: "1500.000000" };
  // $100 that actually landed as ₦160,000 → ₦10,000 gain vs the ₦150,000 booked.
  await payUsd({ amount_ngn: "160000.00", paid_amount: "100.00", fx_rate_used: "1600.000000" });
  expect(accounting.postFxGainLoss).toHaveBeenCalledTimes(1);
  expect(accounting.postFxGainLoss.mock.calls[0][0].delta_ngn).toBe("10000.00");
});

// ── Nomba USD wallet + overpayment (Phase 4 books) ──────────────────────
const outbox = require("../../../src/shared/outbox/outbox");

test("a USD Nomba capture debits the USD wallet (1141) with the dollars received", async () => {
  mockOrder = { ...BASE_ORDER, display_currency: "USD", fx_rate_used: "1500.000000" };
  await payUsd({ amount_ngn: "150000.00", paid_amount: "100.00", fx_rate_used: "1500.000000" });
  const capture = accounting.postEntry.mock.calls.find(
    ([arg]) => arg.entry.idempotency_key === "payment_capture:pay-1",
  )[0];
  expect(capture.lines[0]).toMatchObject({
    account_code: "1141",
    debit_ngn: "150000.00",
    transaction_currency: "USD",
    debit_transaction_currency: "100.00",
  });
});

test("a payment on an already-settled order raises order.overpaid with the excess", async () => {
  // Paid in full already; a second $100 arrives (paid twice / an old link).
  mockOrder = {
    ...BASE_ORDER,
    status: "paid",
    display_currency: "USD",
    fx_rate_used: "1500.000000",
  };
  mockPaidSoFar = "500000.00";
  await payUsd({ amount_ngn: "150000.00", paid_amount: "100.00", fx_rate_used: "1500.000000" });
  const overpaid = outbox.enqueue.mock.calls.find(
    ([, evt]) => evt.event_type === "order.overpaid",
  );
  expect(overpaid).toBeDefined();
  expect(overpaid[1]).toMatchObject({
    dedup_key: "order.overpaid:pay-1",
    payload: expect.objectContaining({
      order_id: "ord-1",
      overpaid_ngn: "150000.00",
      added_ngn: "150000.00",
      paid_currency: "USD",
      paid_amount: "100.00",
    }),
  });
});

test("a part payment is not an overpayment", async () => {
  mockOrder = { ...BASE_ORDER, display_currency: "USD", fx_rate_used: "1500.000000" };
  await payUsd({ amount_ngn: "150000.00", paid_amount: "100.00", fx_rate_used: "1500.000000" });
  expect(
    outbox.enqueue.mock.calls.some(([, evt]) => evt.event_type === "order.overpaid"),
  ).toBe(false);
});
