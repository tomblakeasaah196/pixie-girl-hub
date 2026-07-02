/**
 * Sales Campaigns & Landing Pages (V2.2 §6.22)
 * Repository — parameterised SQL only. No business logic, no HTTP.
 *
 * Entity isolation: every function takes `brand`; table names are built
 * from a validated whitelist (pixiegirl.* | faitlynhair.*). Never
 * string-interpolate user input into SQL — only the validated brand.
 *
 * Backing tables (all per-brand):
 *   sales_campaigns, sales_campaign_products,
 *   sales_campaign_signups, sales_campaign_metrics
 */

"use strict";

const { ex: exec } = require("../../config/database");
const { t } = require("../../config/brands");
const VALID_STATUSES = new Set([
  "draft",
  "pending_approval",
  "scheduled",
  "live",
  "paused",
  "ended",
  "archived",
]);

// Columns a client may set on create, and how to bind them.
const CREATE_COLS = [
  "slug",
  "name",
  "description",
  "starts_at",
  "ends_at",
  "discount_type",
  "discount_value",
  "min_order_value_ngn",
  "customer_segment_id",
  "first_time_buyers_only",
  "product_scope",
  "landing_hero_title",
  "landing_hero_subtitle",
  "landing_hero_image_url",
  "landing_cta_text",
  "landing_blocks",
  "countdown_message",
  "signup_for_notifications",
  "ended_message",
  "ended_redirect_to",
  "meta_title",
  "meta_description",
  "og_image_url",
  "total_usage_limit",
  // ── Sales Campaigns v2 (migration 000040) — were silently dropped on save ──
  "voice_profile_override",
  "show_viewer_count_policy",
  "viewer_count_floor",
  "vip_early_access_minutes",
  "last_call_surge_minutes",
  "vip_top_n",
  "vip_lifetime_threshold_ngn",
  "next_campaign_slug",
  "exit_intent_enabled",
  "exit_intent_code",
  "exit_intent_discount_ngn",
  "exit_intent_title",
  "exit_intent_body",
  "exit_intent_button",
  "abandonment_recovery_enabled",
  "allow_multi_currency_display",
  // ── Sales Campaigns v3 (migration 000048) — deals engine ──
  // These were validated and read by the landing payload but never appeared in
  // the writable allow-list, so saves silently dropped delivery timeline + the
  // position/stacking/bulk deal configs (the same bug the v2 block above fixed).
  "delivery_weeks",
  "preorder_extra_weeks",
  "position_ladder",
  "stacking_bonus",
  "bulk_tiers",
  // ── Static FX rate for the landing currency toggle (migration 000051) ──
  // "1 USD = N NGN" the landing page uses when the visitor flips the toggle.
  // NOT used to settle orders — those use the LIVE rate captured into
  // sales_orders.fx_rate_used at payment time.
  "ngn_per_usd_rate",
  // ── Campaign landing extras (migration 000057) ──
  // Freeform JSONB bag for campaign landing fields that don't warrant a
  // dedicated column: live_now_pill, browse_cta_text, hero_overlay_opacity,
  // watermark_opacity, countdown_closes_label, favicon_url, browser_tab_name.
  "landing_extras",
  // ── Per-campaign payment gateways (migration 000058) ──
  // TEXT[] of enabled gateways for this sale's checkout. node-pg binds a JS
  // array straight to the Postgres array column — no JSONB cast.
  "allowed_payment_gateways",
];
const UPDATE_COLS = CREATE_COLS; // same set is editable (status excluded by design)
const JSONB_COLS = new Set([
  "landing_blocks",
  "voice_profile_override",
  // v3 deal configs are JSONB columns — stringify + ::jsonb cast on write.
  "position_ladder",
  "stacking_bonus",
  "bulk_tiers",
  "landing_extras",
]);

function bindValue(col, val) {
  if (JSONB_COLS.has(col)) {
    // landing_blocks is an array (default []); voice_profile_override is an
    // object or NULL — don't coerce a missing object into an empty array.
    if (val === undefined || val === null) {
      return col === "landing_blocks" ? "[]" : null;
    }
    return JSON.stringify(val);
  }
  return val;
}

