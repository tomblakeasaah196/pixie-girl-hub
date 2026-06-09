/**
 * Inter-Company Transactions (V2.2 §5.1) — repository.
 *
 * shared.intercompany_transactions + shared.intercompany_reconciliations are
 * GLOBAL (cross-brand by definition), filtered by seller_brand/buyer_brand.
 * Parameterised SQL only.
 */

"use strict";

const { query } = require("../../config/database");

const ex = (c) => (c ? c.query.bind(c) : query);

const CREATE_COLS = [
  "ic_number",
  "flow_type",
  "seller_brand",
  "buyer_brand",
  "currency",
  "amount",
  "amount_ngn",
  "fx_rate_used",
  "min_margin_floor_pct",
  "seller_doc_type",
  "seller_doc_id",
  "seller_doc_number",
  "status",
  "reference_type",
  "reference_id",
  "description",
  "posted_by",
];

async function create({ client, row }) {
  const f = [];
  const ph = [];
  const p = [];
  let i = 1;
  for (const c of CREATE_COLS) {
    if (row[c] === undefined) continue;
    f.push(c);
    ph.push(`$${i++}`);
    p.push(row[c]);
  }
  const { rows } = await ex(client)(
    `INSERT INTO shared.intercompany_transactions (${f.join(",")})
     VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}

async function findById({ client, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.intercompany_transactions WHERE ic_transaction_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function list({ brand, status, page = 1, page_size = 25 }) {
  const where = [];
  const params = [];
  let i = 1;
  if (brand) {
    where.push(`(seller_brand = $${i} OR buyer_brand = $${i})`);
    params.push(brand);
    i++;
  }
  if (status) {
    where.push(`status = $${i++}`);
    params.push(status);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows: c } = await query(
    `SELECT count(*)::int AS total FROM shared.intercompany_transactions ${w}`,
    params,
  );
  const offset = (page - 1) * page_size;
  const { rows } = await query(
    `SELECT * FROM shared.intercompany_transactions ${w}
      ORDER BY posted_at DESC LIMIT $${i++} OFFSET $${i}`,
    [...params, page_size, offset],
  );
  return { data: rows, page, page_size, total: c[0].total };
}

async function setStatus({ client, id, status, fields = {} }) {
  const set = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [col, val] of Object.entries(fields)) {
    set.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE shared.intercompany_transactions SET ${set.join(", ")}, updated_at = now()
      WHERE ic_transaction_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function createReconciliation({ client, recon }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.intercompany_reconciliations
       (ic_transaction_id, discrepancy_type, status, notes)
     VALUES ($1,$2,COALESCE($3,'open'),$4) RETURNING *`,
    [
      recon.ic_transaction_id,
      recon.discrepancy_type,
      recon.status,
      recon.notes || null,
    ],
  );
  return rows[0];
}

async function listReconciliations({ ic_transaction_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.intercompany_reconciliations
      WHERE ic_transaction_id = $1 ORDER BY swept_at DESC`,
    [ic_transaction_id],
  );
  return rows;
}

module.exports = {
  create,
  findById,
  list,
  setStatus,
  createReconciliation,
  listReconciliations,
};
