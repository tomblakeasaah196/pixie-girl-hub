"use strict";

/**
 * Regression cover for the bug that made EVERY order line a pre-order.
 *
 * `<brand>.fn_next_document_number(type)` RAISEs when shared.document_numbering
 * has no row for (business, type). A RAISE inside a transaction aborts the whole
 * transaction, so the call has to be wrapped in a SAVEPOINT, the row
 * provisioned, and the call retried.
 *
 * stock.repo.nextMovementNumber called the raw function for 'stock_movement' —
 * a type nothing in the codebase ever seeded. Every stock_movements insert
 * therefore RAISEd, so reserveForOrder threw, so createOrder rolled back its
 * per-line reserve savepoint and recorded the line as a pre-order. It happened
 * on every line of every order on every channel no matter how much stock was on
 * the shelf, and the pre-order fallback swallowed it as a routine stock-out.
 */

jest.mock("../../../src/config/database", () => ({
  ex: (client) => (client ? client.query.bind(client) : jest.fn()),
  query: jest.fn(),
}));

const {
  nextDocumentNumber,
  isMissingSequence,
  DOC_SUFFIX,
} = require("../../../src/shared/numbering/document-number");
const stockRepo = require("../../../src/modules/stock/stock.repo");

const BRAND = "faitlynhair";

/** The RAISE the SQL function throws when the sequence row is absent. */
function missingSequenceError() {
  const err = new Error(
    `No document_numbering row for (${BRAND}, stock_movement)`,
  );
  err.code = "P0001";
  return err;
}

/**
 * Mock transaction client. `failFirstCall` makes the first
 * fn_next_document_number call RAISE, as an unprovisioned brand would.
 */
function mockClient({ failFirstNumbering = false } = {}) {
  let numberingCalls = 0;
  const calls = [];
  const query = jest.fn(async (sql, params) => {
    calls.push({ sql, params });
    if (/fn_next_document_number/.test(sql)) {
      numberingCalls += 1;
      if (failFirstNumbering && numberingCalls === 1) throw missingSequenceError();
      return { rows: [{ n: "FLH-MOV-0001" }] };
    }
    if (/SELECT split_part/.test(sql)) return { rows: [{ root: "FLH" }] };
    return { rows: [] };
  });
  return { query, calls, sqls: () => calls.map((c) => c.sql) };
}

describe("isMissingSequence", () => {
  test("recognises the function's own RAISE", () => {
    expect(isMissingSequence(missingSequenceError())).toBe(true);
  });

  test("does not swallow unrelated database errors", () => {
    const other = new Error("deadlock detected");
    other.code = "40P01";
    expect(isMissingSequence(other)).toBe(false);
  });
});

describe("nextDocumentNumber", () => {
  test("guards the call with a SAVEPOINT inside a transaction", async () => {
    const client = mockClient();
    await nextDocumentNumber({ client, brand: BRAND, type: "stock_movement" });
    const sqls = client.sqls();
    // Without the savepoint a RAISE would abort the caller's transaction and
    // every later statement would fail with 25P02.
    expect(sqls[0]).toBe("SAVEPOINT pgh_docnum");
    expect(sqls).toContain("RELEASE SAVEPOINT pgh_docnum");
  });

  test("provisions the missing row and retries, rather than throwing", async () => {
    const client = mockClient({ failFirstNumbering: true });
    const n = await nextDocumentNumber({
      client,
      brand: BRAND,
      type: "stock_movement",
    });
    expect(n).toBe("FLH-MOV-0001");

    const sqls = client.sqls();
    expect(sqls).toContain("ROLLBACK TO SAVEPOINT pgh_docnum");
    const insert = client.calls.find((c) =>
      /INSERT INTO shared\.document_numbering/.test(c.sql),
    );
    expect(insert).toBeDefined();
    expect(insert.params).toEqual([BRAND, "stock_movement", "FLH-MOV", ]);
  });

  test("re-raises an error that is not a missing sequence", async () => {
    const client = {
      query: jest.fn(async (sql) => {
        if (/fn_next_document_number/.test(sql)) {
          const err = new Error("deadlock detected");
          err.code = "40P01";
          throw err;
        }
        return { rows: [] };
      }),
    };
    await expect(
      nextDocumentNumber({ client, brand: BRAND, type: "stock_movement" }),
    ).rejects.toThrow("deadlock detected");
  });

  test("carries the house suffix for every stock document type", () => {
    expect(DOC_SUFFIX.stock_movement).toBe("MOV");
    expect(DOC_SUFFIX.stock_transfer).toBe("TRF");
    expect(DOC_SUFFIX.stock_adjustment).toBe("ADJ");
  });
});

describe("stock.repo numbering goes through the guard", () => {
  test("nextMovementNumber survives an unprovisioned brand", async () => {
    const client = mockClient({ failFirstNumbering: true });
    await expect(
      stockRepo.nextMovementNumber({ client, brand: BRAND }),
    ).resolves.toBe("FLH-MOV-0001");
    expect(client.sqls()).toContain("SAVEPOINT pgh_docnum");
  });

  test("nextDocNumber (transfers/adjustments) is guarded too", async () => {
    const client = mockClient({ failFirstNumbering: true });
    await expect(
      stockRepo.nextDocNumber({
        client,
        brand: BRAND,
        type: "stock_adjustment",
      }),
    ).resolves.toBe("FLH-MOV-0001");
    expect(client.sqls()).toContain("SAVEPOINT pgh_docnum");
  });
});
