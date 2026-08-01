"use strict";

// Inline payment acceptance on the order (2026-07-28 session): staff can now
// record money from the order drawer instead of opening the invoice. That made
// a pre-existing split visible — a payment booked on the order never touched
// the order's proforma invoice, so Invoicing kept showing the untouched
// balance until the order settled in full.
//
// addPayment now mirrors every PART payment onto the open invoice. These tests
// pin the boundaries that keep the mirror from double-counting: it caps at the
// invoice's own outstanding balance, it leaves settled/void invoices alone, and
// an idempotent replay never applies twice.
//
// The full-settlement path is deliberately NOT mirrored here — order.paid runs
// createFromOrder → finalizeDraftInvoice, which applies the whole outstanding
// balance and issues the receipt (covered in
// tests/unit/invoicing/draft-invoice-lifecycle.test.js).

const mockOrder = {
  order_id: "ord-1",
  order_number: "FLH-SO-0001",
  contact_id: "contact-1",
  status: "pending_payment",
  total_ngn: "100000.00",
  payment_plan: "full",
  payment_model: "standard",
  required_deposit_ngn: null,
  fx_rate_used: null,
  lines: [],
};

let mockPaidSoFar;
let mockInvoiceRow;
let mockPaymentAlreadyExisted;

jest.mock("../../../src/modules/sales/sales.repo", () => ({
  findById: jest.fn(async () => ({ ...mockOrder, amount_paid_ngn: mockPaidSoFar })),
  nextNumber: jest.fn(async () => "FLH-PAY-0001"),
  addPayment: jest.fn(async ({ payment }) => {
    if (mockPaymentAlreadyExisted) {
      return { ...payment, payment_id: "pay-1", _alreadyExisted: true };
    }
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
  findByOrderId: jest.fn(async () => mockInvoiceRow),
  applyPayment: jest.fn(async ({ payment }) => ({
    application_id: "app-1",
    ...payment,
  })),
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
const invoicingRepo = require("../../../src/modules/invoicing/invoicing.repo");

const USER = { user_id: "user-1" };

// A gateway-path payment keeps the test on the mirror logic itself — the
// staff-recorded path adds the business-config toggle + bank-reference checks,
// which are asserted in payment-validator.test.js / payment-settings.test.js.
// The mirror runs identically for both.
const pay = (amount_ngn) =>
  service.addPayment({
    brand: "faitlynhair",
    user: USER,
    request_id: "req-1",
    id: mockOrder.order_id,
    input: {
      method: "bank_transfer",
      provider: "manual",
      provider_reference: "GTB/2026/00123",
      amount_ngn,
      payment_path: "gateway",
    },
  });

beforeEach(() => {
  jest.clearAllMocks();
  mockPaidSoFar = "0.00";
  mockPaymentAlreadyExisted = false;
  mockInvoiceRow = {
    invoice_id: "inv-1",
    status: "draft",
    balance_due_ngn: "100000.00",
  };
});

describe("addPayment → proforma invoice mirror", () => {
  test("a part payment recorded on the order lands on the open invoice", async () => {
    await pay("40000.00");

    expect(invoicingRepo.applyPayment).toHaveBeenCalledTimes(1);
    const { payment } = invoicingRepo.applyPayment.mock.calls[0][0];
    expect(payment).toMatchObject({
      invoice_id: "inv-1",
      amount_applied_ngn: "40000.00",
      // Links the invoice application back to the sales payment it mirrors, so
      // the two ledgers can be reconciled row-for-row.
      sales_order_payment_id: "pay-1",
      // The acceptance trail: who took the money, stamped server-side.
      applied_by: "user-1",
    });
  });

  test("caps at the invoice's outstanding balance, never driving it negative", async () => {
    // The order can carry charges the proforma doesn't (a delivery fee added
    // after the invoice was raised), so the payment may exceed what the invoice
    // still shows due. balance_due_ngn is a generated column — an over-apply
    // would push it below zero.
    mockInvoiceRow.balance_due_ngn = "25000.00";

    await pay("40000.00");

    expect(invoicingRepo.applyPayment.mock.calls[0][0].payment).toMatchObject({
      amount_applied_ngn: "25000.00",
    });
  });

  test("leaves a settled invoice alone", async () => {
    mockInvoiceRow.status = "paid";

    await pay("40000.00");

    expect(invoicingRepo.applyPayment).not.toHaveBeenCalled();
  });

  test("leaves a void invoice alone", async () => {
    mockInvoiceRow.status = "void";

    await pay("40000.00");

    expect(invoicingRepo.applyPayment).not.toHaveBeenCalled();
  });

  test("is a no-op when the order has no invoice yet", async () => {
    mockInvoiceRow = null;

    await pay("40000.00");

    expect(invoicingRepo.applyPayment).not.toHaveBeenCalled();
  });

  test("an idempotent replay never applies the payment twice", async () => {
    // Same bank reference submitted twice (a double-clicked Save, a re-delivered
    // webhook): the sales payment resolves to the existing row, and every side
    // effect — the mirror included — must be skipped.
    mockPaymentAlreadyExisted = true;

    await pay("40000.00");

    expect(invoicingRepo.applyPayment).not.toHaveBeenCalled();
  });
});
