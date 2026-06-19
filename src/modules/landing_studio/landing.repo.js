/**
 * Landing Studio — repository (parameterised SQL only).
 *
 * Backs the brand-level "no active sale" landing page. One row per brand
 * in shared.landing_pages: a working `draft_config` (studio edits + preview)
 * and a `published_config` (what the public sales subdomain renders).
 */

"use strict";

const { query } = require("../../config/database");

/** Fetch the landing row for a brand. Returns null if not provisioned. */
async function findByBrand(brand) {
  const { rows } = await query(
    `SELECT landing_id, business_key, draft_config, published_config,
            is_published, published_at, updated_at
       FROM shared.landing_pages
      WHERE business_key = $1
      LIMIT 1`,
    [brand],
  );
  return rows[0] || null;
}

/** Fetch only the published config for a brand (public read path). */
async function findPublished(brand) {
  const { rows } = await query(
    `SELECT published_config, is_published, published_at
       FROM shared.landing_pages
      WHERE business_key = $1
      LIMIT 1`,
    [brand],
  );
  return rows[0] || null;
}

/**
 * Upsert the draft config for a brand. Creates the row on first save so a
 * brand that wasn't seeded (e.g. a newly bootstrapped business) still works.
 */
async function saveDraft({ brand, config, user_id }) {
  const { rows } = await query(
    `INSERT INTO shared.landing_pages (business_key, draft_config, updated_by, updated_at)
       VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (business_key) DO UPDATE
       SET draft_config = EXCLUDED.draft_config,
           updated_by   = EXCLUDED.updated_by,
           updated_at   = now()
     RETURNING landing_id, business_key, draft_config, published_config,
               is_published, published_at, updated_at`,
    [brand, JSON.stringify(config), user_id || null],
  );
  return rows[0];
}

/** Publish: copy the current draft into published_config + stamp it. */
async function publish({ brand, user_id }) {
  const { rows } = await query(
    `UPDATE shared.landing_pages
        SET published_config = draft_config,
            is_published     = true,
            published_at     = now(),
            published_by     = $2,
            updated_at       = now()
      WHERE business_key = $1
      RETURNING landing_id, business_key, draft_config, published_config,
                is_published, published_at, updated_at`,
    [brand, user_id || null],
  );
  return rows[0] || null;
}

module.exports = { findByBrand, findPublished, saveDraft, publish };
