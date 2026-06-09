/**
 * Cash Request & Disbursement (V2.2 §6.32) — repository.
 *
 * The cash_requests table is SHARED (`shared.cash_requests`) with a
 * `business` discriminator (the brand key). The document-numbering function
 * is per-brand, so request numbers are issued via
 * `<brand>.fn_next_document_number('cash_request')`.
 *
 * Parameterised SQL only — no business logic, no HTTP.
 */

"use strict";

const { query } = require("../../config/database");

const { VALID_BRANDS } = require("../../config/brands");
const ex = (c) => (c ? c.query.bind(c) : query);

function assertBrand(brand) {
  if (!VALID_BRANDS.has(brand)) throw new Error(`Invalid brand: ${brand}`);
  return brand;
}

const CREATE_COLS = [
  "business",
  "request_number",
  "submitted_by",
  "category_key",
  "category_display",
  "purpose",
  "needed_by_date",
  "urgency",
  "amount_requested_ngn",
  "currency_code",
  "fx_rate_used",
  "display_amount",
  "recipient_type",
  "recipient_name",
  "recipient_bank_name",
  "recipient_account_number",
  "recipient_account_name",
  "requires_settlement",
  "settlement_required_by",
  "status",
];

function buildInsert(cols, src) {
  const f = [];
  const ph = [];
  const p = [];
  let i = 1;
  for (const c of cols) {
    if (src[c] === undefined) continue;
    f.push(c);
    ph.push(`$${i++}`);
    p.push(src[c]);
  }
  return { f, ph, p };
}

async function nextNumber({ client, brand }) {
  assertBrand(brand);
  const { rows } = await ex(client)(
    `SELECT ${brand}.fn_next_document_number('cash_request') AS n`,
  );
  return rows[0].n;
}

async function create({ client, brand, row }) {
  assertBrand(brand);
  const { f, ph, p } = buildInsert(CREATE_COLS, { ...row, business: brand });
  const { rows } = await ex(client)(
    `INSERT INTO shared.cash_requests (${f.join(",")})
     VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}

async function findById({ client, brand, id }) {
  assertBrand(brand);
  const { rows } = await ex(client)(
    `SELECT * FROM shared.cash_requests
      WHERE cash_request_id = $1 AND business = $2`,
    [id, brand],
  );
  return rows[0] || null;
}

async function findAll({
  brand,
  scope,
  user_id,
  filters = {},
  page,
  page_size,
}) {
  assertBrand(brand);
  const where = ["business = $1"];
  const params = [brand];
  let i = 2;
  // 'own' scope: only the requests the user submitted.
  if (scope === "own") {
    where.push(`submitted_by = $${i++}`);
    params.push(user_id);
  }
  if (filters.status) {
    where.push(`status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.match_status) {
    where.push(`match_status = $${i++}`);
    params.push(filters.match_status);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;

  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total FROM shared.cash_requests ${whereSql}`,
    params,
  );
  const offset = (page - 1) * page_size;
  const { rows } = await query(
    `SELECT * FROM shared.cash_requests ${whereSql}
      ORDER BY submitted_at DESC, created_at DESC
      LIMIT $${i++} OFFSET $${i}`,
    [...params, page_size, offset],
  );
  return { data: rows, page, page_size, total: countRows[0].total };
}

/**
 * Apply a status transition + arbitrary stamp fields in one UPDATE, scoped
 * to the brand. `fields` is an allowlisted object of column→value.
 */
async function updateStatus({ client, brand, id, status, fields = {} }) {
  assertBrand(brand);
  const set = ["status = $3"];
  const params = [id, brand, status];
  let i = 4;
  for (const [col, val] of Object.entries(fields)) {
    set.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE shared.cash_requests
        SET ${set.join(", ")}
      WHERE cash_request_id = $1 AND business = $2
      RETURNING *`,
    params,
  );
  return rows[0] || null;
}

/**
 * Resolve the per-brand expense category for a cash-request category_key —
 * gives the default GL account for the disbursement journal and the
 * category_id for the auto-created Expense.
 */
async function findExpenseCategory({ client, brand, category_key }) {
  assertBrand(brand);
  const { rows } = await ex(client)(
    `SELECT category_id, category_key, default_account_id
       FROM ${brand}.expense_categories
      WHERE category_key = $1`,
    [category_key],
  );
  return rows[0] || null;
}

async function insertStateHistory({
  client,
  cash_request_id,
  from_status,
  to_status,
  changed_by,
  notes,
  amount_snapshot_ngn,
  decision_snapshot,
}) {
  await ex(client)(
    `INSERT INTO shared.cash_request_state_history
       (cash_request_id, from_status, to_status, changed_by, notes,
        amount_snapshot_ngn, decision_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      cash_request_id,
      from_status || null,
      to_status,
      changed_by || null,
      notes || null,
      amount_snapshot_ngn !== undefined ? amount_snapshot_ngn : null,
      decision_snapshot || null,
    ],
  );
}

module.exports = {
  nextNumber,
  create,
  findById,
  findAll,
  updateStatus,
  findExpenseCategory,
  insertStateHistory,
};
