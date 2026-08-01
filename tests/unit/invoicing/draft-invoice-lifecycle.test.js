"use strict";

// Proforma-invoice lifecycle (2026-07-23 session): a draft invoice is now
// raised at order PLACEMENT (order.created), before any payment, and later
// FINALIZED — not re-created — when the order is genuinely paid
// (order.paid). createFromOrder's old idempotency guard assumed an existing
// invoice was already the final state (true before drafts existed); these
// tests guard the new branching that keeps that assumption from silently
// stranding a proforma in 'draft' forever.

jest.mock("../../../src/modules/invoicing/invoicing.repo", () => ({
  findByOrderId: jest.fn(),
  nextNumber: jest.fn(),
  createInvoice: jest.fn(),
  insertLine: jest.fn(),
  findById: jest.fn(),
  applyPayment: jest.fn(),
  listReceipts: jest.fn(),
  createReceipt: jest.fn(),
  cancelScheduledReminders: jest.fn(),
}));
jest.mock("../../../src/modules/invoicing/invoicing.events", () => ({
  emit: jest.fn(),
}));
jest.mock("../../../src/modules/accounting/accounting.service", () => ({
  postEntry: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(async (fn) => fn({})),
}));
jest.mock("../../../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../../src/services/pdf.service", () => ({}));
jest.mock("../../../src/services/pdf.brand-docs", () => ({}));
jest.mock("../../../src/services/document-copy", () => ({}));
jest.mock("../../../src/modules/email_campaigns/email-render", () => ({}));
jest.mock("../../../src/modules/invoicing/invoice-delivery.service", () => ({}));
jest.mock("../../../src/modules/invoicing/receipt-delivery.service", () => ({}));
jest.mock("../../../src/services/comms-log.service", () => ({}));

const repo = require("../../../src/modules/invoicing/invoicing.repo");
const service = require("../../../src/modules/invoicing/invoicing.service");

const ORDER = {
  order_id: "order-1",
  order_number: "FLH-SO-0001",
  contact_id: "contact-1",
  total_ngn: "100000.00",
  subtotal_ngn: "100000.00",
  discount_amount_ngn: "0.00",
  tax_amount_ngn: "0.00",
  shipping_fee_ngn: "0.00",
  lines: [
    {
      line_id: "line-1",
      product_name_snapshot: "Classic Wig",
      sku_snapshot: "SKU1",
      quantity: 1,
      unit_price_ngn: "100000.00",
      line_discount_ngn: "0.00",
      tax_rate: "0.00",
      tax_amount_ngn: "0.00",
      line_total_ngn: "100000.00",
      display_order: 0,
    },
  ],
};

const USER_ID = "user-1";

beforeEach(() => {
  jest.clearAllMocks();
  repo.nextNumber.mockResolvedValue("FLH-INV-0001");
  repo.createInvoice.mockImplementation(async ({ invoice }) => ({
    invoice_id: "inv-1",
    ...invoice,
  }));
  repo.insertLine.mockResolvedValue({});
  repo.applyPayment.mockResolvedValue({ application_id: "app-1" });
  repo.listReceipts.mockResolvedValue([]);
  repo.createReceipt.mockResolvedValue({ receipt_id: "receipt-1" });
});

describe("createDraftFromOrder", () => {
  test("creates a draft invoice mirroring the order's totals, applies no payment", async () => {
    repo.findByOrderId.mockResolvedValue(null);
    repo.findById.mockResolvedValue({ invoice_id: "inv-1", status: "draft" });
    const inv = await service.createDraftFromOrder({
      brand: "faitlynhair",
      order: ORDER,
      user_id: null,
    });
    expect(repo.createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        invoice: expect.objectContaining({
          status: "draft",
          order_id: "order-1",
          total_ngn: "100000.00",
        }),
      }),
    );
    expect(repo.applyPayment).not.toHaveBeenCalled();
    expect(inv.status).toBe("draft");
  });

  test("is idempotent — a second call returns the existing draft, no duplicate row", async () => {
    const existing = { invoice_id: "inv-existing", status: "draft" };
    repo.findByOrderId.mockResolvedValue(existing);
    const inv = await service.createDraftFromOrder({
      brand: "faitlynhair",
      order: ORDER,
      user_id: null,
    });
    expect(inv).toBe(existing);
    expect(repo.createInvoice).not.toHaveBeenCalled();
  });
});

