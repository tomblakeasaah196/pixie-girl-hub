/**
 * Accounting & Finance (V2.2 §6.6) — repository.
 * Tables (per-brand): account_groups, chart_of_accounts, fiscal_periods,
 * journal_entries, journal_lines. Double-entry integrity (DR=CR, immutable
 * once posted) is enforced by DB triggers; this layer only writes rows.
 */

"use strict";

const { query } = require("../../config/database");

const { VALID } = require("../../config/brands");
const t = (brand, tbl) => {
  if (!VALID.has(brand)) throw new Error(`Invalid brand: ${brand}`);
  return `${brand}.${tbl}`;
};
const ex = (client) => (client ? client.query.bind(client) : query);

// ── Account groups ───────────────────────────────────────
async function listGroups({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "account_groups")} ORDER BY display_order, group_code`,
  );
  return rows;
}
// Only presentational fields are editable; group_type/normal_balance/statement
// are structural and must not change (they drive the financial reports).
async function updateGroup({ client, brand, id, patch }) {
  const cols = ["group_name", "display_order", "is_active"];
  const sets = [];
  const params = [id];
  let i = 2;
  for (const col of cols) {
    if (patch[col] === undefined) continue;
    sets.push(`${col} = $${i++}`);
    params.push(patch[col]);
  }
  if (sets.length === 0) {
    const { rows } = await ex(client)(
      `SELECT * FROM ${t(brand, "account_groups")} WHERE group_id = $1`,
      [id],
    );
    return rows[0] || null;
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "account_groups")} SET ${sets.join(", ")} WHERE group_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── Chart of accounts ────────────────────────────────────
const ACCOUNT_COLS = [
  "account_code",
  "account_name",
  "group_id",
  "parent_account_id",
  "description",
  "is_control_account",
  "control_subledger",
  "tax_code",
  "account_currency",
  "allow_posting",
  "is_active",
  "display_order",
];
function buildInsert(cols, src, extra = {}) {
  const f = [],
    ph = [],
    p = [];
  let i = 1;
  for (const col of cols) {
    if (src[col] === undefined) continue;
    f.push(col);
    ph.push(`$${i++}`);
    p.push(src[col]);
  }
  for (const [col, val] of Object.entries(extra)) {
    f.push(col);
    ph.push(`$${i++}`);
    p.push(val);
  }
  return { f, ph, p };
}
function buildUpdate(cols, src, start = 1) {
  const f = [],
    p = [];
  let i = start;
  for (const col of cols) {
    if (src[col] === undefined) continue;
    f.push(`${col} = $${i++}`);
    p.push(src[col]);
  }
  return { f, p, next: i };
}

async function listAccounts({ client, brand, filters = {} }) {
  const where = [];
  const params = [];
  let i = 1;
  if (filters.is_active !== undefined) {
    where.push(`is_active = $${i++}`);
    params.push(filters.is_active);
  }
  if (filters.q) {
    where.push(`(account_name ILIKE $${i} OR account_code ILIKE $${i})`);
    params.push(`%${filters.q}%`);
    i++;
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "chart_of_accounts")} ${w} ORDER BY account_code`,
    params,
  );
  return rows;
}
async function getAccount({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "chart_of_accounts")} WHERE account_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function getAccountByCode({ client, brand, code }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "chart_of_accounts")} WHERE account_code = $1 AND is_active = true AND allow_posting = true`,
    [code],
  );
  return rows[0] || null;
}
async function createAccount({ client, brand, input }) {
  const { f, ph, p } = buildInsert(ACCOUNT_COLS, input);
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "chart_of_accounts")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function updateAccount({ client, brand, id, patch }) {
  const { f, p, next } = buildUpdate(ACCOUNT_COLS, patch);
  if (!f.length) return getAccount({ client, brand, id });
  p.push(id);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "chart_of_accounts")} SET ${f.join(",")} WHERE account_id = $${next} RETURNING *`,
    p,
  );
  return rows[0] || null;
}

