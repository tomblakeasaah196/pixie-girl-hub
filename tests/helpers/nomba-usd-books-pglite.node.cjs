"use strict";

/**
 * Embedded-PostgreSQL (PGlite) coverage for the Nomba NGN/USD books work:
 *   • migrations 000390 (+ template 000098) — the Nomba USD wallet account 1141
 *     lands in both brand charts, USD-denominated, idempotently;
 *   • migration 000391 — currency on the payment reconciliation queue, with its
 *     NGN|USD check;
 *   • the real repo SQL that uses them: journal lines carrying the dollars,
 *     parking a USD row, the ledger sweep's reference bridge through the
 *     webhook log, and USD reconciliation suggestions.
 *
 * Runs in a plain Node process (Jest's VM can't load PGlite's Wasm); wrapped by
 * tests/unit/accounting/nomba-usd-books-db.test.js.
 */

const fs = require("fs");
const path = require("path");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { PGlite } = require("@electric-sql/pglite");

process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "fatal";
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

const MIG = (f) =>
  fs.readFileSync(path.resolve(__dirname, "../../migrations", f), "utf8");

// Every column the exercised SQL touches, per the real templates (000019,
// 000022, 000035/000075) — no more.
const BRAND_DDL = (b) => `
CREATE SCHEMA ${b};
CREATE TABLE ${b}.account_groups (
  group_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_code text NOT NULL UNIQUE,
  group_name text NOT NULL
);
CREATE TABLE ${b}.chart_of_accounts (
  account_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_code text NOT NULL UNIQUE,
  account_name text NOT NULL,
  group_id uuid NOT NULL REFERENCES ${b}.account_groups (group_id),
  is_control_account boolean NOT NULL DEFAULT false,
  control_subledger text,
  account_currency text REFERENCES shared.currencies (currency_code),
  description text
);
INSERT INTO ${b}.account_groups (group_code, group_name) VALUES ('1', 'Assets');
INSERT INTO ${b}.chart_of_accounts (account_code, account_name, group_id)
  SELECT '1140', 'Nomba Settlement', group_id FROM ${b}.account_groups WHERE group_code = '1';
CREATE TABLE ${b}.journal_entries (
  entry_id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
CREATE TABLE ${b}.journal_lines (
  line_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES ${b}.journal_entries (entry_id),
  account_id uuid NOT NULL REFERENCES ${b}.chart_of_accounts (account_id),
  description text,
  debit_ngn numeric(14,2) NOT NULL DEFAULT 0,
  credit_ngn numeric(14,2) NOT NULL DEFAULT 0,
  transaction_currency text REFERENCES shared.currencies (currency_code),
  debit_transaction_currency numeric(14,2),
  credit_transaction_currency numeric(14,2),
  cost_centre text,
  project text,
  contact_id uuid,
  invoice_id uuid,
  display_order smallint NOT NULL DEFAULT 0
);
CREATE TABLE ${b}.sales_orders (
  order_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending_payment',
  total_ngn numeric(14,2) NOT NULL,
  amount_paid_ngn numeric(14,2) NOT NULL DEFAULT 0,
  balance_due_ngn numeric(14,2) GENERATED ALWAYS AS (total_ngn - amount_paid_ngn) STORED,
  display_currency text NOT NULL DEFAULT 'NGN',
  display_total numeric(14,2),
  fx_rate_used numeric(15,6) NOT NULL DEFAULT 1.0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ${b}.sales_order_payments (
  payment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES ${b}.sales_orders (order_id),
  provider_reference text
);
`;

const SHARED_DDL = `
CREATE SCHEMA shared;
CREATE TABLE shared.currencies (currency_code text PRIMARY KEY);
INSERT INTO shared.currencies VALUES ('NGN'), ('USD');
CREATE TABLE shared.webhook_log (
  webhook_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  event_type text NOT NULL DEFAULT 'x',
  payload jsonb NOT NULL,
  signature_valid boolean NOT NULL DEFAULT true,
  processed boolean NOT NULL DEFAULT true,
  received_at timestamptz NOT NULL DEFAULT now()
);
`;

