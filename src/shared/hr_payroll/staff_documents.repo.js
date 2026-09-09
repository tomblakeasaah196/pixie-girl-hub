/**
 * Employee documents repository (V2.2 §6.11 — HR & Staff → Employee →
 * Documents).
 *
 * Two things live here:
 *
 *   1. `shared.hr_document_types` — the per-brand catalogue of document types
 *      (Contract, Guarantor Form, NIN, Passport Photograph, …), curated by HR
 *      and extensible from the upload drawer.
 *   2. Queries over `shared.documents` filtered to
 *      reference_type = 'staff_profile', which is where an employee's actual
 *      files live. That table is the Hub's single file registry, so nothing
 *      about storage, hashing or soft-delete is duplicated here.
 *
 * These rows are deliberately NOT reachable through the generic /documents
 * module (see documents.repo.js) — a NIN slip is HR-only. Every query below
 * is scoped by `business`, and reads by employee are additionally scoped by
 * profile_id, so one brand's HR can never pull another's files.
 *
 * Repos never emit events or touch req/res.
 */

"use strict";

const { ex: exec } = require("../../config/database");

/** The reference_type every employee document is filed under. */
const STAFF_REF = "staff_profile";

const TYPE_COLS = `type_id, business, type_key, label, description,
                   is_required, accepts, sort_order, is_active, is_system,
                   created_at, updated_at`;

// ── Document type catalogue ────────────────────────────────

/**
 * The brand's document types. Archived (is_active = false) types are excluded
 * unless `includeArchived` — the picker shows live types only, while the
 * settings view needs to see what was retired.
 */
async function listTypes({ client, brand, includeArchived = false }) {
  const { rows } = await exec(client)(
    `SELECT ${TYPE_COLS}
       FROM shared.hr_document_types
      WHERE business = $1 ${includeArchived ? "" : "AND is_active = true"}
      ORDER BY sort_order, label`,
    [brand],
  );
  return rows;
}

async function findTypeByKey({ client, brand, typeKey }) {
  const { rows } = await exec(client)(
    `SELECT ${TYPE_COLS} FROM shared.hr_document_types
      WHERE business = $1 AND type_key = $2 LIMIT 1`,
    [brand, typeKey],
  );
  return rows[0] || null;
}

async function findTypeById({ client, brand, typeId }) {
  const { rows } = await exec(client)(
    `SELECT ${TYPE_COLS} FROM shared.hr_document_types
      WHERE business = $1 AND type_id = $2 LIMIT 1`,
    [brand, typeId],
  );
  return rows[0] || null;
}

/**
 * Next free sort_order for a brand, so a newly created type lands at the end
 * of the picker rather than jumping ahead of the seeded ones.
 */
async function nextTypeSortOrder({ client, brand }) {
  const { rows } = await exec(client)(
    `SELECT COALESCE(MAX(sort_order), 0) + 10 AS next
       FROM shared.hr_document_types
      WHERE business = $1 AND sort_order < 900`,
    [brand],
  );
  return rows[0].next;
}

async function insertType({ client, brand, row }) {
  const { rows } = await exec(client)(
    `INSERT INTO shared.hr_document_types
       (business, type_key, label, description, is_required, accepts,
        sort_order, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING ${TYPE_COLS}`,
    [
      brand,
      row.type_key,
      row.label,
      row.description ?? null,
      row.is_required ?? false,
      row.accepts ?? "any",
      row.sort_order,
      row.created_by ?? null,
    ],
  );
  return rows[0];
}

const TYPE_UPDATE_COLS = [
  "label",
  "description",
  "is_required",
  "accepts",
  "sort_order",
  "is_active",
];

/**
 * Patch a type. `type_key` is intentionally not updatable: it is written into
 * shared.documents.document_type, so changing it would strand every document
 * already filed under the old key. Renaming `label` relabels them all.
 */
async function updateType({ client, brand, typeId, patch }) {
  const sets = [];
  const params = [];
  let i = 1;
  for (const col of TYPE_UPDATE_COLS) {
    if (patch[col] === undefined) continue;
    sets.push(`${col} = $${i++}`);
    params.push(patch[col]);
  }
  if (!sets.length) return findTypeById({ client, brand, typeId });
  sets.push("updated_at = now()");
  params.push(typeId, brand);
  const { rows } = await exec(client)(
    `UPDATE shared.hr_document_types SET ${sets.join(", ")}
      WHERE type_id = $${i++} AND business = $${i}
      RETURNING ${TYPE_COLS}`,
    params,
  );
  return rows[0] || null;
}

