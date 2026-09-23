"use strict";

/**
 * Purchase orders: creating one, and receiving it into stock.
 *
 * Creating a PO failed every time, for three independent reasons — each of
 * which alone was fatal:
 *
 *   1. The form posted a shape the API's `.strict()` schema rejects
 *      (`quantity`, `unit_price_original`, per-line `currency`; no `title`,
 *      no `po_currency`).
 *   2. `nextNumber` called the RAW `fn_next_document_number`, which RAISEs
 *      when shared.document_numbering has no row for (brand,'purchase_order')
 *      — and nothing ever seeded that type. The RAISE aborts the transaction,
 *      so the PO died on its first statement.
 *   3. `addPoLine` used `COALESCE($n, 0)`, which makes Postgres infer INTEGER
 *      for that parameter. tax_amount_ngn is always a money string ("0.00"),
 *      so every line insert failed with `invalid input syntax for type
 *      integer`.
 *
 * And once created, a PO had no way into the warehouse: receiving was re-keyed
 * by hand and the order never learned what had landed.
 */

const mockCalls = { lines: [], receipts: [], statuses: [] };

jest.mock("../../../src/config/database", () => ({
  transaction: (fn) => fn({}),
  query: jest.fn(),
  ex: () => jest.fn(async () => ({ rows: [] })),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/modules/purchasing/purchasing.events", () => ({
  emit: jest.fn(),
  on: jest.fn(),
}));
jest.mock("../../../src/modules/stock/stock.repo", () => ({
  defaultVariantForProduct: jest.fn(async ({ product_id }) =>
    product_id === "prod-1" ? { variant_id: "var-1" } : null,
  ),
  // PO authoring now checks that even an auto-selected base variant is active;
  // the old fixture omitted this newer repository lookup entirely.
  variantForIntake: jest.fn(async ({ variant_id }) => ({
    variant_id, product_id: "prod-1", is_active: true, is_deleted: false, catalogue_role: "base",
  })),
}));
jest.mock("../../../src/modules/purchasing/purchasing.repo", () => ({
  nextNumber: jest.fn(async () => "FLH-PO-0001"),
  createPo: jest.fn(async ({ row }) => ({ po_id: "po-1", ...row })),
  addPoLine: jest.fn(async ({ line }) => {
    mockCalls.lines.push(line);
    return line;
  }),
  setPoTotals: jest.fn(async () => ({})),
  addPoHistory: jest.fn(async () => ({})),
  getPo: jest.fn(async () => ({
    po_id: "po-1",
    po_number: "FLH-PO-0001",
    status: "draft",
    delivery_location_id: "loc-1",
  })),
  incrementPoLineReceived: jest.fn(async (args) => {
    mockCalls.receipts.push(args);
    return {};
  }),
  rollupPoReceived: jest.fn(async () => ({})),
  outstandingPoLines: jest.fn(async () => mockCalls.outstanding),
  setPoStatus: jest.fn(async ({ status }) => {
    mockCalls.statuses.push(status);
    return { status };
  }),
}));

const service = require("../../../src/modules/purchasing/purchasing.service");
const repo = require("../../../src/modules/purchasing/purchasing.repo");

const BRAND = "faitlynhair";
const USER = { user_id: "ops-1", display_name: "Ops" };

beforeEach(() => {
  jest.clearAllMocks();
  mockCalls.lines = [];
  mockCalls.receipts = [];
  mockCalls.statuses = [];
  mockCalls.outstanding = [];
});

