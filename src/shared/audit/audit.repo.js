/**
 * Audit log (V2.2 §3) — read repository.
 *
 * Read-only over shared.audit_log (writes happen via the audit() middleware).
 * Scoped to the active business; supports filtering by actor, module, action,
 * affected record, sensitivity, and date range. Parameterised SQL only.
 */

"use strict";

const { query } = require("../../config/database");

async function list({
  brand,
  user_id,
  module,
  action,
  table_name,
  record_id,
  is_sensitive,
  from,
  to,
  page = 1,
  page_size = 50,
}) {
  const where = ["business = $1"];
  const params = [brand];
  let i = 2;
  if (user_id) {
    where.push(`user_id = $${i++}`);
    params.push(user_id);
  }
  if (module) {
    where.push(`module = $${i++}`);
    params.push(module);
  }
  if (action) {
    where.push(`action = $${i++}`);
    params.push(action);
  }
  if (table_name) {
    where.push(`table_name = $${i++}`);
    params.push(table_name);
  }
  if (record_id) {
    where.push(`record_id = $${i++}`);
    params.push(record_id);
  }
  if (is_sensitive !== undefined) {
    where.push(`is_sensitive = $${i++}`);
    params.push(is_sensitive);
  }
  if (from) {
    where.push(`occurred_at >= $${i++}`);
    params.push(from);
  }
  if (to) {
    where.push(`occurred_at <= $${i++}`);
    params.push(to);
  }
  const w = `WHERE ${where.join(" AND ")}`;
  const { rows: c } = await query(
    `SELECT count(*)::int AS total FROM shared.audit_log ${w}`,
    params,
  );
  const offset = (page - 1) * page_size;
  const { rows } = await query(
    `SELECT log_id, occurred_at, user_id, user_name, user_email, user_class,
            business, module, action, table_name, record_id, ip_address,
            session_id, is_sensitive, metadata
       FROM shared.audit_log ${w}
      ORDER BY occurred_at DESC
      LIMIT $${i++} OFFSET $${i}`,
    [...params, page_size, offset],
  );
  return { data: rows, page, page_size, total: c[0].total };
}

async function getById({ brand, id }) {
  const { rows } = await query(
    `SELECT * FROM shared.audit_log WHERE log_id = $1 AND business = $2`,
    [id, brand],
  );
  return rows[0] || null;
}

/** Full trail for one record (chronological). */
async function forRecord({ brand, table_name, record_id }) {
  const { rows } = await query(
    `SELECT log_id, occurred_at, user_id, user_name, action, before_state,
            after_state, metadata
       FROM shared.audit_log
      WHERE business = $1 AND table_name = $2 AND record_id = $3
      ORDER BY occurred_at ASC`,
    [brand, table_name, record_id],
  );
  return rows;
}

/**
 * Self-scoped feed: the authenticated user's own actions, newest-first, so a
 * user can spot activity that wasn't theirs and rotate credentials fast. The
 * feed is paginated (default 10/page, hard cap of 30 rows across pages) so the
 * dashboard can show three pages of recent activity without dumping the full
 * trail. `window` reflects whether page 1 fits inside the last 24 h; older
 * pages always report "all_time".
 *
 * Includes `business = 'system'` rows alongside the active brand: pre-brand
 * events (login, logout, email verification — anything that happens before
 * X-Brand-Context exists) are written with business='system' by the audit()
 * helper, since `business` is NOT NULL and no brand has been selected yet.
 * Those rows carry no other brand's business data, so surfacing them here
 * doesn't cross entity isolation — it just makes a user's own login show up
 * in their activity feed no matter which brand tab they're on.
 */
async function myFeed({ brand, user_id, page = 1, page_size = 10, max_total = 30 }) {
  const safePageSize = Math.max(1, Math.min(page_size, max_total));
  const safePage = Math.max(1, page);
  const offset = (safePage - 1) * safePageSize;
  const remaining = Math.max(0, max_total - offset);
  const limit = Math.min(safePageSize, remaining);
  if (limit === 0) {
    return {
      data: [],
      window: "all_time",
      page: safePage,
      page_size: safePageSize,
      total: max_total,
    };
  }
  const { rows: countRows } = await query(
    `SELECT count(*)::int AS total
       FROM (
         SELECT 1 FROM shared.audit_log
          WHERE business IN ($1, 'system') AND user_id = $2
          ORDER BY occurred_at DESC
          LIMIT $3
       ) t`,
    [brand, user_id, max_total],
  );
  const total = countRows[0]?.total ?? 0;
  const { rows } = await query(
    `SELECT log_id, occurred_at, module, action, table_name, record_id,
            metadata
       FROM shared.audit_log
      WHERE business IN ($1, 'system')
        AND user_id  = $2
      ORDER BY occurred_at DESC
      LIMIT $3 OFFSET $4`,
    [brand, user_id, limit, offset],
  );
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const window =
    safePage === 1 && rows.length > 0 && new Date(rows[0].occurred_at).getTime() >= cutoff
      ? "24h"
      : "all_time";
  return { data: rows, window, page: safePage, page_size: safePageSize, total };
}

module.exports = { list, getById, forRecord, myFeed };
