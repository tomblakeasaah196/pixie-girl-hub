/**
 * Customer assets (Stylist Studio §6.24) — repository.
 *
 * A client's OWN wig taken in for a service (revamp / install). Chain of
 * custody: check-in (we take possession) → in_service → returned_to_owner.
 * Parameterised SQL only; per-brand tables via the brand registry `t()`.
 */

"use strict";

const { query } = require("../../config/database");
const { t } = require("../../config/brands");

const ex = (c) => (c ? c.query.bind(c) : query);

async function nextTag({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT ${t(brand, "fn_next_document_number")}($1) AS n`,
    ["customer_asset"],
  );
  return rows[0].n;
}

async function create({ client, brand, asset }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "customer_assets")}
       (asset_tag, owner_contact_id, intake_photo_doc_id, condition_note,
        status, service_job_id, created_by)
     VALUES ($1,$2,$3,$4,COALESCE($5,'in_our_possession'),$6,$7)
     RETURNING *`,
    [
      asset.asset_tag,
      asset.owner_contact_id,
      asset.intake_photo_doc_id || null,
      asset.condition_note || null,
      asset.status || null,
      asset.service_job_id || null,
      asset.created_by || null,
    ],
  );
  return rows[0];
}

async function get({ brand, id }) {
  const { rows } = await query(
    `SELECT a.*, c.display_name AS owner_name
       FROM ${t(brand, "customer_assets")} a
       LEFT JOIN shared.contacts c ON c.contact_id = a.owner_contact_id
      WHERE a.asset_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function list({
  brand,
  status,
  owner_contact_id,
  page = 1,
  page_size = 25,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (status) {
    where.push(`a.status = $${i++}`);
    params.push(status);
  }
  if (owner_contact_id) {
    where.push(`a.owner_contact_id = $${i++}`);
    params.push(owner_contact_id);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows: c } = await query(
    `SELECT count(*)::int AS total FROM ${t(brand, "customer_assets")} a ${w}`,
    params,
  );
  const offset = (page - 1) * page_size;
  const { rows } = await query(
    `SELECT a.*, c.display_name AS owner_name
       FROM ${t(brand, "customer_assets")} a
       LEFT JOIN shared.contacts c ON c.contact_id = a.owner_contact_id
       ${w}
      ORDER BY a.checked_in_at DESC LIMIT $${i++} OFFSET $${i}`,
    [...params, page_size, offset],
  );
  return { data: rows, page, page_size, total: c[0].total };
}

async function setStatus({ client, brand, id, status, fields = {} }) {
  const set = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [col, val] of Object.entries(fields)) {
    set.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "customer_assets")} SET ${set.join(", ")}, updated_at = now()
      WHERE asset_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

module.exports = { nextTag, create, get, list, setStatus };
