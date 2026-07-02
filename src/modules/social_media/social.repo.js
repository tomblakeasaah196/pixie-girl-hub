/**
 * Social Media Management (V2.2 §6.14) — repository.
 * SHARED tables (business-scoped): social_accounts, social_posts,
 * social_post_metrics. Parameterised SQL only.
 */

"use strict";

const { query, ex } = require("../../config/database");
// ── Accounts ───────────────────────────────────────────────
async function createAccount({ brand, account }) {
  const { rows } = await query(
    `INSERT INTO shared.social_accounts
       (business, platform, handle, external_account_id, scopes)
     VALUES ($1,$2,$3,$4,COALESCE($5,'{}')) RETURNING *`,
    [
      brand,
      account.platform,
      account.handle,
      account.external_account_id,
      account.scopes,
    ],
  );
  return rows[0];
}
async function listAccounts({ brand }) {
  const { rows } = await query(
    `SELECT account_id, business, platform, handle, external_account_id, scopes,
            is_active, connected_at
       FROM shared.social_accounts WHERE business = $1 ORDER BY platform, handle`,
    [brand],
  );
  return rows;
}
async function deactivateAccount({ brand, id }) {
  const { rows } = await query(
    `UPDATE shared.social_accounts SET is_active = false
      WHERE account_id = $1 AND business = $2 RETURNING account_id`,
    [id, brand],
  );
  return rows[0] || null;
}

// ── Posts ──────────────────────────────────────────────────
async function createPost({ brand, post }) {
  const { rows } = await query(
    `INSERT INTO shared.social_posts
       (business, account_id, platform, post_type, caption, hashtags,
        media_urls, tagged_product_ids, status, scheduled_for)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,'{}'),COALESCE($7,'{}'),
             COALESCE($8,'{}'),COALESCE($9,'draft'),$10) RETURNING *`,
    [
      brand,
      post.account_id,
      post.platform,
      post.post_type,
      post.caption || null,
      post.hashtags,
      post.media_urls,
      post.tagged_product_ids,
      post.status,
      post.scheduled_for || null,
    ],
  );
  return rows[0];
}
async function getPost({ brand, id }) {
  const { rows } = await query(
    `SELECT * FROM shared.social_posts WHERE post_id = $1 AND business = $2`,
    [id, brand],
  );
  return rows[0] || null;
}
async function listPosts({ brand, status, page = 1, page_size = 25 }) {
  const where = ["business = $1"];
  const params = [brand];
  let i = 2;
  if (status) {
    where.push(`status = $${i++}`);
    params.push(status);
  }
  const w = `WHERE ${where.join(" AND ")}`;
  const { rows: c } = await query(
    `SELECT count(*)::int AS total FROM shared.social_posts ${w}`,
    params,
  );
  const offset = (page - 1) * page_size;
  const { rows } = await query(
    `SELECT * FROM shared.social_posts ${w}
      ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i}`,
    [...params, page_size, offset],
  );
  return { data: rows, page, page_size, total: c[0].total };
}
async function setPostStatus({ brand, id, status, fields = {} }) {
  const set = ["status = $3"];
  const params = [id, brand, status];
  let i = 4;
  for (const [col, val] of Object.entries(fields)) {
    set.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await query(
    `UPDATE shared.social_posts SET ${set.join(", ")}, updated_at = now()
      WHERE post_id = $1 AND business = $2 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── Metrics ────────────────────────────────────────────────
async function upsertMetrics({ brand, post_id, metric_date, m }) {
  const { rows } = await query(
    `INSERT INTO shared.social_post_metrics
       (post_id, metric_date, impressions, reach, likes, comments, shares, saves,
        video_views, link_clicks)
     VALUES ($1,$2,COALESCE($3,0),COALESCE($4,0),COALESCE($5,0),COALESCE($6,0),
             COALESCE($7,0),COALESCE($8,0),COALESCE($9,0),COALESCE($10,0))
     ON CONFLICT (post_id, metric_date) DO UPDATE
       SET impressions = EXCLUDED.impressions, reach = EXCLUDED.reach,
           likes = EXCLUDED.likes, comments = EXCLUDED.comments,
           shares = EXCLUDED.shares, saves = EXCLUDED.saves,
           video_views = EXCLUDED.video_views, link_clicks = EXCLUDED.link_clicks
     RETURNING *`,
    [
      brand,
      post_id,
      metric_date,
      m.impressions,
      m.reach,
      m.likes,
      m.comments,
      m.shares,
      m.saves,
      m.video_views,
      m.link_clicks,
    ],
  );
  void ex;
  return rows[0];
}
async function listMetrics({ post_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.social_post_metrics WHERE post_id = $1
      ORDER BY metric_date DESC`,
    [post_id],
  );
  return rows;
}

/**
 * Detach planned drafts whose date has passed: a draft created from a future
 * calendar day carries that day in scheduled_for so it shows on the calendar.
 * Once the day is gone the planning date is meaningless, so we clear it — the
 * draft floats free again, ready to publish or reschedule. (Drafts only; a
 * real 'scheduled' post keeps its date.)
 */
async function detachStaleDrafts({ brand }) {
  await query(
    `UPDATE shared.social_posts
        SET scheduled_for = NULL, updated_at = now()
      WHERE business = $1
        AND status = 'draft'
        AND scheduled_for IS NOT NULL
        AND scheduled_for < now()`,
    [brand],
  );
}

module.exports = {
  createAccount,
  listAccounts,
  deactivateAccount,
  createPost,
  getPost,
  listPosts,
  setPostStatus,
  upsertMetrics,
  listMetrics,
  detachStaleDrafts,
};
