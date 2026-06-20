/**
 * Contacts (V2.2 §6.12) — repository.
 * shared.contacts is GLOBAL (a customer may buy from both brands), so it is
 * NOT brand-prefixed. shared.contact_segments IS brand-scoped (business col).
 */

"use strict";

const { query } = require("../../config/database");

const { VALID } = require("../../config/brands");
const ex = (c) => (c ? c.query.bind(c) : query);

const C_COLS = [
  "contact_type",
  "display_name",
  "first_name",
  "last_name",
  "company_name",
  "gender",
  "date_of_birth",
  "tin",
  "cac_number",
  "primary_phone",
  "whatsapp_number",
  "email",
  "country_code",
  "instagram_handle",
  "tiktok_handle",
  "facebook_handle",
  "priority_level",
  "assigned_to",
  "visible_to",
  "source",
  "notes",
];
const SEG_COLS = ["name", "description", "filter"];
const JSONB = new Set(["filter"]);

function insert(cols, src, extra = {}) {
  const f = [],
    ph = [],
    p = [];
  let i = 1;
  for (const c of cols) {
    if (src[c] === undefined) continue;
    f.push(c);
    ph.push(JSONB.has(c) ? `$${i}::jsonb` : `$${i}`);
    p.push(JSONB.has(c) ? JSON.stringify(src[c]) : src[c]);
    i++;
  }
  for (const [c, v] of Object.entries(extra)) {
    f.push(c);
    ph.push(`$${i}`);
    p.push(v);
    i++;
  }
  return { f, ph, p };
}
function setClause(cols, src, start = 1) {
  const f = [],
    p = [];
  let i = start;
  for (const c of cols) {
    if (src[c] === undefined) continue;
    f.push(JSONB.has(c) ? `${c} = $${i}::jsonb` : `${c} = $${i}`);
    p.push(JSONB.has(c) ? JSON.stringify(src[c]) : src[c]);
    i++;
  }
  return { f, p, next: i };
}