/** Hard-delete a custom type. Guarded in the service (system + in-use types). */
async function deleteType({ client, brand, typeId }) {
  const { rowCount } = await exec(client)(
    `DELETE FROM shared.hr_document_types
      WHERE type_id = $1 AND business = $2 AND is_system = false`,
    [typeId, brand],
  );
  return rowCount > 0;
}

/** How many live employee documents are filed under a type key. */
async function countDocumentsOfType({ client, brand, typeKey }) {
  const { rows } = await exec(client)(
    `SELECT COUNT(*)::int AS total
       FROM shared.documents
      WHERE business = $1 AND reference_type = $2
        AND document_type = $3 AND is_deleted = false`,
    [brand, STAFF_REF, typeKey],
  );
  return rows[0].total;
}

// ── Employee documents ─────────────────────────────────────

const DOC_SELECT = `
  SELECT d.document_id, d.document_number, d.document_type, d.title,
         d.file_size_bytes, d.mime_type, d.reference_id AS profile_id,
         d.uploaded_by, d.created_at,
         t.label       AS type_label,
         t.is_required AS type_is_required,
         t.sort_order  AS type_sort_order,
         u.display_name AS uploaded_by_name
    FROM shared.documents d
    LEFT JOIN shared.hr_document_types t
           ON t.business = d.business AND t.type_key = d.document_type
    LEFT JOIN shared.users u ON u.user_id = d.uploaded_by`;

/** Every live document filed against one employee, newest first per type. */
async function listForProfile({ client, brand, profileId }) {
  const { rows } = await exec(client)(
    `${DOC_SELECT}
      WHERE d.business = $1 AND d.reference_type = $2
        AND d.reference_id = $3 AND d.is_deleted = false
      ORDER BY COALESCE(t.sort_order, 999), d.created_at DESC`,
    [brand, STAFF_REF, profileId],
  );
  return rows;
}

/**
 * One document, scoped to the employee it is filed against. Returns the
 * storage columns too (file_path is needed to stream the bytes back).
 */
async function findForProfile({ client, brand, profileId, documentId }) {
  const { rows } = await exec(client)(
    `SELECT d.*, t.label AS type_label
       FROM shared.documents d
       LEFT JOIN shared.hr_document_types t
              ON t.business = d.business AND t.type_key = d.document_type
      WHERE d.business = $1 AND d.reference_type = $2
        AND d.reference_id = $3 AND d.document_id = $4
        AND d.is_deleted = false
      LIMIT 1`,
    [brand, STAFF_REF, profileId, documentId],
  );
  return rows[0] || null;
}

/** Soft-delete, scoped to the employee so an id alone can't reach elsewhere. */
async function softDeleteForProfile({ client, brand, profileId, documentId }) {
  const { rowCount } = await exec(client)(
    `UPDATE shared.documents
        SET is_deleted = true, deleted_at = now()
      WHERE document_id = $1 AND business = $2
        AND reference_type = $3 AND reference_id = $4
        AND is_deleted = false`,
    [documentId, brand, STAFF_REF, profileId],
  );
  return rowCount > 0;
}

/**
 * Per-employee document counts for a whole staff list, so the HR roster can
 * flag who is missing paperwork without N queries.
 */
async function countsByProfile({ client, brand, profileIds }) {
  if (!profileIds || !profileIds.length) return {};
  const { rows } = await exec(client)(
    `SELECT reference_id AS profile_id, COUNT(*)::int AS total
       FROM shared.documents
      WHERE business = $1 AND reference_type = $2
        AND is_deleted = false AND reference_id = ANY($3::uuid[])
      GROUP BY reference_id`,
    [brand, STAFF_REF, profileIds],
  );
  return Object.fromEntries(rows.map((r) => [r.profile_id, r.total]));
}

module.exports = {
  STAFF_REF,
  listTypes,
  findTypeByKey,
  findTypeById,
  nextTypeSortOrder,
  insertType,
  updateType,
  deleteType,
  countDocumentsOfType,
  listForProfile,
  findForProfile,
  softDeleteForProfile,
  countsByProfile,
};
