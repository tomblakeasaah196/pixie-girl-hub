/**
 * Social Studio (V2.2 §6.14) — repository.
 * SHARED tables (business-scoped): social_accounts, social_content_plans,
 * social_posts, social_post_metrics, social_targets. Parameterised SQL only.
 */

"use strict";

const { query } = require("../../config/database");

/** Build a `col = $n` SET clause + params from a plain field map, starting
 *  parameter numbering at `startAt`. Used by the handful of partial-update
 *  functions below so they don't each hand-roll the same loop. */
function buildSet(fields, startAt) {
  const set = [];
  const params = [];
  let i = startAt;
  for (const [col, val] of Object.entries(fields)) {
    set.push(`${col} = $${i++}`);
    params.push(val);
  }
  return { set, params };
}

// ── Accounts (handle registry — no OAuth tokens) ────────────
async function createAccount({ brand, account, connected_by }) {
  const { rows } = await query(
    `INSERT INTO shared.social_accounts
       (business, platform, handle, profile_url, connected_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [
      brand,
      account.platform,
      account.handle,
      account.profile_url || null,
      connected_by || null,
    ],
  );
  return rows[0];
}
async function listAccounts({ brand }) {
  const { rows } = await query(
    `SELECT account_id, business, platform, handle, profile_url, is_active, connected_at
       FROM shared.social_accounts WHERE business = $1 ORDER BY platform, handle`,
    [brand],
  );
  return rows;
}
async function listActiveAccounts({ brand, platform }) {
  const { rows } = await query(
    `SELECT account_id, handle, profile_url FROM shared.social_accounts
      WHERE business = $1 AND platform = $2 AND is_active = true`,
    [brand, platform],
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

// ── Content plans (the monthly batch, submitted as one entity) ─────
async function createPlan({
  client,
  brand,
  created_by,
  period_start,
  period_end,
}) {
  const { rows } = await (client || { query }).query(
    `INSERT INTO shared.social_content_plans
       (business, created_by, period_start, period_end)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [brand, created_by, period_start, period_end],
  );
  return rows[0];
}
async function getPlan({ client, brand, id }) {
  const { rows } = await (client || { query }).query(
    `SELECT * FROM shared.social_content_plans WHERE plan_id = $1 AND business = $2`,
    [id, brand],
  );
  return rows[0] || null;
}
async function listPlans({ brand, status }) {
  const where = ["business = $1"];
  const params = [brand];
  if (status) {
    where.push(`status = $2`);
    params.push(status);
  }
  const { rows } = await query(
    `SELECT * FROM shared.social_content_plans WHERE ${where.join(" AND ")}
      ORDER BY period_start DESC`,
    params,
  );
  return rows;
}
async function setPlanStatus({ client, brand, id, status, fields = {} }) {
  const { set, params } = buildSet(fields, 4);
  const cols = ["status = $3", ...set];
  const { rows } = await (client || { query }).query(
    `UPDATE shared.social_content_plans SET ${cols.join(", ")}, updated_at = now()
      WHERE plan_id = $1 AND business = $2 RETURNING *`,
    [id, brand, status, ...params],
  );
  return rows[0] || null;
}
async function refreshPlanPostCount({ client, brand, id }) {
  const c = client || { query };
  const { rows } = await c.query(
    `UPDATE shared.social_content_plans p SET post_count = (
       SELECT count(*) FROM shared.social_posts WHERE plan_id = p.plan_id
     ), updated_at = now()
     WHERE p.plan_id = $1 AND p.business = $2 RETURNING *`,
    [id, brand],
  );
  return rows[0] || null;
}

// ── Posts ──────────────────────────────────────────────────
async function createPost({ client, brand, created_by, post }) {
  const { rows } = await (client || { query }).query(
    `INSERT INTO shared.social_posts
       (business, created_by, account_id, platform, post_type, caption, hashtags,
        media_urls, tagged_product_ids, status, scheduled_for, assigned_to, plan_id)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'{}'::text[]),COALESCE($8,'{}'::text[]),
             COALESCE($9,'{}'::uuid[]),COALESCE($10,'draft'),$11,$12,$13) RETURNING *`,
    [
      brand,
      created_by,
      post.account_id,
      post.platform,
      post.post_type,
      post.caption || null,
      post.hashtags,
      post.media_urls,
      post.tagged_product_ids,
      post.status,
      post.scheduled_for || null,
      post.assigned_to || null,
      post.plan_id || null,
    ],
  );
  return rows[0];
}

/** Grid bulk-plan: insert many rows in one round trip. `rows` is an array of
 *  plain objects shaped like a single `createPost` row (missing keys -> NULL/default). */
