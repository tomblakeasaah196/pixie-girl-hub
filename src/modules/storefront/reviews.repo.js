/**
 * Storefront product reviews repository (shared.product_reviews).
 *
 * Reviews are stored in the shared schema, scoped by `business` + `product_id`
 * (a soft FK to the storefront product identity, i.e. the styled product id).
 * The public storefront only ever reads APPROVED, non-deleted reviews; writes
 * land as `pending_moderation` for the ERP moderation queue.
 */

"use strict";

const { query } = require("../../config/database");

/** Approved reviews for a product, newest first, with a privacy-safe author. */
async function listApproved({ brand, product_id, limit = 50 }) {
  const { rows } = await query(
    `SELECT r.review_id, r.rating, r.title, r.body, r.photo_urls,
            r.is_verified_purchase, r.helpful_count, r.created_at,
            c.first_name,
            NULLIF(left(COALESCE(c.last_name, ''), 1), '') AS last_initial
       FROM shared.product_reviews r
       LEFT JOIN shared.contacts c ON c.contact_id = r.contact_id
      WHERE r.business = $1 AND r.product_id = $2
        AND r.status = 'approved' AND r.is_deleted = false
      ORDER BY r.created_at DESC
      LIMIT $3`,
    [brand, product_id, limit],
  );
  return rows.map((r) => ({
    review_id: r.review_id,
    rating: Number(r.rating),
    title: r.title,
    body: r.body,
    photo_urls: r.photo_urls || [],
    is_verified_purchase: r.is_verified_purchase,
    helpful_count: Number(r.helpful_count) || 0,
    created_at: r.created_at,
    author: [r.first_name, r.last_initial ? `${r.last_initial}.` : null]
      .filter(Boolean)
      .join(" ") || "Verified customer",
  }));
}

/** Aggregate rating summary (count + average) for the product header. */
async function summary({ brand, product_id }) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS count, COALESCE(AVG(rating), 0)::numeric(3,2) AS average
       FROM shared.product_reviews
      WHERE business = $1 AND product_id = $2
        AND status = 'approved' AND is_deleted = false`,
    [brand, product_id],
  );
  return { count: rows[0] ? rows[0].count : 0, average: Number(rows[0]?.average) || 0 };
}

async function create({
  brand,
  product_id,
  contact_id,
  rating,
  title,
  body,
  photo_urls,
  submitter_ip,
}) {
  const { rows } = await query(
    `INSERT INTO shared.product_reviews
       (business, product_id, contact_id, rating, title, body, photo_urls,
        status, submitter_ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_moderation', $8)
     RETURNING review_id, status`,
    [
      brand,
      product_id,
      contact_id,
      rating,
      title || null,
      body || null,
      Array.isArray(photo_urls) ? photo_urls.slice(0, 6) : [],
      submitter_ip || null,
    ],
  );
  return rows[0];
}

module.exports = { listApproved, summary, create };
