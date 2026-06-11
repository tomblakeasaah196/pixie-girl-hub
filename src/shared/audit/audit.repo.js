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

module.exports = { list, getById, forRecord };
