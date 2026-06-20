/**
 * Service Catalogue — parameterised SQL. Services live in
 * shared.service_offerings, scoped by `business`. This layer also serves the
 * public storefront (visible/bookable services) and captures booking requests.
 */

"use strict";

const { query } = require("../../config/database");

// Columns an admin may write on create/update (slug/business/id excluded).
const SERVICE_COLS = [
  "name",
  "slug",
  "description",
  "short_description",
  "long_description",
  "base_price_ngn",
  "compare_at_price_ngn",
  "price_is_from",
  "duration_minutes",
  "category",
  "tags",
  "image_url",
  "thumbnail_url",
  "is_active",
  "is_visible_storefront",
  "is_featured",
  "sort_order",
  "required_stylist_tier",
  "sale_mode",
  "deposit_required",
  "deposit_pct",
  "buffer_minutes",
  "location_type",
  "cancellation_policy",
  "meta_title",
  "meta_description",
  "whats_included",
  "faqs",
  "aftercare_notes",
];

// JSONB columns need an explicit cast when bound as text.
const JSONB_COLS = new Set(["whats_included", "faqs"]);

async function listServices({ brand, category, active_only = true }) {
  const where = ["business = $1"];
  const params = [brand];
  let i = 2;
  if (active_only) where.push(`is_active = true`);
  if (category) {
    where.push(`category = $${i++}`);
    params.push(category);
  }
  const { rows } = await query(
    `SELECT * FROM shared.service_offerings
      WHERE ${where.join(" AND ")}
      ORDER BY sort_order ASC, name ASC`,
    params,
  );
  return rows;
}

async function getService({ brand, id }) {
  const { rows } = await query(
    `SELECT * FROM shared.service_offerings
      WHERE service_id = $1 AND business = $2`,
    [id, brand],
  );
  return rows[0] || null;
}

async function findServiceByName({ brand, name }) {
  const { rows } = await query(
    `SELECT * FROM shared.service_offerings
      WHERE business = $1 AND lower(name) = lower($2)
      ORDER BY created_at LIMIT 1`,
    [brand, name],
  );
  return rows[0] || null;
}

function buildBinding(cols, input, startIndex = 1) {
  const f = [];
  const ph = [];
  const params = [];
  let i = startIndex;
  for (const c of cols) {
    if (input[c] === undefined) continue;
    f.push(c);
    ph.push(JSONB_COLS.has(c) ? `$${i}::jsonb` : `$${i}`);
    params.push(JSONB_COLS.has(c) ? JSON.stringify(input[c]) : input[c]);
    i++;
  }
  return { f, ph, params };
}

async function createService({ brand, user_id, input }) {
  const { f, ph, params } = buildBinding(SERVICE_COLS, input, 3);
  const { rows } = await query(
    `INSERT INTO shared.service_offerings (business, created_by${f.length ? ", " + f.join(", ") : ""})
     VALUES ($1, $2${ph.length ? ", " + ph.join(", ") : ""})
     RETURNING *`,
    [brand, user_id || null, ...params],
  );
  return rows[0];
}

async function updateService({ brand, id, input }) {
  const sets = [];
  const params = [id, brand];
  let i = 3;
  for (const c of SERVICE_COLS) {
    if (input[c] === undefined) continue;
    sets.push(`${c} = ${JSONB_COLS.has(c) ? `$${i}::jsonb` : `$${i}`}`);
    params.push(JSONB_COLS.has(c) ? JSON.stringify(input[c]) : input[c]);
    i++;
  }
  if (sets.length === 0) return getService({ brand, id });
  const { rows } = await query(
    `UPDATE shared.service_offerings SET ${sets.join(", ")}, updated_at = now()
      WHERE service_id = $1 AND business = $2 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function deleteService({ brand, id }) {
  // Soft delete via is_active=false to keep historical references.
  const { rows } = await query(
    `UPDATE shared.service_offerings
        SET is_active = false
      WHERE service_id = $1 AND business = $2 RETURNING service_id`,
    [id, brand],
  );
  return rows[0] || null;
}

// ── Storefront (public) ──────────────────────────────────
async function listStorefrontServices({ brand }) {
  const { rows } = await query(
    `SELECT service_id, name, slug, short_description, base_price_ngn,
            compare_at_price_ngn, price_is_from, duration_minutes, tags,
            image_url, thumbnail_url, is_featured, sale_mode, location_type,
            deposit_required, deposit_pct
       FROM shared.service_offerings
      WHERE business = $1 AND is_visible_storefront = true AND is_active = true
      ORDER BY is_featured DESC, sort_order ASC, name ASC`,
    [brand],
  );
  return rows;
}

async function getStorefrontServiceBySlug({ brand, slug }) {
  const { rows } = await query(
    `SELECT service_id, name, slug, short_description, long_description,
            base_price_ngn, compare_at_price_ngn, price_is_from,
            duration_minutes, tags, image_url, thumbnail_url, is_featured,
            sale_mode, location_type, deposit_required, deposit_pct,
            buffer_minutes, cancellation_policy, whats_included, faqs,
            aftercare_notes, meta_title, meta_description, required_stylist_tier
       FROM shared.service_offerings
      WHERE business = $1 AND slug = $2
        AND is_visible_storefront = true AND is_active = true`,
    [brand, slug],
  );
  return rows[0] || null;
}

async function createBookingRequest({ brand, service_id, contact_id, input }) {
  const { rows } = await query(
    `INSERT INTO shared.service_booking_requests
       (business, service_id, contact_id, full_name, phone, email,
        preferred_date, preferred_time, notes, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,'storefront'))
     RETURNING request_id, status, created_at`,
    [
      brand,
      service_id,
      contact_id || null,
      input.full_name,
      input.phone || null,
      input.email || null,
      input.preferred_date || null,
      input.preferred_time || null,
      input.notes || null,
      input.source || null,
    ],
  );
  return rows[0];
}

module.exports = {
  SERVICE_COLS,
  listServices,
  getService,
  findServiceByName,
  createService,
  updateService,
  deleteService,
  listStorefrontServices,
  getStorefrontServiceBySlug,
  createBookingRequest,
};