let pg;
const q = (sql, params) => pg.query(sql, params);

before(async () => {
  pg = new PGlite();
  await pg.exec(SHARED_DDL);
  // The real reconciliation queue, as production built it.
  await pg.exec(MIG("000240_shared_pos_terminal_reconciliation.sql"));
  await pg.exec(MIG("000241_shared_pos_recon_sender_columns.sql"));
  await pg.exec(MIG("000374_shared_pos_recon_sender_and_note.sql"));
  for (const b of ["pixiegirl", "faitlynhair", "newbrand"])
    await pg.exec(BRAND_DDL(b));
  await pg.exec(MIG("000390_business_nomba_usd_wallet.sql"));
  await pg.exec(MIG("000391_shared_recon_paid_currency.sql"));
});

after(async () => {
  if (pg) await pg.close();
});

test("000390 adds the USD-denominated Nomba wallet 1141 to both brand charts", async () => {
  for (const b of ["pixiegirl", "faitlynhair"]) {
    const { rows } = await q(
      `SELECT account_name, account_currency FROM ${b}.chart_of_accounts WHERE account_code = '1141'`,
    );
    assert.equal(rows.length, 1, `${b} has 1141`);
    assert.equal(rows[0].account_currency, "USD");
    assert.match(rows[0].account_name, /USD Wallet/);
  }
  // Re-running (repair / a second deploy) changes nothing.
  await pg.exec(MIG("000390_business_nomba_usd_wallet.sql"));
  const { rows } = await q(
    `SELECT count(*)::int AS n FROM pixiegirl.chart_of_accounts WHERE account_code = '1141'`,
  );
  assert.equal(rows[0].n, 1);
});

test("template 000098 gives a newly bootstrapped brand the same account", async () => {
  const tpl = MIG("template/000098_business_nomba_usd_wallet.sql.template");
  await pg.exec(tpl.replace(/\{\{BUSINESS\}\}/g, "newbrand"));
  await pg.exec(tpl.replace(/\{\{BUSINESS\}\}/g, "newbrand")); // idempotent
  const { rows } = await q(
    `SELECT account_currency FROM newbrand.chart_of_accounts WHERE account_code = '1141'`,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].account_currency, "USD");
});

test("000391: the queue takes a paid currency, only NGN or USD, and re-runs cleanly", async () => {
  await pg.exec(MIG("000391_shared_recon_paid_currency.sql"));
  await assert.rejects(
    q(
      `INSERT INTO shared.pos_terminal_reconciliation (amount_ngn, raw_payload, paid_currency, paid_amount)
       VALUES (0, '{}', 'EUR', 10)`,
    ),
    /pos_terminal_reconciliation_paid_currency_check/,
  );
});

test("a USD capture's journal line carries the dollars into the wallet account", async () => {
  const repo = require("../../src/modules/accounting/accounting.repo");
  const postings = require("../../src/modules/sales/sales.postings");
  const {
    rows: [entry],
  } = await q(`INSERT INTO pixiegirl.journal_entries DEFAULT VALUES RETURNING entry_id`);
  const [debit] = postings.buildCaptureLines({
    amount_ngn: "374985.00",
    provider: "nomba",
    reference: "PXG-SO-0001",
    paid_currency: "USD",
    paid_amount: "249.99",
  });
  assert.equal(debit.account_code, "1141");
  const {
    rows: [acct],
  } = await q(
    `SELECT account_id FROM pixiegirl.chart_of_accounts WHERE account_code = $1`,
    [debit.account_code],
  );
  await repo.insertLine({
    client: pg,
    brand: "pixiegirl",
    line: { ...debit, entry_id: entry.entry_id, account_id: acct.account_id, display_order: 0 },
  });
  const { rows } = await q(
    `SELECT debit_ngn, transaction_currency, debit_transaction_currency
       FROM pixiegirl.journal_lines WHERE entry_id = $1`,
    [entry.entry_id],
  );
  assert.equal(Number(rows[0].debit_ngn), 374985);
  assert.equal(rows[0].transaction_currency, "USD");
  assert.equal(Number(rows[0].debit_transaction_currency), 249.99);
});

