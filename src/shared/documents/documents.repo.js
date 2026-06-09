/**
 * Documents (V2.2 §6.13) — repository. shared.documents is the central
 * registry for EVERY file in the system (uploaded or generated). Brand is
 * carried in the `business` column. document_number via
 * fn_next_document_number('document').
 */

"use strict";

const { query } = require("../../config/database");

const { VALID } = require("../../config/brands");
const ex = (c) => (c ? c.query.bind(c) : query);

async function nextNumber({ client, brand }) {
  if (!VALID.has(brand)) throw new Error(`Invalid brand: ${brand}`);
  const { rows } = await ex(client)(
    `SELECT ${brand}.fn_next_document_number('document') AS n`,
  );
  return rows[0].n;
}

async function insert({ client, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.documents
       (document_number, business, document_type, title, file_path, file_size_bytes,
        mime_type, content_hash, reference_type, reference_id, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING *`,
    [
      row.document_number,
      row.business,
      row.document_type,
      row.title,
      row.file_path,
      row.file_size_bytes,
      row.mime_type,
      row.content_hash,
      row.reference_type || null,
      row.reference_id || null,
      row.uploaded_by || null,
    ],
  );
  return rows[0];
}

async function findById({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.documents WHERE document_id = $1 AND business = $2 AND is_deleted = false`,
    [id, brand],
  );
  return rows[0] || null;
}

async function listByReference({
  client,
  brand,
  reference_type,
  reference_id,
}) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.documents
      WHERE business = $1 AND reference_type = $2 AND reference_id = $3 AND is_deleted = false
      ORDER BY created_at DESC`,
    [brand, reference_type, reference_id],
  );
  return rows;
}

async function findAll({
  client,
  brand,
  filters = {},
  page = 1,
  page_size = 25,
  offset = 0,
}) {
  const where = ["business = $1", "is_deleted = false"];
  const params = [brand];
  let i = 2;
  if (filters.document_type) {
    where.push(`document_type = $${i++}`);
    params.push(filters.document_type);
  }
  if (filters.reference_type) {
    where.push(`reference_type = $${i++}`);
    params.push(filters.reference_type);
  }
  if (filters.reference_id) {
    where.push(`reference_id = $${i++}`);
    params.push(filters.reference_id);
  }
  if (filters.q) {
    where.push(`(title ILIKE $${i} OR document_number ILIKE $${i})`);
    params.push(`%${filters.q}%`);
    i++;
  }
  const w = `WHERE ${where.join(" AND ")}`;
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM shared.documents ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM shared.documents ${w} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
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

async function softDelete({ client, brand, id }) {
  const { rowCount } = await ex(client)(
    `UPDATE shared.documents SET is_deleted = true, deleted_at = now() WHERE document_id = $1 AND business = $2 AND is_deleted = false`,
    [id, brand],
  );
  return rowCount > 0;
}

module.exports = {
  nextNumber,
  insert,
  findById,
  listByReference,
  findAll,
  softDelete,
};