// ── Contacts (global) ────────────────────────────────────
async function findAll({
  client,
  filters = {},
  page = 1,
  page_size = 25,
  offset = 0,
}) {
  const where = ["is_deleted = false"];
  const params = [];
  let i = 1;
  if (filters.priority_level) {
    where.push(`priority_level = $${i++}`);
    params.push(filters.priority_level);
  }
  if (filters.assigned_to) {
    where.push(`assigned_to = $${i++}`);
    params.push(filters.assigned_to);
  }
  if (filters.contact_type) {
    where.push(`$${i++} = ANY(contact_type)`);
    params.push(filters.contact_type);
  }
  if (filters.q) {
    where.push(
      `(display_name ILIKE $${i} OR primary_phone ILIKE $${i} OR email ILIKE $${i} OR company_name ILIKE $${i})`,
    );
    params.push(`%${filters.q}%`);
    i++;
  }
  const w = `WHERE ${where.join(" AND ")}`;
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM shared.contacts ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM shared.contacts ${w} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
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
async function findById({ client, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.contacts WHERE contact_id = $1 AND is_deleted = false`,
    [id],
  );
  return rows[0] || null;
}
async function create({ client, input, user_id }) {
  const { f, ph, p } = insert(C_COLS, input, { created_by: user_id });
  const { rows } = await ex(client)(
    `INSERT INTO shared.contacts (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function update({ client, id, patch }) {
  const { f, p, next } = setClause(C_COLS, patch);
  if (!f.length) return findById({ client, id });
  p.push(id);
  const { rows } = await ex(client)(
    `UPDATE shared.contacts SET ${f.join(",")} WHERE contact_id = $${next} AND is_deleted = false RETURNING *`,
    p,
  );
  return rows[0] || null;
}
async function softDelete({ client, id }) {
  const { rowCount } = await ex(client)(
    `UPDATE shared.contacts SET is_deleted = true, deleted_at = now() WHERE contact_id = $1 AND is_deleted = false`,
    [id],
  );
  return rowCount > 0;
}

// ── Segments (brand-scoped) ──────────────────────────────
function assertBrand(b) {
  if (!VALID.has(b)) throw new Error(`Invalid brand: ${b}`);
}
async function listSegments({ client, brand }) {
  assertBrand(brand);
  const { rows } = await ex(client)(
    `SELECT * FROM shared.contact_segments WHERE business = $1 ORDER BY name`,
    [brand],
  );
  return rows;
}
async function getSegment({ client, brand, id }) {
  assertBrand(brand);
  const { rows } = await ex(client)(
    `SELECT * FROM shared.contact_segments WHERE segment_id = $1 AND business = $2`,
    [id, brand],
  );
  return rows[0] || null;
}
async function createSegment({ client, brand, input, user_id }) {
  assertBrand(brand);
  const { f, ph, p } = insert(SEG_COLS, input, {
    business: brand,
    created_by: user_id,
  });
  const { rows } = await ex(client)(
    `INSERT INTO shared.contact_segments (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function updateSegment({ client, brand, id, patch }) {
  assertBrand(brand);
  const { f, p, next } = setClause(SEG_COLS, patch);
  if (!f.length) return getSegment({ client, brand, id });
  p.push(id, brand);
  const { rows } = await ex(client)(
    `UPDATE shared.contact_segments SET ${f.join(",")} WHERE segment_id = $${next} AND business = $${next + 1} RETURNING *`,
    p,
  );
  return rows[0] || null;
}
async function deleteSegment({ client, brand, id }) {
  assertBrand(brand);
  const { rowCount } = await ex(client)(
    `DELETE FROM shared.contact_segments WHERE segment_id = $1 AND business = $2`,
    [id, brand],
  );
  return rowCount > 0;
}

// ── Contact addresses (global, under a contact) ──────────
const ADDR_COLS = [
  "address_type",
  "line1",
  "line2",
  "area",
  "city",
  "state",
  "country",
  "country_code",
  "postal_code",
  "landmark",
  "recipient_name",
  "recipient_phone",
  "google_maps_url",
  "latitude",
  "longitude",
  "is_default",
  "is_verified",
];
async function listAddresses({ client, contact_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.contact_addresses WHERE contact_id = $1 ORDER BY is_default DESC, created_at`,
    [contact_id],
  );
  return rows;
}
async function getAddress({ client, contact_id, address_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.contact_addresses WHERE address_id = $1 AND contact_id = $2`,
    [address_id, contact_id],
  );
  return rows[0] || null;
}
async function clearDefaultAddresses({ client, contact_id, address_type }) {
  await ex(client)(
    `UPDATE shared.contact_addresses SET is_default = false WHERE contact_id = $1 AND address_type = $2 AND is_default = true`,
    [contact_id, address_type],
  );
}
async function addAddress({ client, contact_id, input, user_id }) {
  const { f, ph, p } = insert(ADDR_COLS, input, {
    contact_id,
    created_by: user_id,
  });
  const { rows } = await ex(client)(
    `INSERT INTO shared.contact_addresses (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function updateAddress({ client, contact_id, address_id, patch }) {
  const { f, p, next } = setClause(ADDR_COLS, patch);
  if (!f.length) return getAddress({ client, contact_id, address_id });
  p.push(address_id, contact_id);
  const { rows } = await ex(client)(
    `UPDATE shared.contact_addresses SET ${f.join(",")} WHERE address_id = $${next} AND contact_id = $${next + 1} RETURNING *`,
    p,
  );
  return rows[0] || null;
}
async function deleteAddress({ client, contact_id, address_id }) {
  const { rowCount } = await ex(client)(
    `DELETE FROM shared.contact_addresses WHERE address_id = $1 AND contact_id = $2`,
    [address_id, contact_id],
  );
  return rowCount > 0;
}

/**
 * Contacts whose birthday falls within the next `days` days (global). The
 * nested CASE picks this year's birthday if it's still ahead (incl. today),
 * else next year's — interval math is leap-safe (no make_date crash on Feb 29).
 */
async function upcomingMilestones({ days = 7, limit = 500 }) {
  const { rows } = await query(
    `SELECT contact_id, display_name, date_of_birth, primary_phone,
            whatsapp_number, email, next_birthday,
            (next_birthday - current_date) AS days_until
       FROM (
         SELECT contact_id, display_name, date_of_birth, primary_phone,
                whatsapp_number, email,
                CASE WHEN cand >= current_date THEN cand
                     ELSE (cand + interval '1 year')::date END AS next_birthday
           FROM (
             SELECT contact_id, display_name, date_of_birth, primary_phone,
                    whatsapp_number, email,
                    (date_of_birth
                      + (extract(year from age(date_of_birth))::int
                         * interval '1 year'))::date AS cand
               FROM shared.contacts
              WHERE date_of_birth IS NOT NULL AND is_deleted = false
           ) a
       ) m
      WHERE next_birthday <= current_date + ($1 * interval '1 day')
      ORDER BY next_birthday
      LIMIT $2`,
    [days, limit],
  );
  return rows.map((r) => ({ ...r, milestone_type: "birthday" }));
}

module.exports = {
  upcomingMilestones,
  findAll,
  findById,
  create,
  update,
  softDelete,
  listSegments,
  getSegment,
  createSegment,
  updateSegment,
  deleteSegment,
  listAddresses,
  getAddress,
  clearDefaultAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
};
