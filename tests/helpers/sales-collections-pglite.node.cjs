"use strict";

/**
 * Embedded-PostgreSQL (PGlite) coverage for the Sales collections views and the
 * Cash Collected KPI — REAL SQL, real repos, real production trigger.
 *
 * Why an embedded-DB suite and not only SQL-shape mocks: the production audit
 * that drove this work was a NUMBERS reconciliation (46 positive-balance rows /
 * ₦25,512,175 raw vs 3 live orders / ₦1,738,000 actually owed), and the only
 * honest way to prove a filter reproduces it is to run the filter against a
 * database carrying that snapshot.
 *
 * What is real here:
 *   • `sales.repo.listOrders` / `sales.repo.collectionsSummary` /
 *     `sales.repo.reportCashCollected` / `dashboards.repo.salesKpis` — the same
 *     code the API runs.
 *   • `fn_sales_order_recompute_paid` installed by executing the REAL migration
 *     file `migrations/000393_business_partial_paid_unlocks_production.sql`, so
 *     `amount_paid_ngn` (and therefore the generated `balance_due_ngn`) is
 *     derived from the captured/authorised payment rows exactly as in
 *     production. Seeded orders are never allowed to assert a paid amount that
 *     their payment rows do not support.
 *   • `sales_order_payments` columns/CHECKs copied from the sales template
 *     (000019), including the status CHECK and the generated `net_received_ngn`.
 *
 * Fixture DDL is limited to the tables these queries touch (sales_orders,
 * sales_order_lines, invoices, quotations, sales_order_payments,
 * shared.contacts). This is embedded-PG evidence, NOT staging validation.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require("@electric-sql/pglite");

// Env schema validation dummies — no real connection is ever opened; the pg
// pool is swapped for PGlite before any repo module is required.
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "fatal";
process.env.ENABLE_AUDIT_LOG = "true";
process.env.DB_HOST = process.env.DB_HOST || "localhost";
process.env.DB_NAME = process.env.DB_NAME || "pglite";
process.env.DB_USER = process.env.DB_USER || "pglite";
process.env.DB_PASSWORD = process.env.DB_PASSWORD || "pglite";
process.env.REDIS_HOST = process.env.REDIS_HOST || "localhost";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-".repeat(4);
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET || "test-session-".repeat(4);
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ||
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const FLH = "faitlynhair";
const PXG = "pixiegirl";
const BRANDS = [FLH, PXG];

// ── Fixture DDL ────────────────────────────────────────────
const SHARED_DDL = `
CREATE SCHEMA IF NOT EXISTS shared;
CREATE TABLE shared.contacts (
  contact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text, first_name text, primary_phone text,
  whatsapp_number text, email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

const BRAND_DDL = (B) => `
CREATE SCHEMA IF NOT EXISTS ${B};

CREATE TABLE ${B}.sales_orders (
  order_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  contact_id uuid,
  sales_channel text NOT NULL DEFAULT 'whatsapp',
  order_type text NOT NULL DEFAULT 'dispatch',
  status text NOT NULL DEFAULT 'pending_payment',
  subtotal_ngn numeric(14,2), discount_amount_ngn numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount_ngn numeric(14,2) NOT NULL DEFAULT 0, shipping_fee_ngn numeric(14,2) NOT NULL DEFAULT 0,
  total_ngn numeric(14,2),
  amount_paid_ngn numeric(14,2) NOT NULL DEFAULT 0,
  -- The generated column every collections figure reads (total − paid).
  balance_due_ngn numeric(14,2)
    GENERATED ALWAYS AS (COALESCE(total_ngn,0) - COALESCE(amount_paid_ngn,0)) STORED,
  payment_plan text, payment_model text,
  required_deposit_pct numeric(5,2), required_deposit_ngn numeric(14,2),
  is_preorder boolean NOT NULL DEFAULT false, preorder_ready_by date,
  internal_notes text, customer_notes text,
  public_tracking_token text,
  display_currency text, display_total numeric(14,2), fx_rate_used numeric(15,6),
  cancellation_reason text, cancelled_at timestamptz,
  placed_at timestamptz,
  deposit_met_at timestamptz, fully_paid_at timestamptz,
  last_payment_at timestamptz, paid_at timestamptz,
  last_reminder_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ${B}.sales_order_lines (
  line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES ${B}.sales_orders(order_id) ON DELETE CASCADE,
  product_name_snapshot text, variant_label_snapshot text, sku_snapshot text,
  line_kind text NOT NULL DEFAULT 'stock',
  quantity integer NOT NULL DEFAULT 1,
  unit_price_ngn numeric(14,2), line_discount_ngn numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount_ngn numeric(14,2), line_total_ngn numeric(14,2),
  display_order integer NOT NULL DEFAULT 0
);

-- The Orders list LEFT JOINs the order's invoice for its deep-link column.
CREATE TABLE ${B}.invoices (
  invoice_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text UNIQUE, order_id uuid,
  status text NOT NULL DEFAULT 'draft',
  total_ngn numeric(14,2), amount_paid_ngn numeric(14,2) NOT NULL DEFAULT 0,
  balance_due_ngn numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- salesKpis counts open quotations.
CREATE TABLE ${B}.quotations (
  quotation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_number text UNIQUE, status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Columns + CHECKs from the sales template (000019): the payment ledger the
-- Cash Collected KPI reads and the trigger sums.
CREATE TABLE ${B}.sales_order_payments (
  payment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_number text NOT NULL UNIQUE,
  order_id uuid NOT NULL REFERENCES ${B}.sales_orders(order_id) ON DELETE CASCADE,
  method text NOT NULL DEFAULT 'bank_transfer'
    CHECK (method IN ('paystack_card','paystack_transfer','paystack_ussd','opay',
                      'nomba_terminal','nomba_online','stripe_card','bank_transfer',
                      'cash','pos_card','pay_on_delivery','wallet','points',
                      'subscription_recurring')),
  provider text, provider_reference text,
  amount_ngn numeric(14,2) NOT NULL CHECK (amount_ngn > 0),
  paid_currency text, paid_amount numeric(14,2), fx_rate_used numeric(15,6),
  fee_ngn numeric(14,2) NOT NULL DEFAULT 0,
  net_received_ngn numeric(14,2) GENERATED ALWAYS AS (amount_ngn - fee_ngn) STORED,
  payment_path text, client_idempotency_key text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','authorised','captured','failed','refunded',
                      'partially_refunded','disputed')),
  authorised_at timestamptz, captured_at timestamptz, failed_at timestamptz,
  refunded_amount_ngn numeric(14,2) NOT NULL DEFAULT 0, refunded_at timestamptz,
  recorded_by uuid, recorded_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

-- The trigger itself (template 000034); its FUNCTION body is installed by the
-- real migration 000393 executed in boot(), so the version under test is the
-- one production runs.
CREATE TRIGGER trg_${B}_sales_order_payment_recompute
  AFTER INSERT OR UPDATE OR DELETE ON ${B}.sales_order_payments
  FOR EACH ROW EXECUTE FUNCTION ${B}.fn_sales_order_recompute_paid();
`;

let db = null;
const q = (sql, params) => db.query(sql, params);

// ── Seeding helpers ────────────────────────────────────────
let orderNo = 0;
let payNo = 0;

async function addOrder(
  brand,
  {
    status,
    total,
    channel = "whatsapp",
    placed_at = null,
    contact_id = null,
    plan = null,
  },
) {
  const prefix = brand === FLH ? "FLH" : "PXG";
  const { rows } = await q(
    `INSERT INTO ${brand}.sales_orders
       (order_number, contact_id, sales_channel, status, subtotal_ngn, total_ngn,
        payment_plan, placed_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$5,$6, COALESCE($7::timestamptz, now()), COALESCE($7::timestamptz, now()))
     RETURNING order_id, order_number, balance_due_ngn`,
    [
      `${prefix}-SO-${String(++orderNo).padStart(4, "0")}`,
      contact_id,
      channel,
      status,
      total,
      plan,
      placed_at,
    ],
  );
  return rows[0];
}

/**
 * Insert a payment row and let the REAL trigger roll it up to the order — the
 * test never sets amount_paid_ngn by hand, so an order's balance can only ever
 * be what its captured/authorised payments support.
 */