async function bulkCreatePosts({ client, brand, created_by, plan_id, rows }) {
  if (!rows.length) return [];
  const values = [];
  const params = [brand, created_by, plan_id];
  let i = params.length + 1;
  for (const r of rows) {
    values.push(
      `($1,$2,$${i++},$${i++},$${i++},$${i++},COALESCE($${i++},'{}'::text[]),COALESCE($${i++},'{}'::text[]),` +
        `COALESCE($${i++},'{}'::uuid[]),COALESCE($${i++},'draft'),$${i++},$${i++},$3)`,
    );
    params.push(
      r.account_id,
      r.platform,
      r.post_type,
      r.caption || null,
      r.hashtags,
      r.media_urls,
      r.tagged_product_ids,
      r.status,
      r.scheduled_for || null,
      r.assigned_to || null,
    );
  }
  const { rows: out } = await (client || { query }).query(
    `INSERT INTO shared.social_posts
       (business, created_by, account_id, platform, post_type, caption, hashtags,
        media_urls, tagged_product_ids, status, scheduled_for, assigned_to, plan_id)
     VALUES ${values.join(",")} RETURNING *`,
    params,
  );
  return out;
}

async function getPost({ brand, id }) {
  const { rows } = await query(
    `SELECT * FROM shared.social_posts WHERE post_id = $1 AND business = $2`,
    [id, brand],
  );
  return rows[0] || null;
}
async function listPosts({
  brand,
  status,
  plan_id,
  assigned_to,
  platform,
  from,
  to,
  page = 1,
  page_size = 100,
}) {
  const where = ["business = $1"];
  const params = [brand];
  let i = 2;
  if (status) {
    where.push(`status = $${i++}`);
    params.push(status);
  }
  if (plan_id) {
    where.push(`plan_id = $${i++}`);
    params.push(plan_id);
  }
  if (assigned_to) {
    where.push(`assigned_to = $${i++}`);
    params.push(assigned_to);
  }
  if (platform) {
    where.push(`platform = $${i++}`);
    params.push(platform);
  }
  if (from) {
    where.push(`COALESCE(scheduled_for, created_at) >= $${i++}`);
    params.push(from);
  }
  if (to) {
    where.push(`COALESCE(scheduled_for, created_at) < $${i++}`);
    params.push(to);
  }
  const w = `WHERE ${where.join(" AND ")}`;
  const { rows: c } = await query(
    `SELECT count(*)::int AS total FROM shared.social_posts ${w}`,
    params,
  );
  const offset = (page - 1) * page_size;
  const { rows } = await query(
    `SELECT * FROM shared.social_posts ${w}
      ORDER BY COALESCE(scheduled_for, created_at) ASC LIMIT $${i++} OFFSET $${i}`,
    [...params, page_size, offset],
  );
  return { data: rows, page, page_size, total: c[0].total };
}
async function updatePost({ brand, id, fields }) {
  const { set, params } = buildSet(fields, 3);
  if (!set.length) return getPost({ brand, id });
  const { rows } = await query(
    `UPDATE shared.social_posts SET ${set.join(", ")}, updated_at = now()
      WHERE post_id = $1 AND business = $2 RETURNING *`,
    [id, brand, ...params],
  );
  return rows[0] || null;
}
async function setPostStatus({ client, brand, id, status, fields = {} }) {
  const { set, params } = buildSet(fields, 4);
  const cols = ["status = $3", ...set];
  const { rows } = await (client || { query }).query(
    `UPDATE shared.social_posts SET ${cols.join(", ")}, updated_at = now()
      WHERE post_id = $1 AND business = $2 RETURNING *`,
    [id, brand, status, ...params],
  );
  return rows[0] || null;
}

/** Posts due for the deadline sweep: still scheduled/assigned, execution date
 *  has passed the grace window, never proven. Ordered oldest-due-first. */
async function findDuePosts({ brand, graceMinutes }) {
  const { rows } = await query(
    `SELECT * FROM shared.social_posts
      WHERE business = $1 AND status IN ('scheduled','assigned')
        AND scheduled_for IS NOT NULL
        AND scheduled_for < now() - ($2 || ' minutes')::interval
      ORDER BY scheduled_for ASC`,
    [brand, String(graceMinutes)],
  );
  return rows;
}
async function recordNudge({ id }) {
  await query(
    `UPDATE shared.social_posts SET nudge_count = nudge_count + 1, last_nudged_at = now()
      WHERE post_id = $1`,
    [id],
  );
}
async function flagOverdue({ id, reason }) {
  const { rows } = await query(
    `UPDATE shared.social_posts SET status = 'flagged', flag_reason = $2, updated_at = now()
      WHERE post_id = $1 RETURNING *`,
    [id, reason],
  );
  return rows[0] || null;
}

