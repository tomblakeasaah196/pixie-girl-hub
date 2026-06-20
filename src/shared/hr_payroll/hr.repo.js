/**
 * Employee (staff) repository (V2.2 §6.11).
 * Table: shared.staff_profiles (filtered by business). PK profile_id.
 *
 * PII (bank_account_number, bank_sort_code, nin, bvn) is AES-encrypted at
 * rest via services/encryption.service: encrypted on write, decrypted on
 * read. The service layer then masks decrypted values for viewers who aren't
 * the owner. Soft-delete via is_deleted/deleted_at.
 */

"use strict";

const { query } = require("../../config/database");
const { encrypt, decrypt } = require("../../services/encryption.service");
const { ENCRYPTED_FIELDS } = require("./hr.fields");

function exec(client) {
  return client ? client.query.bind(client) : query;
}

const ENC = new Set(ENCRYPTED_FIELDS);

// Columns settable on update; contact_id/employee_number are create-time only.
const UPDATE_COLS = [
  "department",
  "job_title",
  "employment_type",
  "start_date",
  "end_date",
  "reports_to",
  "bank_name",
  "bank_account_number",
  "bank_sort_code",
  "nin",
  "bvn",
  "base_salary",
  "pension_pin",
  "nhf_number",
  "tax_id",
  "probation_status",
  "probation_start_date",
  "probation_end_date",
  "probation_outcome",
  "annual_leave_days_entitled",
  "annual_leave_days_remaining",
  "public_holiday_days_used",
  "special_event_days_owed",
  "special_event_days_taken",
  "non_solicit_months",
  "non_solicit_until",
  "non_solicit_signed_at",
  "dismissal_triggers_log",
  "work_schedule",
  "work_expected_start_time",
  "work_grace_minutes",
];
const CREATE_COLS = ["contact_id", "employee_number", ...UPDATE_COLS];
const JSONB = new Set(["dismissal_triggers_log", "work_schedule"]);

function encField(col, value) {
  if (value === null || value === undefined || value === "") return value;
  return ENC.has(col) ? encrypt(String(value)) : value;
}
function decryptRow(row) {
  if (!row) return row;
  const out = { ...row };
  for (const f of ENCRYPTED_FIELDS) {
    if (out[f]) {
      try {
        out[f] = decrypt(out[f]);
      } catch {
        out[f] = null; // unreadable / legacy plaintext — fail closed
      }
    }
  }
  return out;
}

const LIST_SELECT = `
  sp.*, c.display_name, c.primary_phone, c.email AS contact_email`;

async function findAll({
  client,
  brand,
  filters = {},
  page = 1,
  page_size = 50,
}) {
  const where = ["sp.business = $1"];
  const params = [brand];
  let i = 2;
  if (filters.include_inactive !== "true") where.push("sp.is_deleted = false");
  if (filters.employment_type) {
    where.push(`sp.employment_type = $${i++}`);
    params.push(filters.employment_type);
  }
  if (filters.reports_to) {
    where.push(`sp.reports_to = $${i++}`);
    params.push(filters.reports_to);
  }
  if (filters.probation_status) {
    where.push(`sp.probation_status = $${i++}`);
    params.push(filters.probation_status);
  }
  if (filters.q) {
    where.push(
      `(c.display_name ILIKE $${i} OR sp.employee_number ILIKE $${i} OR sp.job_title ILIKE $${i})`,
    );
    params.push(`%${filters.q}%`);
    i++;
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const offset = (page - 1) * page_size;
  const run = exec(client);
  const { rows } = await run(
    `SELECT ${LIST_SELECT}
       FROM shared.staff_profiles sp
       LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
      ${whereSql}
      ORDER BY c.display_name ASC NULLS LAST, sp.employee_number ASC
      LIMIT $${i} OFFSET $${i + 1}`,
    [...params, page_size, offset],
  );
  const { rows: countRows } = await run(
    `SELECT count(*)::int AS total
       FROM shared.staff_profiles sp
       LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
      ${whereSql}`,
    params,
  );
  return {
    data: rows.map(decryptRow),
    page,
    page_size,
    total: countRows[0].total,
  };
}

async function findById({ client, brand, id }) {
  const { rows } = await exec(client)(
    `SELECT ${LIST_SELECT}
       FROM shared.staff_profiles sp
       LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
      WHERE sp.profile_id = $1 AND sp.business = $2
      LIMIT 1`,
    [id, brand],
  );
  return decryptRow(rows[0] || null);
}

async function create({ client, brand, input }) {
  const cols = ["business"];
  const vals = ["$1"];
  const params = [brand];
  let i = 2;
  for (const col of CREATE_COLS) {
    if (input[col] === undefined) continue;
    cols.push(col);
    vals.push(JSONB.has(col) ? `$${i}::jsonb` : `$${i}`);
    params.push(
      JSONB.has(col) ? JSON.stringify(input[col]) : encField(col, input[col]),
    );
    i++;
  }
  const { rows } = await exec(client)(
    `INSERT INTO shared.staff_profiles (${cols.join(", ")})
     VALUES (${vals.join(", ")}) RETURNING *`,
    params,
  );
  return decryptRow(rows[0]);
}

async function update({ client, brand, id, patch }) {
  const sets = [];
  const params = [];
  let i = 1;
  for (const col of UPDATE_COLS) {
    if (patch[col] === undefined) continue;
    sets.push(JSONB.has(col) ? `${col} = $${i}::jsonb` : `${col} = $${i}`);
    params.push(
      JSONB.has(col) ? JSON.stringify(patch[col]) : encField(col, patch[col]),
    );
    i++;
  }
  if (sets.length === 0) return findById({ client, brand, id });
  params.push(id, brand);
  const { rows } = await exec(client)(
    `UPDATE shared.staff_profiles SET ${sets.join(", ")}
      WHERE profile_id = $${i} AND business = $${i + 1}
      RETURNING *`,
    params,
  );
  return decryptRow(rows[0] || null);
}

async function softDelete({ client, brand, id }) {
  const { rows } = await exec(client)(
    `UPDATE shared.staff_profiles
        SET is_deleted = true, deleted_at = now()
      WHERE profile_id = $1 AND business = $2
      RETURNING profile_id`,
    [id, brand],
  );
  return rows[0] || null;
}

module.exports = { findAll, findById, create, update, softDelete };