async function addPayment(
  brand,
  order_id,
  amount,
  {
    status = "captured",
    captured_at = null,
    recorded_at = null,
    method = "bank_transfer",
  } = {},
) {
  const prefix = brand === FLH ? "FLH" : "PXG";
  const { rows } = await q(
    `INSERT INTO ${brand}.sales_order_payments
       (payment_number, order_id, method, amount_ngn, status, captured_at, recorded_at)
     VALUES ($1,$2,$3,$4,$5,
             COALESCE($6::timestamptz, CASE WHEN $5 IN ('captured','authorised') THEN now() END),
             COALESCE($7::timestamptz, now()))
     RETURNING payment_id, amount_ngn, status`,
    [
      `${prefix}-PAY-${String(++payNo).padStart(4, "0")}`,
      order_id,
      method,
      amount,
      status,
      captured_at,
      recorded_at,
    ],
  );
  return rows[0];
}

const sum = (rows, key = "balance_due_ngn") =>
  rows.reduce((a, r) => a + Number(r[key] || 0), 0);

// ── The audited production snapshot (FLH) ──────────────────
// Two active part-paid orders totalling ₦480,000 outstanding; one active
// ₦0-paid pending_payment order of ₦1,258,000; and 43 cancelled ₦0-paid
// historical orders worth ₦23,774,175 that are NOT live receivables.
const AUDIT = {
  partPaidOutstanding: 480000,
  zeroPaidOrder: 1258000,
  liveOrders: 3,
  liveOutstanding: 1738000,
  cancelledOrders: 43,
  cancelledBalance: 23774175,
  rawRows: 46,
  rawBalance: 25512175,
};
const CANCELLED_EACH = 552000; // 42 × 552,000 + 590,175 = 23,774,175
const CANCELLED_LAST = AUDIT.cancelledBalance - CANCELLED_EACH * 42;

