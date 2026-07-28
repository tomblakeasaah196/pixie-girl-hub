"use strict";

// ensureQuotationOrder — the hinge of the quotation pay rail (000090).
//
// When a quote payment confirms, the webhook calls this to materialise the
// order. Gateways re-deliver webhooks, so the ONE thing that must never happen
// is a quote producing two orders.
//
// Scope note: these tests cover the branches that resolve WITHOUT converting —
// the idempotent short-circuit, the stale-pointer repair, and not-found. The
// conversion itself runs createOrder's full pricing/stock transaction, which
// needs a real schema; that half is asserted in
// tests/integration/quotation-conversion.test.js.

const QUOTE = {
  quotation_id: "quo-1",
  quotation_number: "PXG-QUO-0001",
  status: "accepted",
  contact_id: "contact-1",
  converted_sales_order_id: null,
  lines: [],
};

let mockQuoteRow;
let mockOrderRows;
const mockStatusUpdates = [];

jest.mock("../../../src/modules/sales/sales.repo", () => ({
  findQuotationById: jest.fn(async () => mockQuoteRow),
  findById: jest.fn(async ({ id }) => mockOrderRows[id] || null),
  setQuotationStatus: jest.fn(async ({ status, extra }) => {
    mockStatusUpdates.push({ status, ...extra });
    mockQuoteRow = { ...mockQuoteRow, status, ...extra };
    return mockQuoteRow;
  }),
}));

const service = require("../../../src/modules/sales/sales.service");
const repo = require("../../../src/modules/sales/sales.repo");

beforeEach(() => {
  mockQuoteRow = { ...QUOTE };
  mockOrderRows = {};
  mockStatusUpdates.length = 0;
  jest.clearAllMocks();
});

describe("ensureQuotationOrder", () => {
  test("a re-delivered webhook returns the existing order without reconverting", async () => {
    // This is the retry case: the first delivery already converted, so the
    // second must resolve to the SAME order and leave the quote untouched.
    mockOrderRows["ord-1"] = { order_id: "ord-1", order_number: "PXG-SO-0001" };
    mockQuoteRow = {
      ...QUOTE,
      status: "converted",
      converted_sales_order_id: "ord-1",
    };

    const order = await service.ensureQuotationOrder({
      brand: "pixiegirl",
      quotation_id: "quo-1",
    });

    expect(order.order_id).toBe("ord-1");
    // No second conversion — the quote's status was not rewritten.
    expect(repo.setQuotationStatus).not.toHaveBeenCalled();
  });

  test("clears a stale pointer before reconverting when the order is gone", async () => {
    // The quote says 'converted' but the order it names doesn't exist (deleted,
    // or a half-written legacy row). Stranding the customer's payment is worse
    // than making a fresh order — but convertQuotation's own guard rejects a
    // quote still marked 'converted', so the status must be reset first.
    mockQuoteRow = {
      ...QUOTE,
      status: "converted",
      converted_sales_order_id: "ord-missing",
    };

    // The reconversion runs createOrder (a full DB transaction), so it throws
    // here; what this test pins is the repair that happens BEFORE it.
    await service
      .ensureQuotationOrder({ brand: "pixiegirl", quotation_id: "quo-1" })
      .catch(() => {});

    expect(mockStatusUpdates[0]).toEqual({
      status: "accepted",
      converted_sales_order_id: null,
    });
  });

  test("throws 404 for an unknown quotation", async () => {
    repo.findQuotationById.mockResolvedValueOnce(null);
    await expect(
      service.ensureQuotationOrder({
        brand: "pixiegirl",
        quotation_id: "nope",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", http_status: 404 });
  });
});
