/**
 * Contacts (V2.2 §6.12) — repository.
 * shared.contacts is GLOBAL (a customer may buy from both brands), so it is
 * NOT brand-prefixed. shared.contact_segments IS brand-scoped (business col).
 */

"use strict";

const { query, ex } = require("../../config/database");
const { VALID, t, assertBrand } = require("../../config/brands");
/**
 * Directory KPIs. total/vip/new are global (contacts are shared); at_risk is
 * per-brand — customers who have ordered from this brand but not in 90 days.
 */
async function stats({ brand }) {
  const { rows } = await query(
    `SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE priority_level = 'vip')::int AS vip,
        count(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS new_this_month
       FROM shared.contacts
      WHERE is_deleted = false`,
  );
  let at_risk = 0;
  if (brand && VALID.has(brand)) {
    const { rows: ar } = await query(
      `SELECT count(*)::int AS at_risk
         FROM shared.contacts c
        WHERE c.is_deleted = false
          AND 'customer' = ANY(c.contact_type)
          AND EXISTS (SELECT 1 FROM ${t(brand, "sales_orders")} o
                       WHERE o.contact_id = c.contact_id)
          AND NOT EXISTS (SELECT 1 FROM ${t(brand, "sales_orders")} o
                           WHERE o.contact_id = c.contact_id
                             AND o.created_at >= now() - interval '90 days')`,
    );
    at_risk = ar[0].at_risk;
  }
  return { ...rows[0], at_risk };
}

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

// ── Bulk import / export (global) ────────────────────────
/** First non-deleted contact with this exact phone — the import de-dupe key. */
async function findByPhone({ client, phone }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.contacts
      WHERE primary_phone = $1 AND is_deleted = false
      ORDER BY created_at LIMIT 1`,
    [phone],
  );
  return rows[0] || null;
}

/**
 * First non-deleted contact matching phone OR email — the de-dupe key now that
 * a contact may carry only one of the two. Returns null when neither is given.
 */
async function findByPhoneOrEmail({ client, phone, email }) {
  if (!phone && !email) return null;
  const { rows } = await ex(client)(
    `SELECT * FROM shared.contacts
      WHERE is_deleted = false
        AND ( ($1::text   IS NOT NULL AND primary_phone = $1)
           OR ($2::citext IS NOT NULL AND email = $2) )
      ORDER BY created_at LIMIT 1`,
    [phone || null, email || null],
  );
  return rows[0] || null;
}

/** Union extra types into a contact's contact_type[] (idempotent, de-duped). */
async function addContactTypes({ client, id, types }) {
  const { rowCount } = await ex(client)(
    `UPDATE shared.contacts
        SET contact_type = ARRAY(
              SELECT DISTINCT e FROM unnest(contact_type || $2::text[]) AS e
            )
      WHERE contact_id = $1 AND is_deleted = false`,
    [id, types],
  );
  return rowCount > 0;
}

/**
 * Rows for a bulk export: contacts of an optional `type` ('customer' |
 * 'supplier'; null = both) created within [from, to] (inclusive day bounds),
 * each with their default delivery address flattened in.
 */
async function exportRows({ type, from, to, limit = 50000 }) {
  const where = ["c.is_deleted = false"];
  const params = [];
  let i = 1;
  if (type) {
    where.push(`$${i++} = ANY(c.contact_type)`);
    params.push(type);
  } else {
    where.push(`(c.contact_type && ARRAY['customer','supplier']::text[])`);
  }
  if (from) {
    where.push(`c.created_at >= $${i++}::date`);
    params.push(from);
  }
  if (to) {
    where.push(`c.created_at < ($${i++}::date + INTERVAL '1 day')`);
    params.push(to);
  }
  params.push(limit);
  const { rows } = await query(
    `SELECT c.contact_id, c.contact_type, c.display_name, c.first_name,
            c.last_name, c.company_name, c.gender, c.date_of_birth, c.tin,
            c.cac_number, c.primary_phone, c.whatsapp_number, c.email,
            c.country_code, c.instagram_handle, c.tiktok_handle,
            c.facebook_handle, c.priority_level, c.source, c.notes,
            c.created_at,
            a.line1, a.area, a.city, a.state, a.country
       FROM shared.contacts c
       LEFT JOIN LATERAL (
         SELECT line1, area, city, state, country
           FROM shared.contact_addresses
          WHERE contact_id = c.contact_id
          ORDER BY is_default DESC, created_at
          LIMIT 1
       ) a ON true
      WHERE ${where.join(" AND ")}
      ORDER BY c.created_at DESC
      LIMIT $${i}`,
    params,
  );
  return rows;
}

// ── Segments (brand-scoped) ──────────────────────────────
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

// ── Contact tags (brand-scoped) ──────────────────────────
async function listTags({ client, brand, contact_id }) {
  const { rows } = await ex(client)(
    `SELECT tag_id, tag_name, colour, created_at
       FROM shared.contact_tags
      WHERE contact_id = $1 AND business = $2
      ORDER BY tag_name`,
    [contact_id, brand],
  );
  return rows;
}
async function addTag({
  client,
  brand,
  contact_id,
  tag_name,
  colour,
  user_id,
}) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.contact_tags
       (contact_id, tag_name, business, colour, created_by)
     VALUES ($1, $2, $3, COALESCE($4, '#64748B'), $5)
     ON CONFLICT (contact_id, tag_name, business) DO UPDATE
       SET colour = COALESCE(EXCLUDED.colour, shared.contact_tags.colour)
     RETURNING tag_id, tag_name, colour, created_at`,
    [contact_id, tag_name, brand, colour || null, user_id || null],
  );
  return rows[0];
}
async function removeTag({ client, brand, contact_id, tag_id }) {
  const { rowCount } = await ex(client)(
    `DELETE FROM shared.contact_tags
      WHERE tag_id = $1 AND contact_id = $2 AND business = $3`,
    [tag_id, contact_id, brand],
  );
  return rowCount > 0;
}

module.exports = {
  stats,
  listTags,
  addTag,
  removeTag,
  upcomingMilestones,
  findAll,
  findById,
  create,
  update,
  softDelete,
  findByPhone,
  findByPhoneOrEmail,
  addContactTypes,
  exportRows,
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