// ── Fiscal periods ───────────────────────────────────────
async function listPeriods({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "fiscal_periods")} ORDER BY fiscal_year DESC, period_number DESC`,
  );
  return rows;
}
async function getPeriod({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "fiscal_periods")} WHERE period_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function findActivePeriod({ client, brand, date }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "fiscal_periods")}
      WHERE $1::date BETWEEN starts_on AND ends_on AND status IN ('open','adjusted','closing')
      ORDER BY starts_on DESC LIMIT 1`,
    [date],
  );
  return rows[0] || null;
}
async function createPeriod({ client, brand, input }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "fiscal_periods")} (fiscal_year, period_number, period_name, starts_on, ends_on, status, is_year_end)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,'open'),COALESCE($7,false)) RETURNING *`,
    [
      input.fiscal_year,
      input.period_number,
      input.period_name,
      input.starts_on,
      input.ends_on,
      input.status,
      input.is_year_end,
    ],
  );
  return rows[0];
}
async function closePeriod({ client, brand, id, user_id }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "fiscal_periods")} SET status = 'closed', closed_by = $2, closed_at = now() WHERE period_id = $1 RETURNING *`,
    [id, user_id || null],
  );
  return rows[0] || null;
}

// ── Journals ─────────────────────────────────────────────
async function nextEntryNumber({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT ${t(brand, "fn_next_document_number")}('journal_entry') AS n`,
  );
  return rows[0].n;
}
async function insertEntry({ client, brand, entry }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "journal_entries")}
       (entry_number, source_type, source_table, source_id, fiscal_period_id, posting_date,
        transaction_currency, fx_rate_used, description, reference, status)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'NGN'),COALESCE($8,1),$9,$10,'draft') RETURNING *`,
    [
      entry.entry_number,
      entry.source_type,
      entry.source_table || null,
      entry.source_id || null,
      entry.fiscal_period_id,
      entry.posting_date,
      entry.transaction_currency,
      entry.fx_rate_used,
      entry.description,
      entry.reference || null,
    ],
  );
  return rows[0];
}
async function insertLine({ client, brand, line }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "journal_lines")}
       (entry_id, account_id, description, debit_ngn, credit_ngn, contact_id, invoice_id, cost_centre, project, display_order)
     VALUES ($1,$2,$3,COALESCE($4,0),COALESCE($5,0),$6,$7,$8,$9,COALESCE($10,0)) RETURNING *`,
    [
      line.entry_id,
      line.account_id,
      line.description || null,
      line.debit_ngn,
      line.credit_ngn,
      line.contact_id || null,
      line.invoice_id || null,
      line.cost_centre || null,
      line.project || null,
      line.display_order,
    ],
  );
  return rows[0];
}
async function setEntryStatus({ client, brand, id, status, user_id }) {
  const stamp =
    status === "posted" ? ", posted_at = now(), posted_by = $3" : "";
  const params =
    status === "posted" ? [id, status, user_id || null] : [id, status];
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "journal_entries")} SET status = $2${stamp} WHERE entry_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}
async function findEntryById({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "journal_entries")} WHERE entry_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { rows: lines } = await ex(client)(
    `SELECT jl.*, coa.account_code, coa.account_name
       FROM ${t(brand, "journal_lines")} jl
       JOIN ${t(brand, "chart_of_accounts")} coa ON coa.account_id = jl.account_id
      WHERE jl.entry_id = $1 ORDER BY jl.display_order`,
    [id],
  );
  return { ...rows[0], lines };
}
async function listEntries({
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
  if (filters.source_type) {
    where.push(`source_type = $${i++}`);
    params.push(filters.source_type);
  }
  if (filters.from) {
    where.push(`posting_date >= $${i++}`);
    params.push(filters.from);
  }
  if (filters.to) {
    where.push(`posting_date <= $${i++}`);
    params.push(filters.to);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "journal_entries")} ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "journal_entries")} ${w} ORDER BY posting_date DESC, created_at DESC LIMIT $${i++} OFFSET $${i++}`,
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
async function setEntryReversed({ client, brand, id, reversal_entry_id }) {
  await ex(client)(
    `UPDATE ${t(brand, "journal_entries")} SET status = 'reversed' WHERE entry_id = $1`,
    [id],
  );
  void reversal_entry_id;
}

