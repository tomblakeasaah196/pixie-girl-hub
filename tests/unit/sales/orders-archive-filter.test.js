"use strict";

/**
 * Orders archive (cancelled orders) — the list filter that keeps them out of the
 * working table, and the restore guard rails.
 *
 * The Orders table is a working list, so cancelled rows are hidden by default
 * via `exclude_status` and only the Archive drawer asks for them (status =
 * 'cancelled'). An explicit status pick must always win, otherwise choosing
 * "Cancelled" in the dropdown would return nothing.
 *
 * Restoring matters more than it looks: cancelling RELEASES the order's stock
 * hold and, when a deposit had been paid, forfeits it to Other Income with a
 * journal entry. So a restore has to re-hold stock, and must refuse outright
 * where money already moved on the books.
 */

jest.mock("../../../src/config/database", () => ({
  ex: (client) => client.query.bind(client),
  query: jest.fn(),
  transaction: jest.fn(),
}));

const repo = require("../../../src/modules/sales/sales.repo");

const BRAND = "faitlynhair";

function mockClient(rows = []) {
  return { query: jest.fn().mockResolvedValue({ rows }) };
}

/** Pull the WHERE clause out of the generated list SQL. */
function whereOf(sql) {
  const i = sql.indexOf("WHERE");
  if (i === -1) return "";
  const j = sql.indexOf("ORDER BY", i);
  return sql.slice(i, j === -1 ? undefined : j);
}

describe("listOrders — archive filtering", () => {
  test("hides the excluded status when no explicit status is chosen", async () => {
    const client = mockClient([{ total: 0 }]);
    await repo.listOrders({
      client,
      brand: BRAND,
      filters: { exclude_status: "cancelled" },
      page: 1,
      page_size: 25,
    });
    const sql = client.query.mock.calls[0][0];
    expect(whereOf(sql)).toMatch(/so\.status <> \$\d+/);
    expect(client.query.mock.calls[0][1]).toContain("cancelled");
  });

  test("an explicit status wins — picking 'Cancelled' still returns them", async () => {
    const client = mockClient([{ total: 0 }]);
    await repo.listOrders({
      client,
      brand: BRAND,
      filters: { status: "cancelled", exclude_status: "cancelled" },
      page: 1,
      page_size: 25,
    });
    const where = whereOf(client.query.mock.calls[0][0]);
    expect(where).toMatch(/so\.status = \$\d+/);
    // The two must never both apply, or the query is self-cancelling.
    expect(where).not.toMatch(/so\.status <> \$\d+/);
  });

  test("neither clause appears when no status filtering is requested", async () => {
    const client = mockClient([{ total: 0 }]);
    await repo.listOrders({
      client,
      brand: BRAND,
      filters: {},
      page: 1,
      page_size: 25,
    });
    const where = whereOf(client.query.mock.calls[0][0]);
    expect(where).not.toMatch(/so\.status/);
  });
});

describe("statusBeforeCancellation", () => {
  test("reads the most recent transition INTO cancelled", async () => {
    const client = mockClient([{ from_status: "pending_payment" }]);
    const s = await repo.statusBeforeCancellation({
      client,
      brand: BRAND,
      id: "o1",
    });
    expect(s).toBe("pending_payment");
    const sql = client.query.mock.calls[0][0];
    expect(sql).toMatch(/to_status = 'cancelled'/);
    expect(sql).toMatch(/from_status IS NOT NULL/);
    // Newest first — an order cancelled twice must restore to the latest state.
    expect(sql).toMatch(/ORDER BY changed_at DESC/);
    expect(sql).toMatch(/LIMIT 1/);
  });

  test("returns null for a legacy order with no recorded transition", async () => {
    const client = mockClient([]);
    await expect(
      repo.statusBeforeCancellation({ client, brand: BRAND, id: "o1" }),
    ).resolves.toBeNull();
  });
});

describe("clearCancellation", () => {
  test("wipes every cancellation stamp so the order looks live again", async () => {
    const client = mockClient([]);
    await repo.clearCancellation({ client, brand: BRAND, id: "o1" });
    const sql = client.query.mock.calls[0][0];
    expect(sql).toMatch(/cancelled_at = NULL/);
    expect(sql).toMatch(/cancellation_reason = NULL/);
    // The abandonment sweep writes this one; leaving it set would keep the
    // restored order looking abandoned in the Sales views.
    expect(sql).toMatch(/abandonment_reason = NULL/);
  });
});