const flh = {};

async function seedFlh() {
  const cust = await q(
    `INSERT INTO shared.contacts (display_name, primary_phone)
     VALUES ('Audit Customer','+2348030000000') RETURNING contact_id`,
  );
  const contact_id = cust.rows[0].contact_id;

  // (1) Part-paid, already in fulfilment — the case a status filter misses.
  flh.partPaidAssigned = await addOrder(FLH, {
    status: "assigned",
    total: 350000,
    contact_id,
    plan: "instalment",
  });
  await addPayment(FLH, flh.partPaidAssigned.order_id, 150000);

  flh.partPaidDispatched = await addOrder(FLH, {
    status: "dispatched",
    total: 560000,
    contact_id,
    plan: "instalment",
  });
  await addPayment(FLH, flh.partPaidDispatched.order_id, 280000);

  // (2) The ₦0-paid WhatsApp order on the slow lane — a receivable, and its
  //     cancellation timing is deliberately untouched by this work.
  flh.zeroPaid = await addOrder(FLH, {
    status: "pending_payment",
    total: AUDIT.zeroPaidOrder,
    channel: "whatsapp",
    contact_id,
  });

  // (3) 43 cancelled ₦0-paid historical orders — balances stay on the rows.
  flh.cancelled = [];
  for (let i = 0; i < AUDIT.cancelledOrders; i += 1) {
    const total =
      i === AUDIT.cancelledOrders - 1 ? CANCELLED_LAST : CANCELLED_EACH;
    // eslint-disable-next-line no-await-in-loop
    const o = await addOrder(FLH, {
      status: "cancelled",
      total,
      channel: "whatsapp",
      contact_id,
    });
    flh.cancelled.push(o);
  }

  // (4) Noise that must never appear in a collection view: a settled order and
  //     an order placed last month whose deposit landed THIS month.
  flh.settled = await addOrder(FLH, {
    status: "completed",
    total: 100000,
    contact_id,
  });
  await addPayment(FLH, flh.settled.order_id, 100000);

  // An order placed 60 days ago, in fulfilment ('assigned'), fully paid — but
  // paid in instalments that straddle the month boundary. It is NOT a debtor
  // (balance 0), so it stays out of both collection views while still proving
  // the cash/order-value split.
  flh.oldOrder = await addOrder(FLH, {
    status: "assigned",
    total: 200000,
    contact_id,
    placed_at: new Date(Date.now() - 60 * 86400_000).toISOString(),
  });
  const lastMonth = new Date(Date.now() - 45 * 86400_000).toISOString();
  // Deposit taken NOW on an order placed 60 days ago: this month's CASH, last
  // month's order value.
  await addPayment(FLH, flh.oldOrder.order_id, 90000);
  // Money taken on it 45 days ago: never in this month's cash.
  await addPayment(FLH, flh.oldOrder.order_id, 40000, {
    captured_at: lastMonth,
    recorded_at: lastMonth,
  });
  await addPayment(FLH, flh.oldOrder.order_id, 70000, {
    captured_at: lastMonth,
    recorded_at: lastMonth,
  });
  // Rows that are not money in.
  await addPayment(FLH, flh.oldOrder.order_id, 500000, { status: "pending" });
  await addPayment(FLH, flh.oldOrder.order_id, 25000, { status: "failed" });
}