/**
 * Per-account posted debit/credit totals over a date window, with the
 * account's group classification — the raw material for trial balance,
 * P&L and balance sheet. Only 'posted' entries count.
 */
async function accountActivity({ client, brand, from, to }) {
  const params = [];
  const where = ["je.status = 'posted'"];
  let i = 1;
  if (from) {
    where.push(`je.posting_date >= $${i++}`);
    params.push(from);
  }
  if (to) {
    where.push(`je.posting_date <= $${i++}`);
    params.push(to);
  }
  const { rows } = await ex(client)(
    `SELECT coa.account_code, coa.account_name, coa.display_order,
            ag.group_type, ag.normal_balance, ag.statement,
            COALESCE(SUM(jl.debit_ngn), 0)  AS debit_ngn,
            COALESCE(SUM(jl.credit_ngn), 0) AS credit_ngn
       FROM ${t(brand, "journal_lines")} jl
       JOIN ${t(brand, "journal_entries")} je ON je.entry_id = jl.entry_id
       JOIN ${t(brand, "chart_of_accounts")} coa ON coa.account_id = jl.account_id
       JOIN ${t(brand, "account_groups")} ag ON ag.group_id = coa.group_id
      WHERE ${where.join(" AND ")}
      GROUP BY coa.account_code, coa.account_name, coa.display_order, ag.group_type, ag.normal_balance, ag.statement
     HAVING COALESCE(SUM(jl.debit_ngn),0) <> 0 OR COALESCE(SUM(jl.credit_ngn),0) <> 0
      ORDER BY coa.account_code`,
    params,
  );
  return rows;
}

/**
 * Cash & cash-equivalent accounts: the seeded cash/petty/bank codes plus any
 * account linked to a real bank account. Used by the cash-flow statement.
 */
const CASH_ACCOUNT_PREDICATE =
  "(coa.account_code IN ('1000','1010','1100') OR coa.bank_account_id IS NOT NULL)";

/**
 * Net cash movement grouped by journal source_type over a period (direct
 * method). Positive = cash in, negative = cash out. Only 'posted' entries.
 */
async function cashFlowByActivity({ client, brand, from, to }) {
  const params = [];
  const where = ["je.status = 'posted'"];
  let i = 1;
  if (from) {
    where.push(`je.posting_date >= $${i++}`);
    params.push(from);
  }
  if (to) {
    where.push(`je.posting_date <= $${i++}`);
    params.push(to);
  }
  const { rows } = await ex(client)(
    `SELECT je.source_type,
            COALESCE(SUM(
              CASE WHEN ${CASH_ACCOUNT_PREDICATE}
                   THEN jl.debit_ngn - jl.credit_ngn ELSE 0 END
            ), 0) AS cash_delta_ngn
       FROM ${t(brand, "journal_lines")} jl
       JOIN ${t(brand, "journal_entries")} je ON je.entry_id = jl.entry_id
       JOIN ${t(brand, "chart_of_accounts")} coa ON coa.account_id = jl.account_id
      WHERE ${where.join(" AND ")}
      GROUP BY je.source_type
     HAVING COALESCE(SUM(
              CASE WHEN ${CASH_ACCOUNT_PREDICATE}
                   THEN jl.debit_ngn - jl.credit_ngn ELSE 0 END
            ), 0) <> 0
      ORDER BY je.source_type`,
    params,
  );
  return rows;
}

/**
 * Closing balance of all cash & cash-equivalent accounts as of a date
 * (inclusive). Cash is a debit-normal asset, so balance = debits - credits.
 */
async function cashBalanceAsOf({ client, brand, as_of }) {
  const params = [];
  const where = ["je.status = 'posted'"];
  let i = 1;
  if (as_of) {
    where.push(`je.posting_date <= $${i++}`);
    params.push(as_of);
  }
  const { rows } = await ex(client)(
    `SELECT COALESCE(SUM(jl.debit_ngn - jl.credit_ngn), 0) AS balance_ngn
       FROM ${t(brand, "journal_lines")} jl
       JOIN ${t(brand, "journal_entries")} je ON je.entry_id = jl.entry_id
       JOIN ${t(brand, "chart_of_accounts")} coa ON coa.account_id = jl.account_id
      WHERE ${where.join(" AND ")} AND ${CASH_ACCOUNT_PREDICATE}`,
    params,
  );
  return rows[0].balance_ngn;
}

