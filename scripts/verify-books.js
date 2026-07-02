#!/usr/bin/env node
/**
 * Books integrity check (policy Q15 / go-live tooling). Run any time:
 *   npm run books:verify
 *
 * Per active brand:
 *   HARD failures (non-zero exit):
 *     1. Trial balance out of balance (posted journal debits ≠ credits).
 *     2. Any individual posted journal entry that doesn't balance.
 *   REPORTED (informational — legitimate balances that deserve eyes):
 *     3. AR control 1200 vs the invoicing sub-ledger (open standalone
 *        invoice balances).
 *     4. AP control 2000 vs open supplier-invoice balances.
 *     5. Clearing residues: GRNI 2050, Customer Deposits 2400, COD in
 *        Transit 1610, Net-Pay Payable 2300.
 */

"use strict";

const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const q = (sql, params) => pool.query(sql, params);
const n = (v) => Number(v || 0).toFixed(2);

async function checkBrand(brand) {
  let ok = true;
  process.stdout.write(`\n═══ ${brand} ═══\n`);

  const { rows: [tb] } = await q(
    `SELECT COALESCE(SUM(jl.debit_ngn),0) AS dr, COALESCE(SUM(jl.credit_ngn),0) AS cr
       FROM ${brand}.journal_lines jl
       JOIN ${brand}.journal_entries je USING (entry_id)
      WHERE je.status = 'posted'`,
  );
  const balanced = Math.abs(Number(tb.dr) - Number(tb.cr)) <= 0.01;
  process.stdout.write(
    `  ${balanced ? "✓" : "✗"} trial balance: DR ${n(tb.dr)} / CR ${n(tb.cr)}\n`,
  );
  if (!balanced) ok = false;

  const { rows: bad } = await q(
    `SELECT je.entry_number,
            SUM(jl.debit_ngn) AS dr, SUM(jl.credit_ngn) AS cr
       FROM ${brand}.journal_lines jl
       JOIN ${brand}.journal_entries je USING (entry_id)
      WHERE je.status = 'posted'
      GROUP BY je.entry_id, je.entry_number
     HAVING ABS(SUM(jl.debit_ngn) - SUM(jl.credit_ngn)) > 0.01`,
  );
  process.stdout.write(
    `  ${bad.length === 0 ? "✓" : "✗"} unbalanced posted entries: ${bad.length}\n`,
  );
  for (const b of bad.slice(0, 10))
    process.stdout.write(`      ${b.entry_number}: DR ${n(b.dr)} CR ${n(b.cr)}\n`);
  if (bad.length) ok = false;

  const bal = async (code) => {
    const { rows: [r] } = await q(
      `SELECT COALESCE(SUM(jl.debit_ngn - jl.credit_ngn),0) AS net
         FROM ${brand}.journal_lines jl
         JOIN ${brand}.journal_entries je USING (entry_id)
         JOIN ${brand}.chart_of_accounts coa USING (account_id)
        WHERE je.status = 'posted' AND coa.account_code = $1`,
      [code],
    );
    return Number(r.net);
  };

  // Sub-ledger ties (informational: pre-cutover documents legitimately
  // predate their GL postings — after go-live these should converge).
  const arGl = await bal("1200");
  const { rows: [ar] } = await q(
    `SELECT COALESCE(SUM(balance_due_ngn),0) AS due FROM ${brand}.invoices
      WHERE order_id IS NULL AND status IN ('sent','partially_paid','overdue')`,
  );
  process.stdout.write(
    `  · AR control 1200: ${n(arGl)} vs open standalone invoices: ${n(ar.due)}\n`,
  );

  const apGl = await bal("2000");
  const { rows: [ap] } = await q(
    `SELECT COALESCE(SUM(total_ngn - amount_paid_ngn),0) AS due
       FROM ${brand}.supplier_invoices WHERE status IN ('approved','part_paid')`,
  ).catch(() => ({ rows: [{ due: 0 }] }));
  process.stdout.write(
    `  · AP control 2000: ${n(-apGl)} (credit) vs open supplier invoices: ${n(ap.due)}\n`,
  );

  for (const [code, label] of [
    ["2050", "GRNI residue"],
    ["2400", "Customer deposits held"],
    ["1610", "COD with couriers"],
    ["2300", "Net pay owed"],
  ]) {
    const v = await bal(code);
    process.stdout.write(`  · ${label} (${code}): ${n(Math.abs(v))}\n`);
  }

  return ok;
}

async function main() {
  const { rows: brands } = await q(
    `SELECT business_key FROM shared.business_config WHERE is_active = true ORDER BY business_key`,
  );
  let ok = true;
  for (const b of brands) {
    if (!(await checkBrand(b.business_key))) ok = false;
  }
  await pool.end();
  process.stdout.write(
    ok ? "\nBOOKS OK — every posted journal balances.\n" : "\nBOOKS BROKEN — see ✗ above.\n",
  );
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