/**
 * Detach planned drafts whose date has passed: a draft created from a future
 * calendar day carries that day in scheduled_for so it shows on the calendar.
 * Once the day is gone the planning date is meaningless, so we clear it — the
 * draft floats free again. (Drafts only; 'assigned'/'scheduled' posts are
 * handled by the deadline sweep instead, since those carry real accountability.)
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

// ── Metrics ────────────────────────────────────────────────
async function upsertMetrics({ post_id, metric_date, m }) {
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
async function latestMetrics({ post_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.social_post_metrics WHERE post_id = $1
      ORDER BY metric_date DESC LIMIT 1`,
    [post_id],
  );
  return rows[0] || null;
}

// ── Targets ────────────────────────────────────────────────
async function upsertTarget({
  brand,
  platform,
  user_id,
  period_month,
  target_count,
  set_by,
}) {
  const { rows } = await query(
    `INSERT INTO shared.social_targets
       (business, platform, user_id, period_month, target_count, set_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (business, platform, user_id, period_month) DO UPDATE
       SET target_count = EXCLUDED.target_count, set_by = EXCLUDED.set_by, updated_at = now()
     RETURNING *`,
    [brand, platform, user_id || null, period_month, target_count, set_by],
  );
  return rows[0];
}
async function listTargets({ brand, period_month }) {
  const { rows } = await query(
    `SELECT * FROM shared.social_targets WHERE business = $1 AND period_month = $2
      ORDER BY platform, user_id NULLS FIRST`,
    [brand, period_month],
  );
  return rows;
}

// ── Performance / Team aggregation ──────────────────────────
async function performanceSummary({ brand, period_month }) {
  const { rows } = await query(
    `SELECT platform,
            count(*) FILTER (WHERE status = 'posted')::int AS posted_count,
            count(*) FILTER (WHERE status IN ('scheduled','assigned'))::int AS pending_count,
            count(*) FILTER (WHERE status = 'flagged')::int AS flagged_count,
            count(*) FILTER (
              WHERE status = 'posted' AND published_at IS NOT NULL
                AND (scheduled_for IS NULL OR published_at <= scheduled_for)
            )::int AS on_time_count,
            avg(performance_score) FILTER (WHERE performance_score IS NOT NULL)::numeric(5,2) AS avg_performance_score,
            avg(creative_rating) FILTER (WHERE creative_rating IS NOT NULL)::numeric(3,2) AS avg_creative_rating
       FROM shared.social_posts
      WHERE business = $1 AND date_trunc('month', COALESCE(scheduled_for, created_at)) = $2
      GROUP BY platform
      ORDER BY platform`,
    [brand, period_month],
  );
  return rows;
}
async function teamSummary({ brand, period_month }) {
  const { rows } = await query(
    `SELECT u.user_id, u.display_name, sp.platform,
            count(*) FILTER (WHERE sp.status = 'posted')::int AS posted_count,
            count(*) FILTER (WHERE sp.status IN ('scheduled','assigned'))::int AS pending_count,
            count(*) FILTER (WHERE sp.status = 'flagged')::int AS flagged_count,
            count(*) FILTER (
              WHERE sp.status = 'posted' AND sp.published_at IS NOT NULL
                AND (sp.scheduled_for IS NULL OR sp.published_at <= sp.scheduled_for)
            )::int AS on_time_count,
            avg(sp.performance_score) FILTER (WHERE sp.performance_score IS NOT NULL)::numeric(5,2) AS avg_performance_score,
            avg(sp.creative_rating) FILTER (WHERE sp.creative_rating IS NOT NULL)::numeric(3,2) AS avg_creative_rating
       FROM shared.social_posts sp
       JOIN shared.users u ON u.user_id = COALESCE(sp.assigned_to, sp.created_by)
      WHERE sp.business = $1 AND date_trunc('month', COALESCE(sp.scheduled_for, sp.created_at)) = $2
      GROUP BY u.user_id, u.display_name, sp.platform
      ORDER BY u.display_name, sp.platform`,
    [brand, period_month],
  );
  return rows;
}
async function creatorDrilldown({ brand, user_id, period_month }) {
  const { rows } = await query(
    `SELECT * FROM shared.social_posts
      WHERE business = $1 AND COALESCE(assigned_to, created_by) = $2
        AND date_trunc('month', COALESCE(scheduled_for, created_at)) = $3
      ORDER BY COALESCE(scheduled_for, created_at) ASC`,
    [brand, user_id, period_month],
  );
  return rows;
}

module.exports = {
  createAccount,
  listAccounts,
  listActiveAccounts,
  deactivateAccount,
  createPlan,
  getPlan,
  listPlans,
  setPlanStatus,
  refreshPlanPostCount,
  createPost,
  bulkCreatePosts,
  getPost,
  listPosts,
  updatePost,
  setPostStatus,
  findDuePosts,
  recordNudge,
  flagOverdue,
  detachStaleDrafts,
  upsertMetrics,
  listMetrics,
  latestMetrics,
  upsertTarget,
  listTargets,
  performanceSummary,
  teamSummary,
  creatorDrilldown,
};