test("a parked USD row keeps its dollars, not a Naira guess", async () => {
  const posRepo = require("../../src/modules/pos/pos.repo");
  const row = await posRepo.enqueueReconciliation({
    client: pg,
    row: {
      provider: "nomba",
      resolved_brand: "faitlynhair",
      amount_ngn: "0",
      paid_currency: "USD",
      paid_amount: "249.99",
      provider_reference: "TX-USD-1",
      note: "USD 249.99 paid with no matching order",
      raw_payload: { amount: 249.99, currency: "USD" },
    },
  });
  assert.equal(row.paid_currency, "USD");
  assert.equal(Number(row.paid_amount), 249.99);
  // A Naira row still parks exactly as before (the new columns stay NULL).
  const ngnRow = await posRepo.enqueueReconciliation({
    client: pg,
    row: {
      provider: "nomba",
      amount_ngn: "330800.00",
      provider_reference: "TX-NGN-1",
      raw_payload: {},
    },
  });
  assert.equal(ngnRow.paid_currency, null);
});

test("the ledger sweep finds an online checkout through the webhook log", async () => {
  const salesRepo = require("../../src/modules/sales/sales.repo");
  const {
    rows: [order],
  } = await q(
    `INSERT INTO faitlynhair.sales_orders (order_number, total_ngn)
     VALUES ('FLH-SO-0300', 500000) RETURNING order_id`,
  );
  // Recorded under OUR orderReference, as the webhook stores it.
  await q(
    `INSERT INTO faitlynhair.sales_order_payments (order_id, provider_reference)
     VALUES ($1, 'nomba-FLH-SO-0300-abc')`,
    [order.order_id],
  );
  const refs = ["NOMBA-TXN-555"]; // what the ledger row names
  assert.equal(
    await salesRepo.paymentExistsForNombaLedgerRefs({
      client: pg,
      brand: "faitlynhair",
      refs,
    }),
    false,
    "no bridge yet",
  );
  await q(
    `INSERT INTO shared.webhook_log (source, payload) VALUES ('nomba', $1)`,
    [
      JSON.stringify({
        data: {
          order: { orderReference: "nomba-FLH-SO-0300-abc" },
          transaction: { transactionId: "NOMBA-TXN-555" },
        },
      }),
    ],
  );
  assert.equal(
    await salesRepo.paymentExistsForNombaLedgerRefs({
      client: pg,
      brand: "faitlynhair",
      refs,
    }),
    true,
  );
  // And a direct reference still matches without any webhook.
  assert.equal(
    await salesRepo.paymentExistsForNombaLedgerRefs({
      client: pg,
      brand: "faitlynhair",
      refs: ["x", "nomba-FLH-SO-0300-abc"],
    }),
    true,
  );
});

test("a USD row is suggested the USD-locked orders whose dollar balance it pays", async () => {
  const salesRepo = require("../../src/modules/sales/sales.repo");
  await q(
    `INSERT INTO pixiegirl.sales_orders
       (order_number, total_ngn, display_currency, display_total, fx_rate_used)
     VALUES
       ('PXG-SO-0101', 374985, 'USD', 249.99, 1500),   -- $249.99 due
       ('PXG-SO-0102', 600000, 'USD', 400.00, 1500),   -- $400 due
       ('PXG-SO-0103', 374985, 'NGN', NULL, 1)`,      // a Naira order
  );
  const hits = await salesRepo.findReconcilablePosOrders({
    client: pg,
    brand: "pixiegirl",
    amount_ngn: "0",
    paid_currency: "USD",
    paid_amount: "249.99",
  });
  assert.deepEqual(
    hits.map((h) => h.order_number),
    ["PXG-SO-0101"],
  );
});
