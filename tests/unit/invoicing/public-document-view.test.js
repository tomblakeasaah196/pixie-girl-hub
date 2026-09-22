"use strict";

// Public customer-facing document surface (2026-09-22): the /i/<uuid> and
// /r/<uuid> links serve the branded PDF and stamp "she opened it" — the fix
// for the "invoice link is corrupted" report (the old /api/public/.../view
// URL answered raw JSON to a phone browser, and links already sent must keep
// working via a 301).

jest.mock("../../../src/config/env", () => ({
  config: { APP_URL: "http://localhost:7000" },
}));
jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(async (fn) => fn({})),
  query: jest.fn(),
}));
jest.mock("../../../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
jest.mock("../../../src/modules/invoicing/invoicing.repo", () => ({
  findById: jest.fn(),
  findInvoiceByIdAnyBrand: jest.fn(),
  findReceiptByIdAnyBrand: jest.fn(),
  markFirstViewed: jest.fn(),
}));
jest.mock("../../../src/modules/invoicing/invoicing.events", () => ({
  emit: jest.fn(),
}));
jest.mock("../../../src/modules/accounting/accounting.service", () => ({
  postEntry: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/services/pdf.service", () => ({
  renderAndStore: jest.fn(),
  renderHtmlToPdf: jest.fn(),
  shutdown: jest.fn(),
  isEnabled: jest.fn(() => true),
}));
jest.mock("../../../src/services/pdf.brand-docs", () => ({
  brandFromTokens: jest.fn(() => ({
    brand_name: "Faitlyn",
    brand_legal_name: "Faitlyn",
    brand_address: "123 Street, Lagos",
    brand_phone: "+2348000000000",
    support_email: "care@faitlynhair.com",
  })),
  invoiceHtml: jest.fn(() => "<html>invoice</html>"),
  receiptHtml: jest.fn(() => "<html>receipt</html>"),
  PDF_OPTIONS: {},
}));
jest.mock("../../../src/services/document-copy", () => ({
  resolveCopy: jest.fn(async () => ({
    invoice: {
      pdf: {
        note_label: "Note",
        note: "A note.",
        note_label_paid: "Payment received",
        note_paid: "Received, thank you.",
        message: "Thank you for your order.",
      },
    },
  })),
  fillTokens: jest.fn((s) => s || ""),
  getStored: jest.fn(async () => ({})),
  saveCopy: jest.fn(),
  DEFAULTS: {},
}));
jest.mock("../../../src/modules/email_campaigns/email-render", () => ({
  resolveBrandTokens: jest.fn(async () => ({
    brand_name: "Faitlyn",
    brand_color: "#690909",
    support_email: "care@faitlynhair.com",
  })),
}));
jest.mock("../../../src/modules/invoicing/invoice-delivery.service", () => ({
  REFERENCE_TYPE: "invoice",
  publicViewUrl: jest.fn(),
}));
jest.mock("../../../src/modules/invoicing/receipt-delivery.service", () => ({
  REFERENCE_TYPE: "receipt",
  publicViewUrl: jest.fn(),
}));
jest.mock("../../../src/services/comms-log.service", () => ({
  record: jest.fn(async () => ({})),
  hasStatus: jest.fn(async () => false),
  listForReference: jest.fn(async () => []),
}));
jest.mock("../../../src/shared/documents/documents.service", () => ({
  listForReference: jest.fn(async () => []),
}));
jest.mock("../../../src/services/storage.service", () => ({
  get: jest.fn(),
}));
jest.mock("../../../src/utils/brand-urls", () => ({
  payLinkUrl: jest.fn(async () => "http://pay"),
  hubBaseUrl: jest.fn(() => "http://hub.test"),
  publicBaseUrl: jest.fn(async () => "http://store.test"),
}));
jest.mock("../../../src/modules/sales/sales.service", () => ({
  receiptPdf: jest.fn(),
}));

const repo = require("../../../src/modules/invoicing/invoicing.repo");
const pdf = require("../../../src/services/pdf.service");
const brandDocs = require("../../../src/services/pdf.brand-docs");
const documents = require("../../../src/shared/documents/documents.service");
const storage = require("../../../src/services/storage.service");
const commsLog = require("../../../src/services/comms-log.service");
const salesService = require("../../../src/modules/sales/sales.service");
const service = require("../../../src/modules/invoicing/invoicing.service");
const controller = require("../../../src/modules/invoicing/invoicing.controller");

const PDF_BYTES = Buffer.from("%PDF-1.4 fake");

const INVOICE = {
  invoice_id: "11111111-1111-4111-8111-111111111111",
  invoice_number: "FLH-INV-0159",
  order_id: "order-1",
  order_number: "FLH-SO-0231",
  contact_id: "c-1",
  contact_name: "Yinka Omohele",
  contact_email: "yinka@example.com",
  contact_phone: "+2348012345678",
  status: "sent",
  subtotal_ngn: "465000.00",
  discount_amount_ngn: "0.00",
  tax_amount_ngn: "0.00",
  wht_amount_ngn: "0.00",
  shipping_fee_ngn: "0.00",
  total_ngn: "465000.00",
  amount_paid_ngn: "0.00",
  balance_due_ngn: "465000.00",
  issue_date: "2026-09-22",
  due_date: "2026-09-29",
  lines: [
    {
      description: "Jamila Rae Black — Medium · 13×6 Frontal",
      quantity: "1.000",
      unit_price_ngn: "465000.00",
      line_total_ngn: "465000.00",
    },
  ],
  payments: [],
};

const RECEIPT = {
  receipt_id: "22222222-2222-4222-8222-222222222222",
  receipt_number: "FLH-RCT-0003",
  invoice_id: null,
  contact_id: "c-1",
  contact_name: "Hassan",
  contact_phone: "+2348012345678",
  amount_ngn: "80000.00",
  payment_method: "bank_transfer",
  issued_at: "2026-09-22",
  sent_to_email: null,
  sent_to_whatsapp: "+2348012345678",
};

function jsonRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    set(k, v) {
      this.headers[k] = v;
      return this;
    },
    send(data) {
      this.data = data;
      return this;
    },
    redirect(code, url) {
      this.location = { code, url };
      return this;
    },
  };
}

