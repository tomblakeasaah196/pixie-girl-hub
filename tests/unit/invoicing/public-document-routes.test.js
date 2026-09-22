"use strict";

// Route-level contract for the customer document links — the HTTP surface a
// phone browser actually hits. The service tests (public-document-view) prove
// the resolution logic; this proves the WIRING: that the canonical path serves
// a PDF (not JSON, not the SPA), that the short alias works, that every link
// already sitting in an inbox still resolves via 301, and that an unknown id
// is a clean 404 rather than a stack trace.
//
// Uses the real routers + the real error handler on a bare express app —
// nothing about the mount paths is mocked, which is exactly where this class
// of bug lives.

jest.mock("../../../src/modules/invoicing/invoicing.service", () => ({
  publicInvoicePdf: jest.fn(),
  publicReceiptPdf: jest.fn(),
  getPublicView: jest.fn(),
  getReceiptPublicView: jest.fn(),
}));
jest.mock("../../../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));
// The real error handler reports 500s into Kaizen, which drags the DB/queue
// clients in with it — irrelevant here and they hold the process open.
jest.mock("../../../src/modules/kaizen/errors/errors.capture", () => ({
  captureError: jest.fn(),
}));

// server.js does this before anything else: it patches the router so an
// async handler that rejects reaches the error handler instead of hanging the
// request. Without it a 404 would hang the test (and the customer).
require("express-async-errors");
const express = require("express");
const request = require("supertest");
const service = require("../../../src/modules/invoicing/invoicing.service");
const publicInvoiceRouter = require("../../../src/modules/invoicing/invoice-public.routes");
const {
  errorHandler,
  notFoundHandler,
} = require("../../../src/middleware/error-handler");
const { NotFoundError } = require("../../../src/utils/errors");

const INV_ID = "11111111-1111-4111-8111-111111111111";
const RCPT_ID = "22222222-2222-4222-8222-222222222222";
const PDF = Buffer.from("%PDF-1.4\n% test\n");

/**
 * The same shape src/routes/index.js mounts: the documents router under
 * /api/public, the short aliases at the root, and the legacy views.
 */
function buildApp() {
  const app = express();
  const publicRouter = express.Router();
  publicRouter.use("/documents", publicInvoiceRouter.documentRouter);
  publicRouter.use("/invoices", publicInvoiceRouter);
  publicRouter.use("/receipts", publicInvoiceRouter.receiptRouter);
  app.use("/api/public", publicRouter);
  app.use(publicInvoiceRouter.shortDocumentRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  service.publicInvoicePdf.mockResolvedValue({
    buffer: PDF,
    filename: "Invoice FLH-INV-0159.pdf",
  });
  service.publicReceiptPdf.mockResolvedValue({
    buffer: PDF,
    filename: "Receipt FLH-RCT-0003.pdf",
  });
});

describe("customer invoice document link", () => {
  test("GET the canonical URL streams the PDF inline (not JSON)", async () => {
    const res = await request(buildApp()).get(
      `/api/public/documents/invoice/${INV_ID}`,
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toBe(
      'inline; filename="Invoice FLH-INV-0159.pdf"',
    );
    // A statement must never be cached by a CDN or a shared phone browser.
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.body.length).toBe(PDF.length);
    expect(service.publicInvoicePdf).toHaveBeenCalledWith({ id: INV_ID });
  });

  test("the short alias /i/:id serves the same PDF", async () => {
    const res = await request(buildApp()).get(`/i/${INV_ID}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(service.publicInvoicePdf).toHaveBeenCalledWith({ id: INV_ID });
  });

  test("the legacy emailed path 301s to the canonical document URL", async () => {
    const res = await request(buildApp()).get(
      `/api/public/invoices/faitlynhair/${INV_ID}/view`,
    );

    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(
      `/api/public/documents/invoice/${INV_ID}`,
    );
    // The redirect must NOT do the work — the document is served once, at
    // the destination, so the customer's viewer gets a real PDF response.
    expect(service.publicInvoicePdf).not.toHaveBeenCalled();
  });

  test("an unknown invoice id is a clean 404", async () => {
    service.publicInvoicePdf.mockRejectedValue(new NotFoundError("Invoice"));

    const res = await request(buildApp()).get(
      "/api/public/documents/invoice/does-not-exist",
    );

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});

describe("customer receipt document link", () => {
  test("GET the canonical URL streams the receipt PDF inline", async () => {
    const res = await request(buildApp()).get(
      `/api/public/documents/receipt/${RCPT_ID}`,
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toBe(
      'inline; filename="Receipt FLH-RCT-0003.pdf"',
    );
    expect(service.publicReceiptPdf).toHaveBeenCalledWith({ id: RCPT_ID });
  });

  test("the short alias /r/:id and the legacy path both reach the PDF", async () => {
    const short = await request(buildApp()).get(`/r/${RCPT_ID}`);
    expect(short.status).toBe(200);
    expect(short.headers["content-type"]).toContain("application/pdf");

    const legacy = await request(buildApp()).get(
      `/api/public/receipts/pixiegirl/${RCPT_ID}/view`,
    );
    expect(legacy.status).toBe(301);
    expect(legacy.headers.location).toBe(
      `/api/public/documents/receipt/${RCPT_ID}`,
    );
  });

  test("an unknown receipt id is a clean 404", async () => {
    service.publicReceiptPdf.mockRejectedValue(new NotFoundError("Receipt"));

    const res = await request(buildApp()).get(
      "/api/public/documents/receipt/does-not-exist",
    );

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