// ── Lifecycle edge cases (PXG) ─────────────────────────────
const pxg = {};

async function seedPxg() {
  const cust = await q(
    `INSERT INTO shared.contacts (display_name) VALUES ('Edge Case') RETURNING contact_id`,
  );
  const contact_id = cust.rows[0].contact_id;
  const mk = (status, total, extra = {}) =>
    addOrder(PXG, { status, total, contact_id, ...extra });

  // Every dead/limbo state with a positive balance — none is a receivable.
  pxg.draft = await mk("draft", 50000);
  pxg.cancelRequested = await mk("cancellation_requested", 60000);
  pxg.cancelled = await mk("cancelled", 70000);
  pxg.refunded = await mk("refunded", 80000);
  pxg.failed = await mk("failed", 90000);

  pxg.zeroPaid = await mk("pending_payment", 120000);
  pxg.partPaidCompleted = await mk("completed", 250000);
  await addPayment(PXG, pxg.partPaidCompleted.order_id, 100000);
  pxg.settled = await mk("paid", 45000);
  await addPayment(PXG, pxg.settled.order_id, 45000);
  // Overpaid: balance_due_ngn is negative, so it is not an outstanding balance.
  pxg.overpaid = await mk("completed", 30000);
  await addPayment(PXG, pxg.overpaid.order_id, 35000);
}

// ── Boot ───────────────────────────────────────────────────
before(async () => {
  db = new PGlite();
  await db.exec(SHARED_DDL);
  for (const brand of BRANDS) {
    // The tables first: migration 000393 checks information_schema for
    // sales_orders before installing the trigger function.
    await db.exec(BRAND_DDL_NO_TRIGGER(brand));
  }
  // The REAL production trigger function (amount_paid_ngn = sum of
  // captured/authorised payments; deposit_met_at = first money in).
  await db.exec(
    fs.readFileSync(
      path.resolve(
        __dirname,
        "../../migrations/000393_business_partial_paid_unlocks_production.sql",
      ),
      "utf8",
    ),
  );
  for (const brand of BRANDS) await db.exec(TRIGGER_DDL(brand));

  // Swap the pg pool for PGlite BEFORE any repo module loads, so every repo
  // binds the patched query/ex (they destructure at require time).
  const dbmod = require("../../src/config/database");
  dbmod.query = (sql, params) => db.query(sql, params);
  dbmod.ex = (client) =>
    client ? client.query.bind(client) : (sql, params) => db.query(sql, params);
  dbmod.transaction = async (fn) =>
    db.transaction(async (tx) =>
      fn({ query: (sql, params) => tx.query(sql, params) }),
    );

  await seedFlh();
  await seedPxg();
}, 120_000);

after(async () => {
  if (db) await db.close();
});

// BRAND_DDL minus the trigger (created after the migration installs its function).
function BRAND_DDL_NO_TRIGGER(B) {
  return BRAND_DDL(B).replace(/-- The trigger itself[\s\S]*$/, "");
}
function TRIGGER_DDL(B) {
  return `CREATE TRIGGER trg_${B}_sales_order_payment_recompute
  AFTER INSERT OR UPDATE OR DELETE ON ${B}.sales_order_payments
  FOR EACH ROW EXECUTE FUNCTION ${B}.fn_sales_order_recompute_paid();`;
}