// ── Campaigns ────────────────────────────────────────────

async function findAll({
  client,
  brand,
  scope,
  user_id,
  filters = {},
  page = 1,
  page_size = 25,
  offset = 0,
}) {
  const where = [];
  const params = [];
  let i = 1;

  if (filters.status) {
    const requested = Array.isArray(filters.status)
      ? filters.status
      : String(filters.status).split(",");
    // Drop unknown values rather than passing them to Postgres (which would
    // 500 on a check-constraint mismatch and leak the SQL error shape).
    const statuses = requested
      .map((s) => String(s).trim())
      .filter((s) => VALID_STATUSES.has(s));
    if (statuses.length === 0) {
      // Caller asked for status=garbage — return an empty result deterministically.
      return {
        data: [],
        meta: { page, page_size, total: 0, has_more: false },
      };
    }
    where.push(`status = ANY($${i++}::text[])`);
    params.push(statuses);
  } else {
    where.push(`status <> 'archived'`);
  }

  if (filters.q) {
    where.push(`(name ILIKE $${i} OR slug ILIKE $${i})`);
    params.push(`%${filters.q}%`);
    i++;
  }

  if (filters.active_on) {
    where.push(`starts_at <= $${i} AND ends_at >= $${i}`);
    params.push(filters.active_on);
    i++;
  }

  // Record-level scope (5-layer RBAC, CLAUDE.md §RBAC):
  //   all  → no filter
  //   team → no team_id on this table yet, so collapse to `own` (caller's records)
  //          rather than leaking everyone's. Revisit when a team mapping lands.
  //   own  → only campaigns the caller created.
  // Anything else (a typo, a custom role with an unknown scope) is also
  // narrowed to `own` so a misconfigured role can't accidentally widen reads.
  if (scope && scope !== "all" && user_id) {
    where.push(`created_by = $${i++}`);
    params.push(user_id);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = exec(client);

  const { rows: countRows } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "sales_campaigns")} ${whereSql}`,
    params,
  );
  const total = countRows[0].total;

  const { rows } = await run(
    `SELECT * FROM ${t(brand, "sales_campaigns")} ${whereSql}
      ORDER BY created_at DESC
      LIMIT $${i++} OFFSET $${i++}`,
    [...params, page_size, offset],
  );

  return {
    data: rows,
    meta: { page, page_size, total, has_more: offset + rows.length < total },
  };
}

async function findById({ client, brand, id }) {
  const { rows } = await exec(client)(
    `SELECT * FROM ${t(brand, "sales_campaigns")} WHERE campaign_id = $1 LIMIT 1`,
    [id],
  );
  return rows[0] || null;
}

async function findBySlug({ client, brand, slug }) {
  const { rows } = await exec(client)(
    `SELECT * FROM ${t(brand, "sales_campaigns")} WHERE slug = $1 LIMIT 1`,
    [slug],
  );
  return rows[0] || null;
}

async function create({ client, brand, input, user_id }) {
  const cols = [];
  const placeholders = [];
  const params = [];
  let i = 1;

  for (const col of CREATE_COLS) {
    if (input[col] === undefined) continue;
    cols.push(col);
    placeholders.push(JSONB_COLS.has(col) ? `$${i}::jsonb` : `$${i}`);
    params.push(bindValue(col, input[col]));
    i++;
  }
  cols.push("created_by");
  placeholders.push(`$${i++}`);
  params.push(user_id);

  const { rows } = await exec(client)(
    `INSERT INTO ${t(brand, "sales_campaigns")} (${cols.join(", ")})
     VALUES (${placeholders.join(", ")})
     RETURNING *`,
    params,
  );
  return rows[0];
}

async function update({ client, brand, id, patch }) {
  const sets = [];
  const params = [];
  let i = 1;
  for (const col of UPDATE_COLS) {
    if (patch[col] === undefined) continue;
    sets.push(JSONB_COLS.has(col) ? `${col} = $${i}::jsonb` : `${col} = $${i}`);
    params.push(bindValue(col, patch[col]));
    i++;
  }
  if (sets.length === 0) return findById({ client, brand, id });
  params.push(id);
  const { rows } = await exec(client)(
    `UPDATE ${t(brand, "sales_campaigns")} SET ${sets.join(", ")}
      WHERE campaign_id = $${i}
      RETURNING *`,
    params,
  );
  return rows[0] || null;
}

/**
 * Transition status. `extra` may carry approved_by (sets approved_at=now).
 */
async function setStatus({ client, brand, id, status, approved_by }) {
  const sets = ["status = $1"];
  const params = [status];
  let i = 2;
  if (approved_by) {
    sets.push(`approved_by = $${i++}`, `approved_at = now()`);
    params.push(approved_by);
  }
  params.push(id);
  const { rows } = await exec(client)(
    `UPDATE ${t(brand, "sales_campaigns")} SET ${sets.join(", ")}
      WHERE campaign_id = $${i}
      RETURNING *`,
    params,
  );
  return rows[0] || null;
}

/** Atomically bump denormalised counters (e.g. { total_signups: 1 }). */
async function incrementCounters({ client, brand, id, deltas }) {
  const sets = [];
  const params = [];
  let i = 1;
  for (const [col, delta] of Object.entries(deltas)) {
    sets.push(`${col} = ${col} + $${i++}`);
    params.push(delta);
  }
  if (!sets.length) return;
  params.push(id);
  await exec(client)(
    `UPDATE ${t(brand, "sales_campaigns")} SET ${sets.join(", ")} WHERE campaign_id = $${i}`,
    params,
  );
}

// ── Campaign products (include / exclude) ────────────────

async function listProducts({ client, brand, campaign_id }) {
  // scp.* carries the snapshot columns (image_url, regular_price_ngn/usd,
  // campaign_price_usd, short/long_description). The styled aliases below are
  // live fallbacks for rows added before the snapshot existed — resolved with
  // COALESCE by the caller (buildLandingPayload), never colliding with scp.*.
  //
  // live_base_stock is computed live from stock_levels rather than from the
  // per-row current_stock_snapshot. Multiple styled products sharing the same
  // base product must read from the same pool — independent snapshots would
  // allow each styled variant to show the full base stock independently,
  // enabling overselling. The lateral join sums available qty across all
  // storefront-available locations for the base product's variants, respecting
  // any base_variant_id pin on the styled product.
  const { rows } = await exec(client)(
    `SELECT scp.*,
            p.name  AS product_name,
            pc.name AS category_name,
            sp.name AS styled_name,
            sp.slug AS styled_slug,
            sp.short_description AS styled_short_description,
            sp.long_description  AS styled_long_description,
            sp.retail_price_ngn  AS styled_retail_price_ngn,
            sp.retail_price_usd  AS styled_retail_price_usd,
            COALESCE(spi.image_url, scp.image_url) AS resolved_image_url,
            bstk.live_base_stock
       FROM ${t(brand, "sales_campaign_products")} scp
       LEFT JOIN ${t(brand, "products")} p          ON p.product_id   = scp.product_id
       LEFT JOIN ${t(brand, "product_categories")} pc ON pc.category_id = scp.category_id
       LEFT JOIN ${t(brand, "styled_products")} sp  ON sp.styled_id   = scp.styled_id
       LEFT JOIN LATERAL (
         -- Resolve the card image the way the catalogue does, STYLED-ONLY:
         -- explicit primary_image_id → the default colour's first picture →
         -- any styled picture. A base-product image is NEVER resolved here —
         -- the landing page must only ever show the styled product's own
         -- photography. If a styled product has no images of its own the card
         -- image resolves to NULL (a visible gap) so the catalogue gets fixed
         -- rather than the page papering over it with a factory shot.
         SELECT COALESCE(
           (SELECT COALESCE(pi.cdn_url, pi.file_path)
              FROM ${t(brand, "product_images")} pi
             WHERE pi.image_id = sp.primary_image_id),
           (SELECT COALESCE(pi.cdn_url, pi.file_path)
              FROM ${t(brand, "product_images")} pi
              JOIN ${t(brand, "styled_product_colours")} col
                ON col.colour_id = pi.styled_colour_id
             WHERE col.styled_id = sp.styled_id
             ORDER BY col.is_default DESC,
                      col.display_order ASC,
                      pi.display_order ASC NULLS LAST
             LIMIT 1),
           (SELECT COALESCE(pi.cdn_url, pi.file_path)
              FROM ${t(brand, "product_images")} pi
             WHERE pi.styled_id = sp.styled_id
             ORDER BY pi.is_primary DESC,
                      pi.display_order ASC NULLS LAST
             LIMIT 1)
         ) AS image_url
       ) spi ON true
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(sl.available), 0)::INTEGER AS live_base_stock
           FROM ${t(brand, "product_variants")} pv
           JOIN ${t(brand, "stock_levels")} sl      ON sl.variant_id   = pv.variant_id
           JOIN ${t(brand, "stock_locations")} loc  ON loc.location_id = sl.location_id
          WHERE pv.product_id = COALESCE(sp.base_product_id, scp.product_id)
            AND (sp.base_variant_id IS NULL OR pv.variant_id = sp.base_variant_id)
            AND loc.available_for_storefront = true
            AND pv.is_active = true
       ) bstk ON true
      WHERE scp.campaign_id = $1
      ORDER BY scp.display_order ASC, scp.is_featured DESC`,
    [campaign_id],
  );
  return rows;
}

async function addProduct({ client, brand, campaign_id, input }) {
  const { rows } = await exec(client)(
    `INSERT INTO ${t(brand, "sales_campaign_products")}
       (campaign_id, product_id, category_id, styled_id, include_exclude,
        campaign_price_ngn, campaign_price_usd, image_url,
        regular_price_ngn, regular_price_usd, short_description, long_description,
        display_order, is_featured)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
             COALESCE($13,0), COALESCE($14,false))
     RETURNING *`,
    [
      campaign_id,
      input.product_id || null,
      input.category_id || null,
      input.styled_id || null,
      input.include_exclude,
      input.campaign_price_ngn ?? null,
      input.campaign_price_usd ?? null,
      input.image_url || null,
      input.regular_price_ngn ?? null,
      input.regular_price_usd ?? null,
      input.short_description ?? null,
      input.long_description ?? null,
      input.display_order ?? null,
      input.is_featured ?? null,
    ],
  );
  return rows[0];
}

async function findProductLink({ client, brand, campaign_id, link_id }) {
  const { rows } = await exec(client)(
    `SELECT * FROM ${t(brand, "sales_campaign_products")}
      WHERE link_id = $1 AND campaign_id = $2 LIMIT 1`,
    [link_id, campaign_id],
  );
  return rows[0] || null;
}

async function updateProduct({ client, brand, campaign_id, link_id, patch }) {
  const allowed = [
    "campaign_price_ngn",
    "campaign_price_usd",
    "display_order",
    "is_featured",
    "include_exclude",
    "styled_id",
    "image_url",
    "regular_price_ngn",
    "regular_price_usd",
    "short_description",
    "long_description",
  ];
  const sets = [];
  const params = [];
  let i = 1;
  for (const col of allowed) {
    if (patch[col] === undefined) continue;
    sets.push(`${col} = $${i++}`);
    params.push(patch[col]);
  }
  if (!sets.length)
    return findProductLink({ client, brand, campaign_id, link_id });
  params.push(link_id, campaign_id);
  const { rows } = await exec(client)(
    `UPDATE ${t(brand, "sales_campaign_products")} SET ${sets.join(", ")}
      WHERE link_id = $${i++} AND campaign_id = $${i}
      RETURNING *`,
    params,
  );
  return rows[0] || null;
}

/**
 * Insert multiple product links in a single transaction pass.
 * Silently skips rows that violate a unique constraint (ON CONFLICT DO NOTHING).
 */
async function addProductsBatch({ client, brand, campaign_id, items }) {
  if (!items.length) return [];
  const results = [];
  for (const input of items) {
    const { rows } = await exec(client)(
      `INSERT INTO ${t(brand, "sales_campaign_products")}
         (campaign_id, product_id, category_id, styled_id, include_exclude,
          campaign_price_ngn, campaign_price_usd, image_url,
          regular_price_ngn, regular_price_usd, short_description, long_description,
          display_order, is_featured)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               COALESCE($13,0), COALESCE($14,false))
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        campaign_id,
        input.product_id || null,
        input.category_id || null,
        input.styled_id || null,
        input.include_exclude || "include",
        input.campaign_price_ngn ?? null,
        input.campaign_price_usd ?? null,
        input.image_url || null,
        input.regular_price_ngn ?? null,
        input.regular_price_usd ?? null,
        input.short_description ?? null,
        input.long_description ?? null,
        input.display_order ?? null,
        input.is_featured ?? null,
      ],
    );
    if (rows[0]) results.push(rows[0]);
  }
  return results;
}