describe("publicInvoicePdf (GET /api/public/documents/invoice/:id)", () => {
  beforeEach(() => jest.clearAllMocks());

  test("unknown id → NotFoundError (probing discloses nothing)", async () => {
    repo.findInvoiceByIdAnyBrand.mockResolvedValue(null);
    await expect(service.publicInvoicePdf({ id: "nope" })).rejects.toThrow(
      /invoice/i,
    );
  });

  test("serves the ARCHIVED pdf (no re-render) and records the first open", async () => {
    repo.findInvoiceByIdAnyBrand.mockResolvedValue({
      brand: "faitlynhair",
      invoice: INVOICE,
    });
    repo.markFirstViewed.mockResolvedValue({ first_viewed_at: "now" });
    documents.listForReference.mockResolvedValue([
      { document_type: "invoice", file_path: "faitlynhair/documents/0007.pdf" },
    ]);
    storage.get.mockResolvedValue(PDF_BYTES);

    const out = await service.publicInvoicePdf({ id: INVOICE.invoice_id });

    expect(out.filename).toBe("Invoice FLH-INV-0159.pdf");
    expect(out.buffer).toBe(PDF_BYTES);
    expect(storage.get).toHaveBeenCalledWith(
      "faitlynhair/documents/0007.pdf",
    );
    // The stored file is served — Puppeteer is never touched.
    expect(pdf.renderAndStore).not.toHaveBeenCalled();
    // "She opened it" — exactly one opened row on the comms log.
    expect(commsLog.record).toHaveBeenCalledTimes(1);
    expect(commsLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        event_key: "invoice.opened",
        status: "opened",
        reference_type: "invoice",
        reference_id: INVOICE.invoice_id,
      }),
    );
  });

  test("repeat view: first_viewed already stamped → no second opened row", async () => {
    repo.findInvoiceByIdAnyBrand.mockResolvedValue({
      brand: "faitlynhair",
      invoice: INVOICE,
    });
    repo.markFirstViewed.mockResolvedValue(null); // IS NULL guard: no row
    documents.listForReference.mockResolvedValue([
      { document_type: "invoice", file_path: "faitlynhair/documents/0007.pdf" },
    ]);
    storage.get.mockResolvedValue(PDF_BYTES);

    await service.publicInvoicePdf({ id: INVOICE.invoice_id });

    expect(commsLog.record).not.toHaveBeenCalled();
  });

  test("first open with no archived copy renders on the spot", async () => {
    repo.findInvoiceByIdAnyBrand.mockResolvedValue({
      brand: "faitlynhair",
      invoice: INVOICE,
    });
    repo.findById.mockResolvedValue(INVOICE); // internal getById during render
    repo.markFirstViewed.mockResolvedValue({ first_viewed_at: "now" });
    documents.listForReference.mockResolvedValue([]);
    pdf.renderAndStore.mockResolvedValue({
      document_id: "doc-1",
      file_path: "faitlynhair/documents/0008.pdf",
      url: "http://x/media/0008.pdf",
    });
    storage.get.mockResolvedValue(PDF_BYTES);

    const out = await service.publicInvoicePdf({ id: INVOICE.invoice_id });

    expect(out.filename).toBe("Invoice FLH-INV-0159.pdf");
    expect(pdf.renderAndStore).toHaveBeenCalledWith(
      expect.objectContaining({
        brand: "faitlynhair",
        document_type: "invoice",
        reference_type: "invoice",
        reference_id: INVOICE.invoice_id,
      }),
    );
    expect(brandDocs.invoiceHtml).toHaveBeenCalled();
    expect(storage.get).toHaveBeenCalledWith("faitlynhair/documents/0008.pdf");
  });
});

