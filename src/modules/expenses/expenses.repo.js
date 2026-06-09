/**
 * Expense Management (V2.2 §6.7) — repository.
 * Tables (per-brand): expense_categories, expenses, expense_lines.
 */

"use strict";

const { query } = require("../../config/database");

const { VALID } = require("../../config/brands");
const t = (brand, tbl) => {
  if (!VALID.has(brand)) throw new Error(`Invalid brand: ${brand}`);
  return `${brand}.${tbl}`;
};
const ex = (client) => (client ? client.query.bind(client) : query);

// ── Categories ───────────────────────────────────────────
const CAT_COLS = [
  "category_key",
  "display_name",
  "description",
  "default_account_id",
  "default_vat_rate",
  "default_wht_rate",
  "is_active",
  "workflow_key_override",
  "unusual_amount_threshold_ngn",
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
async function listCategories({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "expense_categories")} ORDER BY display_order, display_name`,
  );
  return rows;
}
async function getCategory({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "expense_categories")} WHERE category_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function createCategory({ client, brand, input }) {
  const { f, ph, p } = buildInsert(CAT_COLS, input);
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "expense_categories")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function updateCategory({ client, brand, id, patch }) {
  const f = [],
    p = [];
  let i = 1;
  for (const col of CAT_COLS) {
    if (patch[col] === undefined) continue;
    f.push(`${col} = $${i++}`);
    p.push(patch[col]);
  }
  if (!f.length) return getCategory({ client, brand, id });
  p.push(id);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "expense_categories")} SET ${f.join(",")} WHERE category_id = $${i} RETURNING *`,
    p,
  );
  return rows[0] || null;
}

// ── Expenses (+ lines) ───────────────────────────────────
const EXP_COLS = [
  "expense_number",
  "expense_type",
  "submitted_by",
  "advance_id",
  "title",
  "expense_date",
  "description",
  "total_amount_ngn",
  "vat_amount_ngn",
  "original_currency",
  "original_amount",
  "fx_rate_used",
  "status",
];
const ELINE_COLS = [
  "expense_id",
  "category_id",
  "description",
  "amount_ngn",
  "vat_amount_ngn",
  "wht_amount_ngn",
  "vendor_name",
  "vendor_tin",
  "receipt_date",
  "account_id",
  "project",
  "cost_centre",
  "display_order",
];

async function nextNumber({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT ${t(brand, "fn_next_document_number")}('expense') AS n`,
  );
  return rows[0].n;
}
async function createExpense({ client, brand, header }) {
  const { f, ph, p } = buildInsert(EXP_COLS, header);
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "expenses")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function insertLine({ client, brand, line }) {
  const { f, ph, p } = buildInsert(ELINE_COLS, line);
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "expense_lines")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function findById({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "expenses")} WHERE expense_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { rows: lines } = await ex(client)(
    `SELECT el.*, coa.account_code FROM ${t(brand, "expense_lines")} el
       LEFT JOIN ${t(brand, "chart_of_accounts")} coa ON coa.account_id = el.account_id
      WHERE el.expense_id = $1 ORDER BY el.display_order`,
    [id],
  );
  return { ...rows[0], lines };
}
async function listExpenses({
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
  if (filters.submitted_by) {
    where.push(`submitted_by = $${i++}`);
    params.push(filters.submitted_by);
  }
  if (filters.expense_type) {
    where.push(`expense_type = $${i++}`);
    params.push(filters.expense_type);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "expenses")} ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "expenses")} ${w} ORDER BY expense_date DESC, created_at DESC LIMIT $${i++} OFFSET $${i++}`,
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
async function setStatus({ client, brand, id, status, extra = {} }) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "expenses")} SET ${sets.join(", ")} WHERE expense_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── Cash advances (+ settlements) ────────────────────────
async function nextAdvanceNumber({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT ${t(brand, "fn_next_document_number")}('cash_advance') AS n`,
  );
  return rows[0].n;
}
async function createAdvance({ client, brand, advance, user_id }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "cash_advances")}
       (advance_number, requested_by, purpose, category_id, requested_amount_ngn,
        requested_currency, requested_amount_currency, settle_by, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      advance.advance_number,
      user_id,
      advance.purpose,
      advance.category_id || null,
      advance.requested_amount_ngn,
      advance.requested_currency || null,
      advance.requested_amount_currency ?? null,
      advance.settle_by || null,
      advance.notes || null,
    ],
  );
  return rows[0];
}
async function getAdvance({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "cash_advances")} WHERE advance_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { rows: settlements } = await ex(client)(
    `SELECT * FROM ${t(brand, "cash_advance_settlements")} WHERE advance_id = $1 ORDER BY recorded_at`,
    [id],
  );
  return { ...rows[0], settlements };
}
async function listAdvances({
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
  if (filters.requested_by) {
    where.push(`requested_by = $${i++}`);
    params.push(filters.requested_by);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "cash_advances")} ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "cash_advances")} ${w} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
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
async function setAdvanceStatus({ client, brand, id, status, extra = {} }) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "cash_advances")} SET ${sets.join(", ")} WHERE advance_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}
async function createSettlement({ client, brand, settlement, user_id }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "cash_advance_settlements")}
       (advance_id, expense_id, amount_settled_ngn, change_returned_ngn, shortfall_ngn, recorded_by, notes)
     VALUES ($1,$2,$3,COALESCE($4,0),COALESCE($5,0),$6,$7) RETURNING *`,
    [
      settlement.advance_id,
      settlement.expense_id || null,
      settlement.amount_settled_ngn,
      settlement.change_returned_ngn,
      settlement.shortfall_ngn,
      user_id,
      settlement.notes || null,
    ],
  );
  return rows[0];
}

// ── Expense receipts (files via Documents gateway) ───────
async function addReceipt({ client, brand, receipt }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "expense_receipts")}
       (expense_id, expense_line_id, document_id, amount_on_receipt_ngn, receipt_date, vendor_name, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      receipt.expense_id || null,
      receipt.expense_line_id || null,
      receipt.document_id,
      receipt.amount_on_receipt_ngn ?? null,
      receipt.receipt_date || null,
      receipt.vendor_name || null,
      receipt.uploaded_by || null,
    ],
  );
  return rows[0];
}
async function listReceipts({ client, brand, expense_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "expense_receipts")} WHERE expense_id = $1 ORDER BY uploaded_at`,
    [expense_id],
  );
  return rows;
}

module.exports = {
  listCategories,
  getCategory,
  createCategory,
  updateCategory,
  nextNumber,
  createExpense,
  insertLine,
  findById,
  listExpenses,
  setStatus,
  nextAdvanceNumber,
  createAdvance,
  getAdvance,
  listAdvances,
  setAdvanceStatus,
  createSettlement,
  addReceipt,
  listReceipts,
};
