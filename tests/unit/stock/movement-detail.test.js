"use strict";

/**
 * Movement detail — the payload behind the Stock → Movement modal.
 *
 * A movement row on its own ("SALE −1") can't be read: it names no order, no
 * channel and no operator. The detail query resolves the soft FK
 * (reference_type + reference_id) to the document that caused the movement,
 * and each join is guarded on reference_type so a UUID that happens to exist
 * in two tables can never cross-match. These tests pin both.
 */

const captured = [];

jest.mock("../../../src/config/database", () => ({
  ex: () => (sql, params) => {
    captured.push({ sql, params });
    // The detail query is the one selecting sm.* ; siblings select movement_id.
    if (/sm\.\*/.test(sql)) {
      return Promise.resolve({
        rows: [
          {
            movement_id: "mov-1",
            movement_number: "FLH-MOV-0371",
            movement_type: "sale",
            reference_type: "sales_order",
            reference_id: "ord-1",
            order_number: "FLH-SO-0100",
            customer_name: "Ada Obi",
            reference_number: "FLH-SO-0100",
          },
        ],
      });
    }
    return Promise.resolve({
      rows: [{ movement_id: "mov-2", movement_number: "FLH-MOV-0372" }],
    });
  },
  query: jest.fn(),
  transaction: jest.fn(),
}));

const repo = require("../../../src/modules/stock/stock.repo");

const BRAND = "faitlynhair";

beforeEach(() => {
  captured.length = 0;
});

describe("getMovementById", () => {
  test("resolves the source document and the parties on it", async () => {
    const row = await repo.getMovementById({
      brand: BRAND,
      movement_id: "mov-1",
    });

    expect(row.order_number).toBe("FLH-SO-0100");
    expect(row.customer_name).toBe("Ada Obi");
    expect(captured[0].params).toEqual(["mov-1"]);
  });

  test("every source join is guarded on reference_type", async () => {
    await repo.getMovementById({ brand: BRAND, movement_id: "mov-1" });
    const { sql } = captured[0];

    expect(sql).toContain("sm.reference_type = 'sales_order'");
    expect(sql).toContain("sm.reference_type = 'adjustment'");
    expect(sql).toContain("sm.reference_type = 'transfer'");
    expect(sql).toContain("sm.reference_type = 'pos_transaction'");
    expect(sql).toContain(
      "sm.reference_type IN ('inbound_shipment','goods_received_note')",
    );
  });

  test("the list query resolves the same source columns", async () => {
    await repo.listMovements({ brand: BRAND, page: 1, page_size: 10 });
    const listSql = captured.find((c) => /sm\.\*/.test(c.sql)).sql;

    expect(listSql).toContain("reference_number");
    expect(listSql).toContain("ct.display_name AS customer_name");
    expect(listSql).toContain("performed_by_name");
  });
});

describe("siblingMovements", () => {
  test("scopes to the same source document and excludes the movement itself", async () => {
    const rows = await repo.siblingMovements({
      brand: BRAND,
      movement: {
        movement_id: "mov-1",
        reference_type: "sales_order",
        reference_id: "ord-1",
      },
    });

    expect(rows).toHaveLength(1);
    expect(captured[0].params).toEqual(["sales_order", "ord-1", "mov-1"]);
    expect(captured[0].sql).toContain("sm.movement_id <> $3");
  });

  test("an unlinked (manually logged) movement has no siblings — no query", async () => {
    const rows = await repo.siblingMovements({
      brand: BRAND,
      movement: { movement_id: "mov-9", reference_type: null },
    });

    expect(rows).toEqual([]);
    expect(captured).toHaveLength(0);
  });
});
