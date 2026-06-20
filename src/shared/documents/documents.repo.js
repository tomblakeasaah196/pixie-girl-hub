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

// ── Tags (shared.document_tags) ──────────────────────────────
// Labels attached to a document for organisation/retrieval beyond the rigid
// document_type. UNIQUE(document_id, tag_name, business) so re-tagging is
// idempotent. The documents row itself stays immutable — tags live here.

async function addTags({ client, document_id, business, tags = [], tagged_by }) {
  if (!tags.length) return;
  const run = ex(client);
  for (const t of tags) {
    const name = typeof t === "string" ? t : t.name;
    const colour = (typeof t === "object" && t.colour) || "#64748B";
    if (!name) continue;
    await run(
      `INSERT INTO shared.document_tags
         (document_id, tag_name, business, colour, tagged_by)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (document_id, tag_name, business) DO NOTHING`,
      [document_id, name, business, colour, tagged_by || null],
    );
  }
}

/** Fetch tags for a set of documents → Map(document_id → [{tag_name, colour}]). */
async function tagsByDocument({ client, document_ids = [] }) {
  const map = new Map();
  if (!document_ids.length) return map;
  const { rows } = await ex(client)(
    `SELECT document_id, tag_name, colour
       FROM shared.document_tags
      WHERE document_id = ANY($1::uuid[])
      ORDER BY created_at`,
    [document_ids],
  );
  for (const r of rows) {
    const arr = map.get(r.document_id) || [];
    arr.push({ tag_name: r.tag_name, colour: r.colour });
    map.set(r.document_id, arr);
  }
  return map;
}

/** Mutate `rows` in place, attaching a `tags` array to each. */
async function attachTags({ client, rows = [] }) {
  if (!rows.length) return rows;
  const map = await tagsByDocument({
    client,
    document_ids: rows.map((r) => r.document_id),
  });
  for (const r of rows) r.tags = map.get(r.document_id) || [];
  return rows;
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
  if (filters.tag) {
    where.push(
      `EXISTS (SELECT 1 FROM shared.document_tags dt
                WHERE dt.document_id = shared.documents.document_id
                  AND dt.tag_name = $${i})`,
    );
    params.push(filters.tag);
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
  await attachTags({ client, rows });
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
  addTags,
  tagsByDocument,
  attachTags,
};
