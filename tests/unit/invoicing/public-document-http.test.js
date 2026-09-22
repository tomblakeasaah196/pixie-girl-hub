"use strict";

// End-to-end HTTP surface for the customer document links — the closest thing
// to production this environment allows: the REAL express app wiring
// (src/routes/index.js → mountRoutes), the real routers, controllers, service
// and repository SQL. Only the DB DRIVER (config/database.query) and the two
// side-effect edges (file bytes, comms ledger) are faked, so this test fails if
// the mount paths, the SQL shapes, the response headers or the first-view
// bookkeeping drift — the exact chain a customer's phone hits when they tap
// "View your invoice".
//
// It is also the regression guard for the original bug: the link must answer
// with PDF BYTES, never the JSON projection.

// Env must be set before anything requires src/config/env (which validates).
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "fatal";
process.env.DB_HOST = "127.0.0.1";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";
process.env.REDIS_HOST = "127.0.0.1";
process.env.JWT_SECRET = "x".repeat(40);
process.env.SESSION_SECRET = "y".repeat(40);
process.env.ENCRYPTION_KEY = "z".repeat(64);
process.env.APP_URL = "https://hub.test";
process.env.ADMIN_BASE_URL = "https://hub.test";

jest.mock("../../../src/config/database", () => {
  const query = jest.fn(async () => ({ rows: [], rowCount: 0 }));
  return {
    query,
    // Mirrors src/config/database: repositories call ex(client)(sql, params) so
    // a transaction-scoped call uses the transaction's client. Faking this
    // wrongly makes every repo in the app fail the same way — which is how the
    // documents repo got caught by this test.
    ex: (client) => (client ? client.query.bind(client) : query),
    transaction: jest.fn(async (fn) =>
      fn({ query: jest.fn(async () => ({ rows: [], rowCount: 0 })) }),
    ),
    healthcheck: jest.fn(async () => true),
    close: jest.fn(),
  };
});
jest.mock("../../../src/config/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
// The error handler reports 5xx to Kaizen (which touches the DB/queue).
jest.mock("../../../src/modules/kaizen/errors/errors.capture", () => ({
  captureError: jest.fn(),
}));
// Bytes on disk: the real service asks storage for the archived file.
jest.mock("../../../src/services/storage.service", () => {
  const actual = jest.requireActual("../../../src/services/storage.service");
  return { ...actual, get: jest.fn() };
});
// The comms ledger writes to Postgres; keep the call sites real, the writes fake.
jest.mock("../../../src/services/comms-log.service", () => {
  const actual = jest.requireActual("../../../src/services/comms-log.service");
  return {
    ...actual,
    record: jest.fn(async () => ({})),
    hasStatus: jest.fn(async () => false),
    listForReference: jest.fn(async () => []),
  };
});
// PDF rendering: mocked at the Puppeteer boundary so the render FALLBACK path
// can be exercised without a browser, while the real HTML builder runs.
jest.mock("../../../src/services/pdf.service", () => {
  const actual = jest.requireActual("../../../src/services/pdf.service");
  return { ...actual, renderAndStore: jest.fn() };
});
// Brand tokens + operator-editable document copy both read the DB at build time.
jest.mock("../../../src/modules/email_campaigns/email-render", () => {
  const actual = jest.requireActual(
    "../../../src/modules/email_campaigns/email-render",
  );
  return {
    ...actual,
    resolveBrandTokens: jest.fn(async (brand) => ({
      brand_name: brand === "pixiegirl" ? "Pixie Girl Global" : "Faitlyn Hair",
      brand_legal_name: "Faitlyn Hair Ltd",
      brand_color: "#690909",
      brand_address: "12 Admiralty Way, Lekki, Lagos",
      brand_phone: "+2348012345678",
      support_email: "care@faitlynhair.com",
      website_url: "https://faitlynhair.com",
    })),
  };
});
jest.mock("../../../src/services/document-copy", () => {
  const actual = jest.requireActual("../../../src/services/document-copy");
  return {
    ...actual,
    resolveCopy: jest.fn(async () => ({
      invoice: {
        pdf: {
          note_label: "Note",
          note: "Payment is due within 7 days.",
          note_label_paid: "Payment received",
          note_paid: "Settled in full — thank you.",
          message: "Thank you for shopping with us.",
        },
      },
      receipt: {
        pdf: {
          note_label: "Note",
          note: "Keep this receipt for your records.",
          message: "Thank you for your payment.",
        },
      },
    })),
  };
});

require("express-async-errors");
const express = require("express");
const request = require("supertest");

const db = require("../../../src/config/database");
const storage = require("../../../src/services/storage.service");
const commsLog = require("../../../src/services/comms-log.service");
const pdf = require("../../../src/services/pdf.service");
const {
  errorHandler,
  notFoundHandler,
} = require("../../../src/middleware/error-handler");
const { mountRoutes } = require("../../../src/routes/index");

const INVOICE_ID = "11111111-1111-4111-8111-111111111111";
const RECEIPT_ID = "22222222-2222-4222-8222-222222222222";
const ORDER_ID = "33333333-3333-4333-8333-333333333333";
const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";

const PDF_BYTES = Buffer.from("%PDF-1.4\n% archived invoice\n%%EOF\n");

const ARCHIVED_INVOICE_DOC = {
  document_id: "aaaa1111-1111-4111-8111-111111111111",
  business: "faitlynhair",
  document_type: "invoice",
  reference_type: "invoice",
  reference_id: INVOICE_ID,
  file_path: "faitlynhair/documents/0007.pdf",
  mime_type: "application/pdf",
  is_deleted: false,
  title: "Invoice FLH-INV-0159",
};

const ARCHIVED_RECEIPT_DOC = {
  document_id: "bbbb2222-2222-4222-8222-222222222222",
  business: "faitlynhair",
  document_type: "receipt",
  reference_type: "receipt",
  reference_id: RECEIPT_ID,
  file_path: "faitlynhair/documents/0009.pdf",
  mime_type: "application/pdf",
  is_deleted: false,
  title: "Receipt FLH-RCT-0003",
};

/** The row findById() returns — the columns the SQL actually selects. */
function invoiceRow() {
  return {
    invoice_id: INVOICE_ID,
    invoice_number: "FLH-INV-0159",
    order_id: ORDER_ID,
    contact_id: "c-1",
    contact_name: "Yinka Omohele",
    contact_email: "yinka@example.com",
    contact_phone: "+2348012345678",
    status: "sent",
    sent_via: "whatsapp",
    subtotal_ngn: "465000.00",
    discount_amount_ngn: "0.00",
    tax_amount_ngn: "0.00",
    wht_rate: "0.00",
    wht_amount_ngn: "0.00",
    shipping_fee_ngn: "0.00",
    total_ngn: "465000.00",
    amount_paid_ngn: "0.00",
    balance_due_ngn: "465000.00",
    display_currency: "NGN",
    display_subtotal: null,
    display_total: null,
    fx_rate_used: null,
    issue_date: "2026-09-20",
    due_date: "2026-09-27",
    payment_terms: "Net 7",
    issued_by: null,
    first_viewed_at: null,
    public_tracking_token: null,
    is_preorder: false,
    order_number: "FLH-SO-0231",
    order_status: "pending_payment",
    cust_line1: "1 Bridgetown Road",
    cust_line2: null,
    cust_area: null,
    cust_city: "Bridgetown",
    cust_state: "Barbados",
    lines: [
      {
        invoice_line_id: "l-1",
        description: "Jamila Rae Black — Medium · 13x6 Frontal",
        quantity: "1.000",
        unit_price_ngn: "465000.00",
        line_total_ngn: "465000.00",
        tax_amount_ngn: "0.00",
        display_order: 1,
      },
    ],
    payments: [],
  };
}

function receiptRow() {
  return {
    receipt_id: RECEIPT_ID,
    receipt_number: "FLH-RCT-0003",
    invoice_id: null,
    contact_id: "c-1",
    contact_name: "Hassan",
    contact_email: null,
    contact_phone: "+2348012345678",
    amount_ngn: "30000.00",
    display_amount: null,
    display_currency: null,
    fx_rate_used: null,
    payment_method: "bank_transfer",
    issued_at: "2026-09-22T10:00:00.000Z",
    issued_by: null,
    pdf_document_id: null,
    sent_to_email: null,
    sent_to_whatsapp: "+2348012345678",
    sent_at: "2026-09-22T10:05:00.000Z",
    notes: null,
    invoice_number: null,
  };
}

/**
 * A tiny SQL-aware driver: recognise the statements this flow issues and answer
 * with the rows Postgres would return. Anything unrecognised is empty — that
 * keeps unrelated boot-time queries harmless and makes an unexpected query in
 * this path visible as a failed assertion rather than a silent pass.
 */
/** The archived invoice doc, filed under whichever brand owns the invoice. */
function archivedInvoiceDoc(brand) {
  return {
    ...ARCHIVED_INVOICE_DOC,
    business: brand,
    file_path: `${brand}/documents/0007.pdf`,
  };
}

function installDb({
  invoiceBrand = "faitlynhair",
  invoiceBrands = [invoiceBrand],
  archivedDocs = [archivedInvoiceDoc(invoiceBrand), ARCHIVED_RECEIPT_DOC],
} = {}) {
  let firstViewed = false;

  db.query.mockImplementation(async (rawSql, params = []) => {
    const sql = String(rawSql).replace(/\s+/g, " ");

    // markFirstViewed — the IS NULL guard: only the first call returns a row.
    if (/^UPDATE \w+\.invoices SET first_viewed_at = now\(\)/.test(sql)) {
      if (firstViewed) return { rows: [], rowCount: 0 };
      firstViewed = true;
      return {
        rows: [{ first_viewed_at: "2026-09-22T22:00:00.000Z" }],
        rowCount: 1,
      };
    }

    // documents.listByReference
    if (/FROM shared\.documents WHERE business = \$1 AND reference_type = \$2/.test(sql)) {
      const [business, referenceType, referenceId] = params;
      const rows = archivedDocs.filter(
        (d) =>
          d.business === business &&
          d.reference_type === referenceType &&
          d.reference_id === referenceId,
      );
      return { rows, rowCount: rows.length };
    }

    // invoices.findById (the join the repo issues)
    if (/FROM \w+\.invoices i LEFT JOIN shared\.contacts/.test(sql)) {
      const brand = sql.match(/FROM ([\w]+)\.invoices i/)[1];
      const hit = params[0] === INVOICE_ID && invoiceBrands.includes(brand);
      return { rows: hit ? [invoiceRow()] : [], rowCount: hit ? 1 : 0 };
    }
    if (/FROM \w+\.invoice_lines WHERE invoice_id = \$1/.test(sql)) {
      return { rows: invoiceRow().lines, rowCount: 1 };
    }
    if (/FROM \w+\.invoice_payments ip/.test(sql)) {
      return { rows: [], rowCount: 0 };
    }

    // receipts.findById
    if (/FROM \w+\.receipts r LEFT JOIN shared\.contacts/.test(sql)) {
      const brand = sql.match(/FROM ([\w]+)\.receipts r/)[1];
      const hit = params[0] === RECEIPT_ID && brand === "faitlynhair";
      return { rows: hit ? [receiptRow()] : [], rowCount: hit ? 1 : 0 };
    }

    return { rows: [], rowCount: 0 };
  });
}

/**
 * server.js in miniature: mountRoutes() wires every router, then the JSON 404
 * and the global error handler close the chain (both live in server.js, not in
 * mountRoutes — the reason a bare mount returns express's HTML error page).
 */
function buildApp() {
  const app = express();
  installDb();
  mountRoutes(app);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

let app;

beforeAll(() => {
  storage.get.mockResolvedValue(PDF_BYTES);
  app = buildApp();
});

beforeEach(() => {
  jest.clearAllMocks();
  storage.get.mockResolvedValue(PDF_BYTES);
  installDb();
});

describe("GET /api/public/documents/invoice/:id — the canonical customer link", () => {
  test("serves the archived branded PDF inline (never JSON)", async () => {
    const res = await request(app).get(
      `/api/public/documents/invoice/${INVOICE_ID}`,
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-type"]).not.toContain("json");
    expect(res.headers["content-disposition"]).toBe(
      'inline; filename="Invoice FLH-INV-0159.pdf"',
    );
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.body.toString()).toContain("%PDF-1.4");
    // The archived file is served — the render fallback is untouched.
    expect(storage.get).toHaveBeenCalledWith(
      "faitlynhair/documents/0007.pdf",
    );
    expect(pdf.renderAndStore).not.toHaveBeenCalled();
  });

  test("brand resolution: the invoice is found even though no brand is in the URL", async () => {
    // Only pixiegirl holds this invoice in the fake — the brand-less lookup
    // must still find it, proving the cross-brand scan works in either order
    // (it walks the live brand registry, not a hardcoded list).
    installDb({ invoiceBrand: "pixiegirl" });

    const res = await request(app).get(
      `/api/public/documents/invoice/${INVOICE_ID}`,
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toBe(
      'inline; filename="Invoice FLH-INV-0159.pdf"',
    );
    expect(storage.get).toHaveBeenCalledWith("pixiegirl/documents/0007.pdf");
  });

  test("first open stamps the view and logs opened EXACTLY once", async () => {
    const first = await request(app).get(
      `/api/public/documents/invoice/${INVOICE_ID}`,
    );
    expect(first.status).toBe(200);
    expect(commsLog.record).toHaveBeenCalledTimes(1);
    expect(commsLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        business: "faitlynhair",
        contact_id: "c-1",
        event_key: "invoice.opened",
        status: "opened",
        reference_type: "invoice",
        reference_id: INVOICE_ID,
        // WhatsApp-sent invoice → the ledger attributes the open to WhatsApp.
        channel: "whatsapp",
      }),
    );

    // Second open: the IS NULL guard returns nothing, so no duplicate row.
    const second = await request(app).get(
      `/api/public/documents/invoice/${INVOICE_ID}`,
    );
    expect(second.status).toBe(200);
    expect(commsLog.record).toHaveBeenCalledTimes(1);
  });

  test("an invoice that was never archived renders once, then serves the PDF", async () => {
    installDb({ archivedDocs: [] });
    pdf.renderAndStore.mockResolvedValueOnce({
      document_id: "cccc3333-3333-4333-8333-333333333333",
      file_path: "faitlynhair/documents/0042.pdf",
      url: "https://hub.test/media/faitlynhair/documents/0042.pdf",
    });

    const res = await request(app).get(
      `/api/public/documents/invoice/${INVOICE_ID}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.toString()).toContain("%PDF-1.4");
    // The render went through the invoicing resolver, archiving under the
    // invoice reference so the next open is instant.
    expect(pdf.renderAndStore).toHaveBeenCalledTimes(1);
    expect(pdf.renderAndStore).toHaveBeenCalledWith(
      expect.objectContaining({
        brand: "faitlynhair",
        document_type: "invoice",
        reference_type: "invoice",
        reference_id: INVOICE_ID,
        title: "Invoice FLH-INV-0159",
      }),
    );
    expect(storage.get).toHaveBeenCalledWith(
      "faitlynhair/documents/0042.pdf",
    );
  });

  test("an unknown id is a clean JSON 404 (no stack trace, no PDF)", async () => {
    const res = await request(app).get(
      `/api/public/documents/invoice/${UNKNOWN_ID}`,
    );

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(storage.get).not.toHaveBeenCalled();
  });
});

describe("GET /i/:id — the short alias (Node-served hosts)", () => {
  test("serves the same PDF as the canonical path", async () => {
    const res = await request(app).get(`/i/${INVOICE_ID}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toBe(
      'inline; filename="Invoice FLH-INV-0159.pdf"',
    );
  });
});

describe("GET /api/public/documents/receipt/:id", () => {
  test("serves the archived receipt PDF and records the open once", async () => {
    const res = await request(app).get(
      `/api/public/documents/receipt/${RECEIPT_ID}`,
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toBe(
      'inline; filename="Receipt FLH-RCT-0003.pdf"',
    );
    expect(storage.get).toHaveBeenCalledWith("faitlynhair/documents/0009.pdf");
    expect(commsLog.record).toHaveBeenCalledTimes(1);
    expect(commsLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        event_key: "receipt.opened",
        reference_type: "receipt",
        reference_id: RECEIPT_ID,
      }),
    );
  });
});

describe("legacy links already sitting in customers' inboxes and DMs", () => {
  test("the old invoice view URL 301s, and the destination serves the PDF", async () => {
    const legacy = await request(app).get(
      `/api/public/invoices/faitlynhair/${INVOICE_ID}/view`,
    );

    expect(legacy.status).toBe(301);
    expect(legacy.headers.location).toBe(
      `/api/public/documents/invoice/${INVOICE_ID}`,
    );

    // A phone browser follows the redirect — do the same and confirm it lands
    // on bytes, not JSON.
    const followed = await request(app).get(legacy.headers.location);
    expect(followed.status).toBe(200);
    expect(followed.headers["content-type"]).toContain("application/pdf");
    expect(followed.body.toString()).toContain("%PDF-1.4");
  });

  test("the old receipt view URL 301s to the receipt document", async () => {
    const legacy = await request(app).get(
      `/api/public/receipts/faitlynhair/${RECEIPT_ID}/view`,
    );

    expect(legacy.status).toBe(301);
    expect(legacy.headers.location).toBe(
      `/api/public/documents/receipt/${RECEIPT_ID}`,
    );
  });

  test("a legacy URL with a bogus brand still resolves (the id is the credential)", async () => {
    const legacy = await request(app).get(
      `/api/public/invoices/pixiegirl/${INVOICE_ID}/view`,
    );

    expect(legacy.status).toBe(301);
    expect(legacy.headers.location).toBe(
      `/api/public/documents/invoice/${INVOICE_ID}`,
    );
  });

  test("the legacy path answers 301 before any document work happens", async () => {
    await request(app).get(
      `/api/public/invoices/faitlynhair/${INVOICE_ID}/view`,
    );

    expect(storage.get).not.toHaveBeenCalled();
    expect(commsLog.record).not.toHaveBeenCalled();
  });
});