// ── 1. The snapshot reconciles with the audit ──────────────
test("the seeded snapshot reproduces the audited production figures", async () => {
  const { rows } = await q(
    `SELECT count(*)::int AS n, COALESCE(SUM(balance_due_ngn),0)::text AS total
       FROM ${FLH}.sales_orders WHERE balance_due_ngn > 0`,
  );
  assert.equal(rows[0].n, AUDIT.rawRows, "raw positive-balance rows");
  assert.equal(
    Number(rows[0].total),
    AUDIT.rawBalance,
    "raw positive-balance total",
  );

  const cancelled = await q(
    `SELECT count(*)::int AS n, COALESCE(SUM(balance_due_ngn),0)::text AS total
       FROM ${FLH}.sales_orders WHERE status = 'cancelled' AND balance_due_ngn > 0`,
  );
  assert.equal(cancelled.rows[0].n, AUDIT.cancelledOrders);
  assert.equal(Number(cancelled.rows[0].total), AUDIT.cancelledBalance);

  // Order money matches the captured/authorised payment rows (the trigger's
  // job) — the audit's reconciliation, re-proved rather than assumed.
  const drift = await q(
    `SELECT count(*)::int AS n
       FROM ${FLH}.sales_orders so
      WHERE so.amount_paid_ngn <> (
        SELECT COALESCE(SUM(p.amount_ngn),0) FROM ${FLH}.sales_order_payments p
         WHERE p.order_id = so.order_id AND p.status IN ('captured','authorised'))`,
  );
  assert.equal(
    drift.rows[0].n,
    0,
    "amount_paid_ngn must equal its payment rows",
  );
});

// ── 2. Outstanding Balance = the live receivables ──────────
test("Outstanding Balance returns the 3 live orders / ₦1,738,000 — not the 46 raw rows", async () => {
  const repo = require("../../src/modules/sales/sales.repo");
  const res = await repo.listOrders({
    brand: FLH,
    filters: { outstanding_balance: true },
    page: 1,
    page_size: 100,
  });
  assert.equal(res.meta.total, AUDIT.liveOrders);
  assert.equal(sum(res.data), AUDIT.liveOutstanding);
  const numbers = res.data.map((o) => o.order_number).sort();
  assert.deepEqual(
    numbers,
    [
      flh.partPaidAssigned.order_number,
      flh.partPaidDispatched.order_number,
      flh.zeroPaid.order_number,
    ].sort(),
  );
  // No cancelled order is in the live queue.
  assert.equal(res.data.filter((o) => o.status === "cancelled").length, 0);
});

test("Partially Paid stays the narrower view: 2 orders / ₦480,000", async () => {
  const repo = require("../../src/modules/sales/sales.repo");
  const res = await repo.listOrders({
    brand: FLH,
    filters: { part_paid: true },
    page: 1,
    page_size: 100,
  });
  assert.equal(res.meta.total, 2);
  assert.equal(sum(res.data), AUDIT.partPaidOutstanding);
  // The ₦0-paid WhatsApp order is a receivable but NOT part-paid — it must not
  // be the only way to find it.
  assert.ok(!res.data.some((o) => o.order_id === flh.zeroPaid.order_id));
});

test("collectionsSummary reports the live queue and reconciles it against the raw total", async () => {
  const repo = require("../../src/modules/sales/sales.repo");
  const s = await repo.collectionsSummary({ brand: FLH });
  assert.equal(s.outstanding_orders, AUDIT.liveOrders);
  assert.equal(Number(s.outstanding_balance_ngn), AUDIT.liveOutstanding);
  assert.equal(s.partially_paid_orders, 2);
  assert.equal(Number(s.partially_paid_balance_ngn), AUDIT.partPaidOutstanding);
  assert.equal(s.unpaid_orders, 1);
  assert.equal(Number(s.unpaid_balance_ngn), AUDIT.zeroPaidOrder);
  assert.equal(s.excluded_orders, AUDIT.cancelledOrders);
  assert.equal(Number(s.excluded_balance_ngn), AUDIT.cancelledBalance);
  assert.equal(s.raw_balance_orders, AUDIT.rawRows);
  assert.equal(Number(s.raw_balance_ngn), AUDIT.rawBalance);
  // live + excluded == raw, to the naira.
  assert.equal(
    Number(s.outstanding_balance_ngn) + Number(s.excluded_balance_ngn),
    Number(s.raw_balance_ngn),
  );
});

