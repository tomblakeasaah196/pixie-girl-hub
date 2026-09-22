"use strict";

/**
 * "Share PDF" from the composer's invoice picker.
 *
 * The resolver is the whole risk surface: it decides WHICH invoice may be
 * shared from a chat and WHICH document carries it. Everything after it is the
 * ordinary postMessage/attachment path (covered elsewhere), so the tests below
 * pin the resolver's contract:
 *
 *   - the invoice must exist in the active brand's books;
 *   - void/refunded invoices are refused (the same rule the invoice send flow
 *     enforces — a cancelled statement must never reach a customer);
 *   - the document comes from the invoicing module's single resolver, so the
 *     chat carries exactly the PDF the customer's own link would serve.
 */

jest.mock("../../../src/config/database", () => ({ query: jest.fn() }));
jest.mock("../../../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/modules/invoicing/invoicing.repo", () => ({
  findById: jest.fn(),
}));
jest.mock("../../../src/modules/invoicing/invoicing.service", () => ({
  ensureInvoiceDocument: jest.fn(),
}));

const invoicingRepo = require("../../../src/modules/invoicing/invoicing.repo");
const invoicing = require("../../../src/modules/invoicing/invoicing.service");
const service = require("../../../src/modules/smartcomm/smartcomm.service");

const INVOICE = {
  invoice_id: "11111111-1111-4111-8111-111111111111",
  invoice_number: "FLH-INV-0159",
  status: "sent",
};
const DOC = {
  document_id: "33333333-3333-4333-8333-333333333333",
  file_path: "faitlynhair/documents/0007.pdf",
  mime_type: "application/pdf",
};

const args = {
  brand: "faitlynhair",
  invoice_id: INVOICE.invoice_id,
};

beforeEach(() => {
  jest.clearAllMocks();
  invoicingRepo.findById.mockResolvedValue(INVOICE);
  invoicing.ensureInvoiceDocument.mockResolvedValue(DOC);
});

describe("smartcomm.resolveInvoiceShare (chat → Share PDF)", () => {
  test("returns the invoice and the PDF document the chat will carry", async () => {
    const out = await service.resolveInvoiceShare(args);

    expect(out.invoice).toBe(INVOICE);
    expect(out.doc).toBe(DOC);
    expect(invoicingRepo.findById).toHaveBeenCalledWith({
      brand: "faitlynhair",
      id: INVOICE.invoice_id,
    });
    expect(invoicing.ensureInvoiceDocument).toHaveBeenCalledWith({
      brand: "faitlynhair",
      id: INVOICE.invoice_id,
    });
  });

  test("an invoice outside the brand's books is a 404 (no cross-brand leak)", async () => {
    invoicingRepo.findById.mockResolvedValue(null);

    await expect(service.resolveInvoiceShare(args)).rejects.toThrow(
      /invoice/i,
    );
    // Never resolves a document for an invoice we couldn't even read.
    expect(invoicing.ensureInvoiceDocument).not.toHaveBeenCalled();
    expect(invoicingRepo.findById).toHaveBeenCalledWith({
      brand: "faitlynhair", // the ACTIVE brand, from the request context
      id: INVOICE.invoice_id,
    });
  });

  test.each(["void", "refunded"])(
    "refuses a %s invoice — the customer must never receive it",
    async (status) => {
      invoicingRepo.findById.mockResolvedValue({ ...INVOICE, status });

      await expect(service.resolveInvoiceShare(args)).rejects.toThrow(
        new RegExp(status),
      );
      expect(invoicing.ensureInvoiceDocument).not.toHaveBeenCalled();
    },
  );

  test("a partially paid / overdue / draft invoice is still shareable", async () => {
    for (const status of ["draft", "sent", "viewed", "overdue", "partially_paid", "paid"]) {
      invoicingRepo.findById.mockResolvedValue({ ...INVOICE, status });
      const out = await service.resolveInvoiceShare(args);
      expect(out.doc).toBe(DOC);
    }
  });

  test("an invoice with no resolvable document is a 404, not a silent empty send", async () => {
    invoicing.ensureInvoiceDocument.mockResolvedValue(null);

    await expect(service.resolveInvoiceShare(args)).rejects.toThrow(
      /invoice/i,
    );
  });
});

describe("smartcomm.shareInvoicePdfIntoThread — guard rails", () => {
  test("brand context is required before anything is read", async () => {
    await expect(
      service.shareInvoicePdfIntoThread({
        brand: null,
        user: { user_id: "u1" },
        request_id: "r1",
        channel_id: "55555555-5555-4555-8555-555555555555",
        invoice_id: INVOICE.invoice_id,
      }),
    ).rejects.toThrow(/brand/i);

    expect(invoicingRepo.findById).not.toHaveBeenCalled();
  });
});