async function removeProduct({ client, brand, campaign_id, link_id }) {
  const { rowCount } = await exec(client)(
    `DELETE FROM ${t(brand, "sales_campaign_products")}
      WHERE link_id = $1 AND campaign_id = $2`,
    [link_id, campaign_id],
  );
  return rowCount > 0;
}

// ── Signups (pre-launch notification list) ───────────────

async function findSignup({ client, brand, campaign_id, email, phone }) {
  const { rows } = await exec(client)(
    `SELECT * FROM ${t(brand, "sales_campaign_signups")}
      WHERE campaign_id = $1
        AND ( ($2::citext IS NOT NULL AND email = $2)
           OR ($3::text  IS NOT NULL AND phone = $3) )
      LIMIT 1`,
    [campaign_id, email || null, phone || null],
  );
  return rows[0] || null;
}

async function createSignup({
  client,
  brand,
  campaign_id,
  input,
  contact_id,
  ip,
  user_agent,
}) {
  const { rows } = await exec(client)(
    `INSERT INTO ${t(brand, "sales_campaign_signups")}
       (campaign_id, contact_id, email, phone, notify_via, source, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      campaign_id,
      contact_id || null,
      input.email || null,
      input.phone || null,
      input.notify_via || "email",
      input.source || null,
      ip || null,
      user_agent || null,
    ],
  );
  return rows[0];
}

async function listSignups({
  client,
  brand,
  campaign_id,
  page = 1,
  page_size = 25,
  offset = 0,
}) {
  const run = exec(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "sales_campaign_signups")} WHERE campaign_id = $1`,
    [campaign_id],
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "sales_campaign_signups")}
      WHERE campaign_id = $1
      ORDER BY signed_up_at DESC
      LIMIT $2 OFFSET $3`,
    [campaign_id, page_size, offset],
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

async function listPendingSignups({ client, brand, campaign_id }) {
  const { rows } = await exec(client)(
    `SELECT * FROM ${t(brand, "sales_campaign_signups")}
      WHERE campaign_id = $1 AND notified_at IS NULL`,
    [campaign_id],
  );
  return rows;
}

async function markSignupNotified({ client, brand, signup_id }) {
  await exec(client)(
    `UPDATE ${t(brand, "sales_campaign_signups")}
        SET notified_at = now() WHERE signup_id = $1`,
    [signup_id],
  );
}

// ── Metrics (rollups live on the campaign row; daily series here) ──

async function listDailyMetrics({ client, brand, campaign_id, from, to }) {
  const params = [campaign_id];
  let where = `WHERE campaign_id = $1`;
  let i = 2;
  if (from) {
    where += ` AND metric_date >= $${i++}`;
    params.push(from);
  }
  if (to) {
    where += ` AND metric_date <= $${i++}`;
    params.push(to);
  }
  const { rows } = await exec(client)(
    `SELECT * FROM ${t(brand, "sales_campaign_metrics")} ${where}
      ORDER BY metric_date ASC, metric_hour ASC NULLS LAST`,
    params,
  );
  return rows;
}

module.exports = {
  // campaigns
  findAll,
  findById,
  findBySlug,
  create,
  update,
  setStatus,
  incrementCounters,
  // products
  listProducts,
  addProduct,
  addProductsBatch,
  findProductLink,
  updateProduct,
  removeProduct,
  // signups
  findSignup,
  createSignup,
  listSignups,
  listPendingSignups,
  markSignupNotified,
  // metrics
  listDailyMetrics,
};
