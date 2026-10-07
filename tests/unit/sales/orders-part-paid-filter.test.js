"use strict";

/**
 * The collection view's "Partially Paid" filter is a money query, not a
 * lifecycle-status query. An order can be Assigned / Ready / Dispatched while
 * a balance is still outstanding, so `status = 'partially_paid'` would hide a
 * real debtor. It also must not be limited to the Flexi Pay payment plan:
 * legacy and full-plan orders can have a valid recorded part payment.
 */

jest.mock("../../../src/config/database", () => ({
  ex: (client) => client.query.bind(client),
  query: jest.fn(),
  transaction: jest.fn(),
}));

const repo = require("../../../src/modules/sales/sales.repo");

const BRAND = "faitlynhair";

function mockClient() {
  return { query: jest.fn().mockResolvedValue({ rows: [{ total: 0 }] }) };
}

function whereOf(sql) {
  const start = sql.indexOf("WHERE");
  if (start === -1) return "";
  const end = sql.indexOf("ORDER BY", start);
  return sql.slice(start, end === -1 ? undefined : end);
}

describe("listOrders — Partially Paid collection filter", () => {
  test("finds every live order with money received and a balance due", async () => {
    const client = mockClient();

    await repo.listOrders({
      client,
      brand: BRAND,
      filters: { part_paid: true },
      page: 1,
      page_size: 25,
    });

    const where = whereOf(client.query.mock.calls[0][0]);
    expect(where).toMatch(/so\.amount_paid_ngn > 0/);
    expect(where).toMatch(/so\.balance_due_ngn > 0/);
  });

  test("does not restrict debtors to Flexi Pay or an exact lifecycle status", async () => {
    const client = mockClient();

    await repo.listOrders({
      client,
      brand: BRAND,
      filters: { part_paid: true },
      page: 1,
      page_size: 25,
    });

    const where = whereOf(client.query.mock.calls[0][0]);
    expect(where).not.toMatch(/payment_plan/);
    expect(where).not.toMatch(/so\.status = \$\d+/);
  });

  test("excludes drafts and cancellation, refund, and failure flows from collection work", async () => {
    const client = mockClient();

    await repo.listOrders({
      client,
      brand: BRAND,
      filters: { part_paid: true },
      page: 1,
      page_size: 25,
    });

    const where = whereOf(client.query.mock.calls[0][0]);
    expect(where).toContain(
      "so.status NOT IN ('draft','cancellation_requested','cancelled','refunded','failed')",
    );
  });
});
