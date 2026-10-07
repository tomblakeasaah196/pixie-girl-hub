"use strict";

/**
 * Sales → Orders — the **Outstanding Balance** collection view.
 *
 * The Partially Paid filter (PR #750) answers "who has paid something and still
 * owes the rest?". It cannot answer the question the production audit actually
 * raised — "which ACTIVE customers owe us money?" — because a customer who has
 * paid ₦0 is invisible to it. Those are exactly the WhatsApp / staff-negotiated
 * orders the expiry policy deliberately leaves on the slow lane: their
 * cancellation timing is unchanged, so collections has to be able to SEE them.
 *
 * Semantics (locked by the owner):
 *   so.balance_due_ngn > 0
 *   AND so.status NOT IN ('draft','cancellation_requested','cancelled',
 *                         'refunded','failed')
 *
 * Two things this must never do:
 *   • require money to have been received (that is Partially Paid, not this);
 *   • read a lifecycle status as a payment state — a part-paid order can be
 *     assigned / order_ready / dispatched / completed and still owe us.
 * Cancelled balances stay on their rows as history; they just leave the queue.
 */

jest.mock("../../../src/config/database", () => ({
  ex: (client) => client.query.bind(client),
  query: jest.fn(),
  transaction: jest.fn(),
}));

const repo = require("../../../src/modules/sales/sales.repo");
const {
  COLLECTION_EXCLUDED_STATES_SQL,
} = require("../../../src/modules/sales/order-status");

const BRAND = "faitlynhair";
const DEAD_STATES =
  "so.status NOT IN ('draft','cancellation_requested','cancelled','refunded','failed')";

function mockClient() {
  return { query: jest.fn().mockResolvedValue({ rows: [{ total: 0 }] }) };
}

function whereOf(sql) {
  const start = sql.indexOf("WHERE");
  if (start === -1) return "";
  const end = sql.indexOf("ORDER BY", start);
  return sql.slice(start, end === -1 ? undefined : end);
}

async function listWhere(filters) {
  const client = mockClient();
  await repo.listOrders({
    client,
    brand: BRAND,
    filters,
    page: 1,
    page_size: 25,
  });
  return whereOf(client.query.mock.calls[0][0]);
}

describe("listOrders — Outstanding Balance collection filter", () => {
  test("takes every active order with a balance due", async () => {
    const where = await listWhere({ outstanding_balance: true });
    expect(where).toMatch(/so\.balance_due_ngn > 0/);
  });

  test("does NOT require money to have been received — ₦0-paid orders are receivables", async () => {
    // The whole point of the view: a pending_payment order with ₦0 paid is
    // still money the customer owes us.
    const where = await listWhere({ outstanding_balance: true });
    expect(where).not.toMatch(/amount_paid_ngn/);
  });

  test("excludes draft, cancellation-requested, cancelled, refunded and failed orders", async () => {
    const where = await listWhere({ outstanding_balance: true });
    expect(where).toContain(DEAD_STATES);
  });

  test("the excluded set is the lifecycle SSOT, not a re-typed list", async () => {
    // Drift guard: sales.repo, the collections summary and the report export all
    // read COLLECTION_EXCLUDED_STATES_SQL from order-status.js.
    expect(COLLECTION_EXCLUDED_STATES_SQL).toBe(
      "('draft','cancellation_requested','cancelled','refunded','failed')",
    );
    const where = await listWhere({ outstanding_balance: true });
    expect(where).toContain(
      `so.status NOT IN ${COLLECTION_EXCLUDED_STATES_SQL}`,
    );
  });

  test("is not limited to a lifecycle status, a payment plan, or a sales channel", async () => {
    // A part-paid order can legitimately be assigned/order_ready/dispatched/
    // completed, and the WhatsApp slow lane must not be filtered out.
    const where = await listWhere({ outstanding_balance: true });
    expect(where).not.toMatch(/payment_plan/);
    expect(where).not.toMatch(/sales_channel/);
    expect(where).not.toMatch(/so\.status = \$\d+/);
    expect(where).not.toMatch(/so\.status IN/);
  });

  test("combines with an explicit lifecycle stage (parcels that left with a balance open)", async () => {
    const where = await listWhere({
      outstanding_balance: true,
      status: "dispatched",
    });
    expect(where).toMatch(/so\.status = \$1/);
    expect(where).toMatch(/so\.balance_due_ngn > 0/);
    expect(where).toContain(DEAD_STATES);
  });
});

describe("listOrders — Partially Paid stays the narrower part-paid view", () => {
  test("still requires money received AND a balance due", async () => {
    const where = await listWhere({ part_paid: true });
    expect(where).toMatch(/so\.amount_paid_ngn > 0/);
    expect(where).toMatch(/so\.balance_due_ngn > 0/);
    expect(where).toContain(DEAD_STATES);
  });

  test("both money views share one exclusion set", async () => {
    const partPaid = await listWhere({ part_paid: true });
    const outstanding = await listWhere({ outstanding_balance: true });
    expect(partPaid).toContain(DEAD_STATES);
    expect(outstanding).toContain(DEAD_STATES);
  });
});

describe("collectionsSummary — the headline behind the filter", () => {
  async function summarySql() {
    const client = mockClient();
    await repo.collectionsSummary({ client, brand: BRAND });
    return client.query.mock.calls[0][0];
  }

  test("splits live receivables from balances stranded on dead orders", async () => {
    const sql = await summarySql();
    expect(sql).toMatch(/AS outstanding_orders/);
    expect(sql).toMatch(/AS outstanding_balance_ngn/);
    expect(sql).toMatch(/AS partially_paid_orders/);
    expect(sql).toMatch(/AS unpaid_orders/);
    expect(sql).toMatch(/AS excluded_orders/);
    expect(sql).toMatch(/AS excluded_balance_ngn/);
    // The reconciliation pair: the raw whole-table positive-balance total, so
    // the live figure can always be explained against it.
    expect(sql).toMatch(/AS raw_balance_orders/);
    expect(sql).toMatch(/AS raw_balance_ngn/);
  });

  test("measures money columns and treats dead states as not-live", async () => {
    const sql = await summarySql();
    expect(sql).toMatch(/balance_due_ngn/);
    expect(sql).toContain(
      `(so.status NOT IN ${COLLECTION_EXCLUDED_STATES_SQL}) AS is_live`,
    );
  });

  test("is read-only — no UPDATE/DELETE anywhere in the summary SQL", async () => {
    // Cancelled history is never rewritten or zeroed by a collections view.
    const sql = await summarySql();
    expect(sql).not.toMatch(/\bUPDATE\b/i);
    expect(sql).not.toMatch(/\bDELETE\b/i);
    expect(sql).not.toMatch(/\bINSERT\b/i);
  });
});
