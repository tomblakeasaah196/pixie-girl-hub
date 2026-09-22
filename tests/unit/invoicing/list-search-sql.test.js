"use strict";

// Guards the invoice LIST SQL — the read behind the messaging invoice picker,
// where an operator greps "yinka", "FLH-SO-0231" or an item name and expects
// the invoice to surface. The service/controller tests mock the repo away, so
// the query itself is only checkable here against a mocked driver.
//
// Two things this locks down:
//   1. the search filter greps invoice #, customer name, order # and the
//      invoice LINES (order details) — the four things ops actually types;
//   2. placeholder numbering stays consistent with the params array now that a
//      filter can sit between the WHERE clauses and LIMIT/OFFSET (an
//      off-by-one there means "there is no parameter $N" at runtime, in
//      production only, on a code path no other test executes).

jest.mock("../../../src/config/database", () => ({ query: jest.fn() }));
jest.mock("../../../src/config/brands", () => ({
  t: (brand, table) => `${brand}.${table}`,
  BRANDS: ["pixiegirl", "faitlynhair"],
}));

const db = require("../../../src/config/database");
const repo = require("../../../src/modules/invoicing/invoicing.repo");

/** Every `$n` in the SQL must have a real parameter; no gaps, no overflow. */
function assertPlaceholdersMatchParams(sql, params) {
  const used = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  const max = used.length ? Math.max(...used) : 0;
  expect(max).toBe(params.length);
  for (let n = 1; n <= max; n += 1) expect(used).toContain(n);
}

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockResolvedValue({ rows: [] });
});

describe("invoicing.repo.listInvoices — free-text search", () => {
  test("greps invoice #, customer name, order # and line descriptions", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    await repo.listInvoices({
      brand: "faitlynhair",
      filters: { search: "yinka" },
    });

    const countSql = db.query.mock.calls[0][0];
    const listSql = db.query.mock.calls[1][0];
    for (const [idx, sql] of [countSql, listSql].entries()) {
      expect(sql).toMatch(/i\.invoice_number ILIKE \$\d+/);
      expect(sql).toMatch(/c\.display_name ILIKE \$\d+/);
      expect(sql).toMatch(/o\.order_number ILIKE \$\d+/);
      expect(sql).toMatch(/l\.description ILIKE \$\d+/);
      assertPlaceholdersMatchParams(sql, db.query.mock.calls[idx][1]);
    }

    // One shared bound parameter for the four ILIKEs, wrapped in %…%.
    expect(db.query.mock.calls[0][1]).toEqual(["%yinka%"]);
    // Same clause is applied to the read, with LIMIT/OFFSET appended.
    expect(db.query.mock.calls[1][1].slice(0, 1)).toEqual(["%yinka%"]);
  });

  test("no search filter → no ILIKE, params still line up", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ total: 3 }] })
      .mockResolvedValueOnce({ rows: [] });

    await repo.listInvoices({
      brand: "faitlynhair",
      filters: { status: "sent" },
      page: 2,
      page_size: 25,
      offset: 25,
    });

    const listSql = db.query.mock.calls[1][0];
    expect(listSql).not.toMatch(/ILIKE/);
    expect(assertPlaceholdersMatchParams(listSql, db.query.mock.calls[1][1])).toBeUndefined();
    // status + page_size + offset, in order.
    expect(db.query.mock.calls[1][1]).toEqual(["sent", 25, 25]);
  });

  test("search combines with status without colliding placeholders", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    await repo.listInvoices({
      brand: "pixiegirl",
      filters: { status: "overdue", overdue: true, search: "FLH" },
      page: 1,
      page_size: 10,
      offset: 0,
    });

    const sql = db.query.mock.calls[1][0];
    expect(sql).toMatch(/i\.status = \$1/);
    expect(sql).toMatch(/l\.description ILIKE \$2/);
    assertPlaceholdersMatchParams(sql, db.query.mock.calls[1][1]);
    expect(db.query.mock.calls[1][1]).toEqual([
      "overdue",
      "%FLH%",
      10,
      0,
    ]);
  });

  test("list rows carry the order details the picker previews", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({ rows: [{ invoice_id: "i1" }] });

    await repo.listInvoices({ brand: "faitlynhair" });

    const sql = db.query.mock.calls[1][0];
    expect(sql).toMatch(/line_summary/);
    expect(sql).toMatch(/line_count/);
    expect(sql).toMatch(/invoice_lines/);
  });
});

describe("invoicing.repo — brand-less public lookups (/i and /r)", () => {
  test("findInvoiceByIdAnyBrand returns the owning brand and stops early", async () => {
    db.query
      .mockResolvedValueOnce({ rows: [] }) // pixiegirl: no such invoice
      .mockResolvedValueOnce({
        rows: [{ invoice_id: "inv-1", invoice_number: "FLH-INV-0159" }],
      }) // faitlynhair: hit
      .mockResolvedValueOnce({ rows: [] }); // its lines

    const hit = await repo.findInvoiceByIdAnyBrand("inv-1");

    expect(hit.brand).toBe("faitlynhair");
    expect(hit.invoice.invoice_number).toBe("FLH-INV-0159");
    // No probing beyond the brand that answered.
    const scanned = db.query.mock.calls.filter((c) =>
      /FROM pixiegirl\.invoices|FROM faitlynhair\.invoices/.test(c[0]),
    );
    expect(scanned).toHaveLength(2);
  });

  test("findInvoiceByIdAnyBrand → null for an id nobody owns", async () => {
    db.query.mockResolvedValue({ rows: [] });
    await expect(repo.findInvoiceByIdAnyBrand("nope")).resolves.toBeNull();
  });

  test("findReceiptByIdAnyBrand resolves the receipt's brand", async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{ receipt_id: "r1", receipt_number: "PXG-RCT-0001" }],
      })
      .mockResolvedValueOnce({ rows: [] });

    const hit = await repo.findReceiptByIdAnyBrand("r1");

    expect(hit.brand).toBe("pixiegirl");
    expect(hit.receipt.receipt_number).toBe("PXG-RCT-0001");
  });
});