describe("createFromOrder — finalizing an existing draft on real payment", () => {
  test("applies payment + issues a receipt on the SAME draft invoice, never a second one", async () => {
    const draft = {
      invoice_id: "inv-1",
      invoice_number: "FLH-INV-0001",
      status: "draft",
      balance_due_ngn: "100000.00",
    };
    repo.findByOrderId.mockResolvedValue(draft);
    repo.findById.mockResolvedValue({
      invoice_id: "inv-1",
      status: "paid",
      contact_id: "contact-1",
      total_ngn: "100000.00",
    });
    const inv = await service.createFromOrder({
      brand: "faitlynhair",
      order: ORDER,
      user_id: USER_ID,
    });
    expect(repo.applyPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        payment: expect.objectContaining({
          invoice_id: "inv-1",
          amount_applied_ngn: "100000.00",
        }),
      }),
    );
    expect(repo.createReceipt).toHaveBeenCalled();
    expect(repo.createInvoice).not.toHaveBeenCalled();
    expect(inv.status).toBe("paid");
  });

  test("skips the receipt when one was already issued (at-least-once redelivery)", async () => {
    const draft = {
      invoice_id: "inv-1",
      status: "draft",
      balance_due_ngn: "100000.00",
    };
    repo.findByOrderId.mockResolvedValue(draft);
    repo.findById.mockResolvedValue({ invoice_id: "inv-1", status: "paid" });
    repo.listReceipts.mockResolvedValue([{ receipt_id: "already-there" }]);
    await service.createFromOrder({
      brand: "faitlynhair",
      order: ORDER,
      user_id: USER_ID,
    });
    expect(repo.createReceipt).not.toHaveBeenCalled();
  });

  test("does nothing further when the existing invoice is already paid AND receipted (duplicate order.paid delivery)", async () => {
    const alreadyPaid = {
      invoice_id: "inv-1",
      status: "paid",
      balance_due_ngn: "0.00",
    };
    repo.findByOrderId.mockResolvedValue(alreadyPaid);
    repo.listReceipts.mockResolvedValue([{ receipt_id: "already-there" }]);
    const inv = await service.createFromOrder({
      brand: "faitlynhair",
      order: ORDER,
      user_id: USER_ID,
    });
    expect(inv).toBe(alreadyPaid);
    expect(repo.applyPayment).not.toHaveBeenCalled();
    expect(repo.findById).not.toHaveBeenCalled();
  });

  // The order mirrors its payment onto the invoice inside the ORDER's
  // transaction, so by the time this post-commit handler runs the invoice is
  // already 'paid' — with no receipt yet. Short-circuiting on 'paid' alone
  // would have swallowed the receipt entirely.
  test("still issues the receipt when the order already settled the invoice", async () => {
    const paidByOrder = {
      invoice_id: "inv-1",
      invoice_number: "FLH-INV-0042",
      status: "paid",
      balance_due_ngn: "0.00",
    };
    repo.findByOrderId.mockResolvedValue(paidByOrder);
    repo.listReceipts.mockResolvedValue([]);
    repo.findById.mockResolvedValue({
      invoice_id: "inv-1",
      status: "paid",
      total_ngn: "418500.00",
    });
    await service.createFromOrder({
      brand: "faitlynhair",
      order: ORDER,
      user_id: USER_ID,
    });
    // Nothing outstanding → no second payment, but the receipt is issued.
    expect(repo.applyPayment).not.toHaveBeenCalled();
    expect(repo.createReceipt).toHaveBeenCalled();
  });

  test("names a staff-recorded bank transfer on the receipt, not 'gateway'", async () => {
    repo.findByOrderId.mockResolvedValue({
      invoice_id: "inv-1",
      status: "draft",
      balance_due_ngn: "418500.00",
    });
    repo.listReceipts.mockResolvedValue([]);
    repo.findById.mockResolvedValue({
      invoice_id: "inv-1",
      status: "paid",
      total_ngn: "418500.00",
    });
    await service.createFromOrder({
      brand: "faitlynhair",
      order: {
        ...ORDER,
        payments: [
          { method: "bank_transfer", payment_path: "staff_recorded" },
        ],
      },
      user_id: USER_ID,
    });
    expect(repo.createReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        receipt: expect.objectContaining({ payment_method: "bank_transfer" }),
      }),
    );
  });

  test("creates a brand-new paid invoice when none exists at all (legacy/no-draft path)", async () => {
    repo.findByOrderId.mockResolvedValue(null);
    repo.findById.mockResolvedValue({ invoice_id: "inv-2", status: "paid" });
    await service.createFromOrder({
      brand: "faitlynhair",
      order: ORDER,
      user_id: USER_ID,
    });
    expect(repo.createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        invoice: expect.objectContaining({ status: "paid" }),
      }),
    );
    expect(repo.applyPayment).toHaveBeenCalled();
  });
});