describe("publicReceiptPdf (GET /api/public/documents/receipt/:id)", () => {
  beforeEach(() => jest.clearAllMocks());

  test("unknown receipt → NotFoundError", async () => {
    repo.findReceiptByIdAnyBrand.mockResolvedValue(null);
    await expect(service.publicReceiptPdf({ id: "nope" })).rejects.toThrow(
      /receipt/i,
    );
  });

  test("serves a receipt archived under its own reference; records opened once", async () => {
    repo.findReceiptByIdAnyBrand.mockResolvedValue({
      brand: "faitlynhair",
      receipt: RECEIPT,
    });
    commsLog.hasStatus.mockResolvedValue(false);
    documents.listForReference.mockResolvedValue([
      { document_type: "receipt", file_path: "faitlynhair/documents/0009.pdf" },
    ]);
    storage.get.mockResolvedValue(PDF_BYTES);

    const out = await service.publicReceiptPdf({ id: RECEIPT.receipt_id });

    expect(out.filename).toBe("Receipt FLH-RCT-0003.pdf");
    expect(commsLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        event_key: "receipt.opened",
        status: "opened",
        reference_type: "receipt",
        reference_id: RECEIPT.receipt_id,
      }),
    );
    expect(pdf.renderAndStore).not.toHaveBeenCalled();
  });

  test("already-opened receipt → no duplicate opened row", async () => {
    repo.findReceiptByIdAnyBrand.mockResolvedValue({
      brand: "faitlynhair",
      receipt: RECEIPT,
    });
    commsLog.hasStatus.mockResolvedValue(true);
    documents.listForReference.mockResolvedValue([
      { document_type: "receipt", file_path: "faitlynhair/documents/0009.pdf" },
    ]);
    storage.get.mockResolvedValue(PDF_BYTES);

    await service.publicReceiptPdf({ id: RECEIPT.receipt_id });

    expect(commsLog.record).not.toHaveBeenCalled();
  });

  test("full-settlement order receipt serves the ORDER's archived receipt", async () => {
    const full = {
      ...RECEIPT,
      invoice_id: "inv-1",
      amount_ngn: "465000.00", // equals the invoice total
    };
    repo.findReceiptByIdAnyBrand.mockResolvedValue({
      brand: "faitlynhair",
      receipt: full,
    });
    repo.findById.mockResolvedValue({
      ...INVOICE,
      invoice_id: "inv-1",
      order_id: "order-1",
      total_ngn: "465000.00",
    });
    commsLog.hasStatus.mockResolvedValue(true);
    documents.listForReference
      .mockResolvedValueOnce([]) // receipt reference: nothing yet
      .mockResolvedValueOnce([
        // order reference: the paid-order receipt
        {
          document_type: "receipt",
          file_path: "faitlynhair/documents/0010.pdf",
        },
      ]);
    storage.get.mockResolvedValue(PDF_BYTES);

    await service.publicReceiptPdf({ id: full.receipt_id });

    expect(storage.get).toHaveBeenCalledWith(
      "faitlynhair/documents/0010.pdf",
    );
    // The order's document is served, not a fresh render.
    expect(pdf.renderAndStore).not.toHaveBeenCalled();
    expect(salesService.receiptPdf).not.toHaveBeenCalled();
  });

  test("partial receipt renders from the receipt row (never the order doc)", async () => {
    const partial = {
      ...RECEIPT,
      invoice_id: "inv-1",
      amount_ngn: "100000.00", // part of the 465k invoice
    };
    repo.findReceiptByIdAnyBrand.mockResolvedValue({
      brand: "faitlynhair",
      receipt: partial,
    });
    repo.findById.mockResolvedValue({
      ...INVOICE,
      invoice_id: "inv-1",
      order_id: "order-1",
      total_ngn: "465000.00",
    });
    commsLog.hasStatus.mockResolvedValue(true);
    documents.listForReference.mockResolvedValue([]);
    pdf.renderAndStore.mockResolvedValue({
      document_id: "doc-2",
      file_path: "faitlynhair/documents/0011.pdf",
      url: "http://x/media/0011.pdf",
    });
    storage.get.mockResolvedValue(PDF_BYTES);

    await service.publicReceiptPdf({ id: partial.receipt_id });

    // Rendered under the RECEIPT reference (the order's receipt must not be
    // minted or served for a partial payment).
    expect(pdf.renderAndStore).toHaveBeenCalledWith(
      expect.objectContaining({
        document_type: "receipt",
        reference_type: "receipt",
        reference_id: partial.receipt_id,
      }),
    );
    expect(brandDocs.receiptHtml).toHaveBeenCalled();
    expect(salesService.receiptPdf).not.toHaveBeenCalled();
  });

  test("full-settlement with no archived order receipt re-renders via sales", async () => {
    const full = {
      ...RECEIPT,
      invoice_id: "inv-1",
      amount_ngn: "465000.00",
    };
    repo.findReceiptByIdAnyBrand.mockResolvedValue({
      brand: "faitlynhair",
      receipt: full,
    });
    repo.findById.mockResolvedValue({
      ...INVOICE,
      invoice_id: "inv-1",
      order_id: "order-1",
      total_ngn: "465000.00",
    });
    commsLog.hasStatus.mockResolvedValue(true);
    documents.listForReference.mockResolvedValue([]);
    salesService.receiptPdf.mockResolvedValue({
      document_id: "doc-3",
      file_path: "faitlynhair/documents/0012.pdf",
      url: "http://x/media/0012.pdf",
    });
    storage.get.mockResolvedValue(PDF_BYTES);

    await service.publicReceiptPdf({ id: full.receipt_id });

    expect(salesService.receiptPdf).toHaveBeenCalledWith({
      brand: "faitlynhair",
      user: null,
      id: "order-1",
    });
    expect(storage.get).toHaveBeenCalledWith("faitlynhair/documents/0012.pdf");
  });
});