/**
 * AR ageing: open customer-invoice balances bucketed by age (from issue
 * date) per customer. Ages the live balance_due, not the original total.
 */
async function receivablesAgeing({ client, brand, as_of }) {
  const ref = as_of || new Date().toISOString().slice(0, 10);
  const { rows } = await ex(client)(
    `SELECT i.contact_id AS party_id,
            c.display_name AS party_name,
            COALESCE(SUM(i.balance_due_ngn), 0) AS total_ngn,
            COALESCE(SUM(CASE WHEN ($1::date - i.issue_date) <= 30
                              THEN i.balance_due_ngn ELSE 0 END), 0) AS b_0_30,
            COALESCE(SUM(CASE WHEN ($1::date - i.issue_date) BETWEEN 31 AND 60
                              THEN i.balance_due_ngn ELSE 0 END), 0) AS b_31_60,
            COALESCE(SUM(CASE WHEN ($1::date - i.issue_date) BETWEEN 61 AND 90
                              THEN i.balance_due_ngn ELSE 0 END), 0) AS b_61_90,
            COALESCE(SUM(CASE WHEN ($1::date - i.issue_date) > 90
                              THEN i.balance_due_ngn ELSE 0 END), 0) AS b_90_plus
       FROM ${t(brand, "invoices")} i
       JOIN shared.contacts c ON c.contact_id = i.contact_id
      WHERE i.balance_due_ngn > 0
        AND i.status NOT IN ('draft', 'void', 'paid')
      GROUP BY i.contact_id, c.display_name
      ORDER BY total_ngn DESC`,
    [ref],
  );
  return rows;
}

/**
 * AP ageing: open supplier-invoice balances bucketed by age (from invoice
 * date) per supplier.
 */
async function payablesAgeing({ client, brand, as_of }) {
  const ref = as_of || new Date().toISOString().slice(0, 10);
  const { rows } = await ex(client)(
    `SELECT si.supplier_id AS party_id,
            s.display_name AS party_name,
            COALESCE(SUM(si.balance_due_ngn), 0) AS total_ngn,
            COALESCE(SUM(CASE WHEN ($1::date - si.invoice_date) <= 30
                              THEN si.balance_due_ngn ELSE 0 END), 0) AS b_0_30,
            COALESCE(SUM(CASE WHEN ($1::date - si.invoice_date) BETWEEN 31 AND 60
                              THEN si.balance_due_ngn ELSE 0 END), 0) AS b_31_60,
            COALESCE(SUM(CASE WHEN ($1::date - si.invoice_date) BETWEEN 61 AND 90
                              THEN si.balance_due_ngn ELSE 0 END), 0) AS b_61_90,
            COALESCE(SUM(CASE WHEN ($1::date - si.invoice_date) > 90
                              THEN si.balance_due_ngn ELSE 0 END), 0) AS b_90_plus
       FROM ${t(brand, "supplier_invoices")} si
       JOIN ${t(brand, "suppliers")} s ON s.supplier_id = si.supplier_id
      WHERE si.balance_due_ngn > 0
        AND si.status NOT IN ('void', 'paid')
      GROUP BY si.supplier_id, s.display_name
      ORDER BY total_ngn DESC`,
    [ref],
  );
  return rows;
}

module.exports = {
  listGroups,
  updateGroup,
  listAccounts,
  getAccount,
  getAccountByCode,
  createAccount,
  updateAccount,
  listPeriods,
  getPeriod,
  findActivePeriod,
  createPeriod,
  closePeriod,
  nextEntryNumber,
  insertEntry,
  insertLine,
  setEntryStatus,
  findEntryById,
  listEntries,
  setEntryReversed,
  accountActivity,
  cashFlowByActivity,
  cashBalanceAsOf,
  receivablesAgeing,
  payablesAgeing,
};