describe("createPo", () => {
  it("resolves a base product to the variant the warehouse will receive", async () => {
    // The picker hands over a base product; po_lines store a variant. If those
    // two ever disagree, a delivery can't book itself back against the order.
    await service.createPo({
      brand: BRAND,
      user: USER,
      request_id: null,
      input: {
        supplier_id: "sup-1",
        title: "July restock",
        po_currency: "CNY",
        fx_rate: 230,
        lines: [
          {
            product_id: "prod-1",
            description: "Black Straight HD13x4",
            qty_ordered: 100,
            unit_price: 55,
          },
        ],
      },
    });

    expect(mockCalls.lines[0].variant_id).toBe("var-1");
    // product_id is not a po_lines column — it must not reach the insert.
    expect(mockCalls.lines[0].product_id).toBeUndefined();
    expect(mockCalls.lines[0].qty_ordered).toBe(100);
    expect(mockCalls.lines[0].line_total_ngn).toBe("1265000.00");
  });

  it("still orders a product that can't hold stock — it just isn't linked", async () => {
    // Freight, samples, a style not yet in the catalogue.
    await service.createPo({
      brand: BRAND,
      user: USER,
      request_id: null,
      input: {
        supplier_id: "sup-1",
        title: "Air freight",
        po_currency: "USD",
        lines: [{ description: "Air freight", qty_ordered: 1, unit_price: 400 }],
      },
    });

    expect(mockCalls.lines).toHaveLength(1);
    expect(mockCalls.lines[0].variant_id).toBeUndefined();
  });

  it("takes its number from the guarded helper, never the raw RAISE-ing function", async () => {
    await service.createPo({
      brand: BRAND,
      user: USER,
      request_id: null,
      input: {
        supplier_id: "sup-1",
        title: "x",
        po_currency: "CNY",
        lines: [{ description: "x", qty_ordered: 1, unit_price: 1 }],
      },
    });
    expect(repo.nextNumber).toHaveBeenCalledWith(
      expect.objectContaining({ type: "purchase_order" }),
    );
  });
});

describe("applyReceiptToPo", () => {
  it("a short delivery leaves the balance outstanding", async () => {
    mockCalls.outstanding = [{ line_id: "l-1", qty_outstanding: 40 }];

    const result = await service.applyReceiptToPo({
      client: {},
      brand: BRAND,
      user: USER,
      po_id: "po-1",
      lines: [{ po_line_id: "l-1", quantity: 60 }],
    });

    expect(mockCalls.receipts[0]).toMatchObject({
      po_line_id: "l-1",
      qty_received: 60,
    });
    expect(result.status).toBe("partially_received");
    expect(result.still_outstanding).toBe(40);
  });

  it("closes the order once nothing is outstanding", async () => {
    mockCalls.outstanding = [{ line_id: "l-1", qty_outstanding: 0 }];

    const result = await service.applyReceiptToPo({
      client: {},
      brand: BRAND,
      user: USER,
      po_id: "po-1",
      lines: [{ po_line_id: "l-1", quantity: 40 }],
    });

    expect(result.status).toBe("received");
    expect(mockCalls.statuses).toContain("received");
  });

  it("records the delivery even on a PO left sitting in an early status", async () => {
    // The paperwork must not override what is physically on the shelf: a PO
    // nobody walked through in_transit/arrived_lagos still receives.
    repo.getPo.mockResolvedValueOnce({
      po_id: "po-1",
      po_number: "FLH-PO-0001",
      status: "draft",
    });
    mockCalls.outstanding = [{ line_id: "l-1", qty_outstanding: 0 }];

    const result = await service.applyReceiptToPo({
      client: {},
      brand: BRAND,
      user: USER,
      po_id: "po-1",
      lines: [{ po_line_id: "l-1", quantity: 100 }],
    });

    expect(result.status).toBe("received");
  });

  it("leaves a closed or cancelled order's status alone", async () => {
    repo.getPo.mockResolvedValueOnce({ po_id: "po-1", status: "cancelled" });
    mockCalls.outstanding = [{ line_id: "l-1", qty_outstanding: 0 }];

    await service.applyReceiptToPo({
      client: {},
      brand: BRAND,
      user: USER,
      po_id: "po-1",
      lines: [{ po_line_id: "l-1", quantity: 1 }],
    });

    expect(mockCalls.statuses).toHaveLength(0);
  });
});