test("cancelled history is reported, never rewritten", async () => {
  const repo = require("../../src/modules/sales/sales.repo");
  await repo.collectionsSummary({ brand: FLH });
  await repo.listOrders({
    brand: FLH,
    filters: { outstanding_balance: true },
    page: 1,
    page_size: 100,
  });
  const { rows } = await q(
    `SELECT COALESCE(SUM(total_ngn),0)::text AS totals,
            COALESCE(SUM(balance_due_ngn),0)::text AS balances,
            COALESCE(SUM(amount_paid_ngn),0)::text AS paid
       FROM ${FLH}.sales_orders WHERE status = 'cancelled'`,
  );
  assert.equal(Number(rows[0].totals), AUDIT.cancelledBalance);
  assert.equal(Number(rows[0].balances), AUDIT.cancelledBalance);
  assert.equal(Number(rows[0].paid), 0);
});

// ── 3. Lifecycle status is not a payment state ─────────────
test("a part-paid order is findable at every fulfilment stage", async () => {
  const repo = require("../../src/modules/sales/sales.repo");
  const res = await repo.listOrders({
    brand: PXG,
    filters: { outstanding_balance: true },
    page: 1,
    page_size: 100,
  });
  const ids = res.data.map((o) => o.order_id);
  // 'completed' with a balance open is still a debtor.
  assert.ok(ids.includes(pxg.partPaidCompleted.order_id));
  // ₦0-paid pending is in Outstanding Balance…
  assert.ok(ids.includes(pxg.zeroPaid.order_id));
  // …and every dead/limbo state is out.
  for (const dead of [
    pxg.draft,
    pxg.cancelRequested,
    pxg.cancelled,
    pxg.refunded,
    pxg.failed,
  ]) {
    assert.ok(!ids.includes(dead.order_id), `${dead.status} must be excluded`);
  }
  // Settled and overpaid orders owe nothing.
  assert.ok(!ids.includes(pxg.settled.order_id));
  assert.ok(!ids.includes(pxg.overpaid.order_id));

  const partPaid = await repo.listOrders({
    brand: PXG,
    filters: { part_paid: true },
    page: 1,
    page_size: 100,
  });
  assert.deepEqual(
    partPaid.data.map((o) => o.order_id),
    [pxg.partPaidCompleted.order_id],
  );
});

test("the ₦0-paid WhatsApp order stays on the slow lane: still pending_payment, still filterable as such", async () => {
  const repo = require("../../src/modules/sales/sales.repo");
  const pending = await repo.listOrders({
    brand: FLH,
    filters: { status: "pending_payment" },
    page: 1,
    page_size: 100,
  });
  assert.ok(pending.data.some((o) => o.order_id === flh.zeroPaid.order_id));
  const { rows } = await q(
    `SELECT status, cancelled_at, amount_paid_ngn FROM ${FLH}.sales_orders WHERE order_id = $1`,
    [flh.zeroPaid.order_id],
  );
  assert.equal(rows[0].status, "pending_payment");
  assert.equal(rows[0].cancelled_at, null);
  assert.equal(Number(rows[0].amount_paid_ngn), 0);

  // Outstanding Balance + an explicit stage combine (money AND lifecycle).
  const dispatchedDebtors = await repo.listOrders({
    brand: FLH,
    filters: { outstanding_balance: true, status: "dispatched" },
    page: 1,
    page_size: 100,
  });
  assert.deepEqual(
    dispatchedDebtors.data.map((o) => o.order_id),
    [flh.partPaidDispatched.order_id],
  );
});