describe("public document controllers", () => {
  test("legacy /api/public/invoices/:brand/:id/view 301s to /i/:id", () => {
    const res = jsonRes();
    controller.viewPublicInvoice(
      { params: { brand: "faitlynhair", id: "inv-9" } },
      res,
    );
    expect(res.location).toEqual({
      code: 301,
      url: "/api/public/documents/invoice/inv-9",
    });
  });

  test("legacy /api/public/receipts/:brand/:id/view 301s to /r/:id", () => {
    const res = jsonRes();
    controller.viewPublicReceipt(
      { params: { brand: "pixiegirl", id: "rcpt-9" } },
      res,
    );
    expect(res.location).toEqual({
      code: 301,
      url: "/api/public/documents/receipt/rcpt-9",
    });
  });

  test("GET documents/invoice/:id serves inline pdf bytes with cache-busting headers", async () => {
    service.publicInvoicePdf = jest.fn(async () => ({
      buffer: PDF_BYTES,
      filename: "Invoice FLH-INV-0159.pdf",
    }));
    const res = jsonRes();
    await controller.viewPublicInvoicePdf({ params: { id: "inv-9" } }, res);
    expect(res.headers["Content-Type"]).toBe("application/pdf");
    expect(res.headers["Content-Disposition"]).toBe(
      'inline; filename="Invoice FLH-INV-0159.pdf"',
    );
    expect(res.headers["Cache-Control"]).toBe("private, no-store");
    expect(res.data).toBe(PDF_BYTES);
  });

  test("GET documents/receipt/:id serves inline pdf bytes", async () => {
    service.publicReceiptPdf = jest.fn(async () => ({
      buffer: PDF_BYTES,
      filename: "Receipt FLH-RCT-0003.pdf",
    }));
    const res = jsonRes();
    await controller.viewPublicReceiptPdf({ params: { id: "rcpt-9" } }, res);
    expect(res.headers["Content-Type"]).toBe("application/pdf");
    expect(res.data).toBe(PDF_BYTES);
  });
});
