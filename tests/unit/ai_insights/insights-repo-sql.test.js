"use strict";

// Guards the raw SQL of the fulfilment-delay detector's source read.
//
// This bug class is INVISIBLE to the registry/service tests (they mock the
// whole repo away), so here we exercise the REAL repo with a mocked driver and
// assert the query keys on the right clock.
//
// Background: `placed_at` — and often `paid_at` — is never stamped for
// storefront / sales-campaign orders, so a bare `placed_at IS NOT NULL` guard
// matched ZERO orders and the "paid but undispatched" detector never fired
// once. The fix keys on COALESCE(paid_at, placed_at, created_at) (created_at is
// the only clock guaranteed non-NULL) — the same basis the sales list,
// dashboards and retention use. If anyone reverts to bare placed_at, this fails.

jest.mock("../../../src/config/database", () => ({
  query: jest.fn(),
  ex: jest.fn(),
}));
jest.mock("../../../src/config/brands", () => ({
  t: (brand, table) => `${brand}.${table}`,
}));

const db = require("../../../src/config/database");
const repo = require("../../../src/modules/ai_insights/insights.repo");

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockResolvedValue({ rows: [] });
});

describe("insights.repo.fulfillmentDelayedOrders — clock basis", () => {
  test("keys on COALESCE(paid_at, placed_at, created_at), never bare placed_at", async () => {
    await repo.fulfillmentDelayedOrders({ brand: "pixiegirl" });
    const sql = db.query.mock.calls[0][0];

    // Age + threshold + ordering all fall back through paid → placed → created.
    const coalesce = /COALESCE\(\s*paid_at\s*,\s*placed_at\s*,\s*created_at\s*\)/gi;
    expect(sql).toMatch(coalesce);
    expect(sql.match(coalesce).length).toBeGreaterThanOrEqual(3);

    // The exact anti-pattern that shipped the bug must never come back: a bare
    // NULL guard on placed_at silently drops every storefront/campaign order.
    expect(sql).not.toMatch(/placed_at\s+IS\s+NOT\s+NULL/i);

    // Still scoped to the fulfilment-relevant statuses + the right brand table.
    expect(sql).toMatch(/status\s+IN\s*\(\s*'paid'/i);
    expect(sql).toContain("pixiegirl.sales_orders");
  });
});