// ── 4. Cash Collected MTD ──────────────────────────────────
test("Cash Collected MTD is the month's captured/authorised payments, not gross order value", async () => {
  const dashboards = require("../../src/modules/dashboards/dashboards.repo");
  const kpis = await dashboards.salesKpis({ brand: FLH });

  // In-month cash: 150,000 + 280,000 (the part-paid orders) + 100,000 (the
  // settled order) + 90,000 (a deposit taken now on an order placed 60 days
  // ago). The 40,000 taken 45 days ago, the 500,000 pending and the 25,000
  // failed row are not cash in.
  const inMonthCash = 150000 + 280000 + 100000 + 90000;
  assert.equal(Number(kpis.cash_collected_mtd), inMonthCash);
  assert.equal(kpis.payments_mtd, 4);

  // Gross order value: this month's paid-state orders only (350,000 assigned +
  // 560,000 dispatched + 100,000 completed). The order placed 60 days ago is
  // out even though its deposit is in this month's cash — the two figures are
  // different questions and must not be used interchangeably.
  assert.equal(Number(kpis.order_value_mtd), 350000 + 560000 + 100000);
  assert.notEqual(
    Number(kpis.order_value_mtd),
    Number(kpis.cash_collected_mtd),
  );
  assert.equal(kpis.revenue_mtd, undefined);
});

test("reportCashCollected scopes by capture time, not by order date", async () => {
  const repo = require("../../src/modules/sales/sales.repo");
  const from = new Date(Date.now() - 10 * 86400_000).toISOString();
  const to = new Date().toISOString();
  const cash = await repo.reportCashCollected({
    brand: FLH,
    filters: { from, to },
  });
  // The 90,000 deposit on the 60-day-old order is in the window; the 40,000
  // captured 45 days ago is not — an order-scoped sum would get both wrong.
  assert.equal(
    Number(cash.cash_collected_ngn),
    150000 + 280000 + 100000 + 90000,
  );
  assert.equal(cash.payments, 4);

  const all = await repo.reportCashCollected({ brand: FLH, filters: {} });
  assert.equal(
    Number(all.cash_collected_ngn),
    150000 + 280000 + 100000 + 90000 + 40000 + 70000,
  );
});

test("the cash window is the Lagos calendar month, boundaries included", async () => {
  const dashboards = require("../../src/modules/dashboards/dashboards.repo");
  // First instant of the PREVIOUS Lagos month (Lagos is a fixed UTC+1). Testing
  // against a closed month keeps the assertion independent of when the suite
  // runs — a "now" payment can never land inside it.
  const now = new Date();
  const lagos = new Date(now.getTime() + 3600_000);
  const m0 = new Date(
    Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth() - 1, 1) - 3600_000,
  );
  const justBefore = new Date(m0.getTime() - 30 * 60_000).toISOString();
  const justAfter = new Date(m0.getTime() + 30 * 60_000).toISOString();

  const boundaryOrder = await addOrder(PXG, {
    status: "pending_payment",
    total: 100000,
  });
  await addPayment(PXG, boundaryOrder.order_id, 1111, {
    captured_at: justBefore,
    recorded_at: justBefore,
  });
  await addPayment(PXG, boundaryOrder.order_id, 2222, {
    captured_at: justAfter,
    recorded_at: justAfter,
  });

  const kpis = await dashboards.salesKpis({
    brand: PXG,
    from: m0.toISOString(),
    to: new Date(m0.getTime() + 2 * 3600_000).toISOString(),
  });
  assert.equal(Number(kpis.cash_collected_mtd), 2222);
  assert.equal(kpis.payments_mtd, 1);

  // An 'authorised' row is money in (it is in the trigger's set too).
  await addPayment(PXG, boundaryOrder.order_id, 3333, {
    status: "authorised",
    captured_at: justAfter,
    recorded_at: justAfter,
  });
  const after = await dashboards.salesKpis({
    brand: PXG,
    from: m0.toISOString(),
    to: new Date(m0.getTime() + 2 * 3600_000).toISOString(),
  });
  assert.equal(Number(after.cash_collected_mtd), 2222 + 3333);
  // The ORDER's paid total is window-blind (the trigger sums every
  // captured/authorised row, including the pre-month 1,111) — which is exactly
  // why the KPI cannot be derived from order columns.
  const orderRow = await q(
    `SELECT amount_paid_ngn FROM ${PXG}.sales_orders WHERE order_id = $1`,
    [boundaryOrder.order_id],
  );
  assert.equal(Number(orderRow.rows[0].amount_paid_ngn), 1111 + 2222 + 3333);
});
