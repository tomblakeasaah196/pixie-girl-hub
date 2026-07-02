/**
 * Accounting & Finance (V2.2 §6.6) — bank reconciliation & tax filing repository.
 * Per-brand tables: bank_statements, bank_statement_lines, bank_reconciliations,
 * bank_reconciliation_matches, tax_filings. Numbers are issued via the
 * per-brand fn_next_document_number(); this layer only reads/writes rows.
 */

"use strict";

const { query } = require("../../config/database");
const coreRepo = require("./accounting.repo");

const { t } = require("../../config/brands");
const ex = (client) => (client ? client.query.bind(client) : query);

async function nextNumber({ client, brand, type }) {
  const { rows } = await ex(client)(
    `SELECT ${t(brand, "fn_next_document_number")}($1) AS num`,
    [type],
  );
  return rows[0].num;
}
// Reuse the canonical fiscal-period resolver (starts_on/ends_on, open periods).
const findActivePeriod = (args) => coreRepo.findActivePeriod(args);

// ── Bank statements ──────────────────────────────────────
async function createStatement({ client, brand, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "bank_statements")}
       (bank_account_id, statement_number, statement_date, period_start, period_end, currency,
        opening_balance, closing_balance, total_credits, total_debits, source, source_document_id, imported_by)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,'NGN'),$7,$8,COALESCE($9,0),COALESCE($10,0),COALESCE($11,'manual'),$12,$13)
     RETURNING *`,
    [
      row.bank_account_id,
      row.statement_number || null,
      row.statement_date,
      row.period_start,
      row.period_end,
      row.currency,
      row.opening_balance,
      row.closing_balance,
      row.total_credits,
      row.total_debits,
      row.source,
      row.source_document_id || null,
      row.imported_by || null,
    ],
  );
  return rows[0];
}
async function addStatementLine({ client, brand, line }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "bank_statement_lines")}
       (statement_id, transaction_date, value_date, reference, narration, credit_amount, debit_amount, running_balance, notes)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,0),COALESCE($7,0),$8,$9) RETURNING *`,
    [
      line.statement_id,
      line.transaction_date,
      line.value_date || null,
      line.reference || null,
      line.narration,
      line.credit_amount,
      line.debit_amount,
      line.running_balance ?? null,
      line.notes || null,
    ],
  );
  return rows[0];
}
async function getStatement({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "bank_statements")} WHERE statement_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { rows: lines } = await ex(client)(
    `SELECT * FROM ${t(brand, "bank_statement_lines")} WHERE statement_id = $1 ORDER BY transaction_date, statement_line_id`,
    [id],
  );
  return { ...rows[0], lines };
}
async function listStatements({
  client,
  brand,
  filters = {},
  page = 1,
  page_size = 25,
  offset = 0,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (filters.status) {
    where.push(`status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.bank_account_id) {
    where.push(`bank_account_id = $${i++}`);
    params.push(filters.bank_account_id);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "bank_statements")} ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "bank_statements")} ${w} ORDER BY statement_date DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, page_size, offset],
  );
  return {
    data: rows,
    meta: {
      page,
      page_size,
      total: c[0].total,
      has_more: offset + rows.length < c[0].total,
    },
  };
}
async function setStatementStatus({ client, brand, id, status }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "bank_statements")} SET status = $2 WHERE statement_id = $1 RETURNING *`,
    [id, status],
  );
  return rows[0] || null;
}
async function setStatementLineStatus({
  client,
  brand,
  statement_line_id,
  status,
}) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "bank_statement_lines")} SET status = $2 WHERE statement_line_id = $1 RETURNING *`,
    [statement_line_id, status],
  );
  return rows[0] || null;
}

// ── Reconciliations ──────────────────────────────────────
async function createReconciliation({ client, brand, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "bank_reconciliations")}
       (reconciliation_number, bank_account_id, fiscal_period_id, statement_id,
        book_balance_ngn, statement_balance_ngn, reconciled_balance_ngn, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      row.reconciliation_number,
      row.bank_account_id,
      row.fiscal_period_id,
      row.statement_id || null,
      row.book_balance_ngn,
      row.statement_balance_ngn,
      row.reconciled_balance_ngn,
      row.notes || null,
    ],
  );
  return rows[0];
}
async function getReconciliation({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "bank_reconciliations")} WHERE reconciliation_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { rows: matches } = await ex(client)(
    `SELECT * FROM ${t(brand, "bank_reconciliation_matches")} WHERE reconciliation_id = $1 ORDER BY matched_at`,
    [id],
  );
  return { ...rows[0], matches };
}
async function listReconciliations({
  client,
  brand,
  filters = {},
  page = 1,
  page_size = 25,
  offset = 0,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (filters.status) {
    where.push(`status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.bank_account_id) {
    where.push(`bank_account_id = $${i++}`);
    params.push(filters.bank_account_id);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "bank_reconciliations")} ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "bank_reconciliations")} ${w} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, page_size, offset],
  );
  return {
    data: rows,
    meta: {
      page,
      page_size,
      total: c[0].total,
      has_more: offset + rows.length < c[0].total,
    },
  };
}
async function setReconciliationStatus({
  client,
  brand,
  id,
  status,
  extra = {},
}) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "bank_reconciliations")} SET ${sets.join(", ")} WHERE reconciliation_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}
async function addMatch({ client, brand, match }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "bank_reconciliation_matches")}
       (reconciliation_id, statement_line_id, match_type, sales_order_payment_id, journal_entry_id, amount_matched_ngn, confidence, matched_by, notes)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,1),$8,$9) RETURNING *`,
    [
      match.reconciliation_id,
      match.statement_line_id,
      match.match_type,
      match.sales_order_payment_id || null,
      match.journal_entry_id || null,
      match.amount_matched_ngn,
      match.confidence,
      match.matched_by || null,
      match.notes || null,
    ],
  );
  return rows[0];
}
async function getStatementLine({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "bank_statement_lines")} WHERE statement_line_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function sumMatched({ client, brand, reconciliation_id }) {
  const { rows } = await ex(client)(
    `SELECT COALESCE(SUM(amount_matched_ngn),0)::numeric AS total FROM ${t(brand, "bank_reconciliation_matches")} WHERE reconciliation_id = $1`,
    [reconciliation_id],
  );
  return Number(rows[0].total);
}

// ── Tax filings ──────────────────────────────────────────
async function createFiling({ client, brand, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "tax_filings")}
       (filing_number, tax_type, fiscal_period_id, taxable_amount_ngn, tax_amount_ngn, due_date, notes)
     VALUES ($1,$2,$3,COALESCE($4,0),COALESCE($5,0),$6,$7) RETURNING *`,
    [
      row.filing_number,
      row.tax_type,
      row.fiscal_period_id,
      row.taxable_amount_ngn,
      row.tax_amount_ngn,
      row.due_date,
      row.notes || null,
    ],
  );
  return rows[0];
}
async function getFiling({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "tax_filings")} WHERE filing_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function listFilings({
  client,
  brand,
  filters = {},
  page = 1,
  page_size = 25,
  offset = 0,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (filters.status) {
    where.push(`status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.tax_type) {
    where.push(`tax_type = $${i++}`);
    params.push(filters.tax_type);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "tax_filings")} ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "tax_filings")} ${w} ORDER BY due_date DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, page_size, offset],
  );
  return {
    data: rows,
    meta: {
      page,
      page_size,
      total: c[0].total,
      has_more: offset + rows.length < c[0].total,
    },
  };
}
async function setFilingStatus({ client, brand, id, status, extra = {} }) {
  const sets = ["status = $2", "updated_at = now()"];
  const params = [id, status];
  let i = 3;
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "tax_filings")} SET ${sets.join(", ")} WHERE filing_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

module.exports = {
  nextNumber,
  findActivePeriod,
  createStatement,
  addStatementLine,
  getStatement,
  listStatements,
  setStatementStatus,
  setStatementLineStatus,
  createReconciliation,
  getReconciliation,
  listReconciliations,
  setReconciliationStatus,
  addMatch,
  getStatementLine,
  sumMatched,
  createFiling,
  getFiling,
  listFilings,
  setFilingStatus,
};
