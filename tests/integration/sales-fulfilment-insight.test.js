"use strict";

/**
 * Sales fulfilment-delay insight — DB integration (regression guard).
 *
 * Proves, against a real schema, that the "paid but not dispatched" detector
 * clocks order age from COALESCE(paid_at, placed_at, created_at) — NOT bare
 * `placed_at`. `placed_at`/`paid_at` are NULL for storefront + sales-campaign
 * orders, so keying on bare `placed_at` matched ZERO orders (the bug). A paid
 * order created 5 days ago with NULL placed_at/paid_at MUST surface; a fresh
 * one must not.
 *
 * OPT-IN: needs a migrated + seeded DB (borrows any existing shared.contacts
 * row for the NOT-NULL contact_id FK; skips gracefully if the DB has none).
 *
 *   RUN_DB_TESTS=1 DB_HOST=localhost DB_NAME=pixie_hub_test ... \
 *     npx jest tests/integration/sales-fulfilment-insight
 *
 * Seeds its own orders and tears them down.
 */

const RUN = process.env.RUN_DB_TESTS === "1";
const db = require("../../src/config/database");
const insightsRepo = require("../../src/modules/ai_insights/insights.repo");

const suite = RUN ? describe : describe.skip;
const BRAND = "pixiegirl";
const TAG = `SO-FDTEST-${Date.now().toString(36).toUpperCase()}`;

suite("Sales fulfilment-delay insight (DB)", () => {
  let contactId = null;
  const orderIds = [];

  beforeAll(async () => {
    await db.initDatabase();
    const { rows } = await db.query(
      `SELECT contact_id FROM shared.contacts LIMIT 1`,
    );
    contactId = rows[0] ? rows[0].contact_id : null;
  });

  afterAll(async () => {
    for (const id of orderIds) {
      await db
        .query(`DELETE FROM ${BRAND}.sales_orders WHERE order_id = $1`, [id])
        .catch(() => {});
    }
    await db.closeDatabase();
  });

  // Seeds a PAID order with NULL placed_at + NULL paid_at (the storefront /
  // campaign shape), created `ageDays` ago, and returns its id.
  async function seedOrder({ ageDays, number }) {
    const { rows } = await db.query(
      `INSERT INTO ${BRAND}.sales_orders
         (order_number, contact_id, sales_channel, status, total_ngn,
          placed_at, paid_at, created_at)
       VALUES ($1,$2,'storefront','paid','50000.00',
               NULL, NULL, now() - ($3 || ' days')::interval)
       RETURNING order_id`,
      [number, contactId, String(ageDays)],
    );
    orderIds.push(rows[0].order_id);
    return rows[0].order_id;
  }

  test("paid order, NULL placed_at, created 5 days ago → flagged", async () => {
    if (!contactId) return; // no seed contact → nothing to hang the FK on; skip
    const id = await seedOrder({ ageDays: 5, number: `${TAG}-A` });
    const rows = await insightsRepo.fulfillmentDelayedOrders({ brand: BRAND });
    const hit = rows.find((r) => r.order_id === id);
    expect(hit).toBeTruthy();
    expect(Number(hit.age_days)).toBeGreaterThanOrEqual(4);
  });

  test("fresh paid order (created just now) → NOT flagged (under the 3-day gate)", async () => {
    if (!contactId) return;
    const id = await seedOrder({ ageDays: 0, number: `${TAG}-B` });
    const rows = await insightsRepo.fulfillmentDelayedOrders({ brand: BRAND });
    expect(rows.find((r) => r.order_id === id)).toBeFalsy();
  });
});
