/**
 * Audit log middleware (V2.2 §3 — "Every permission change is logged
 * with date, time, and actor.")
 *
 * Wraps any state-changing action. Captures:
 *   actor       (req.user.user_id)
 *   business    (req.brand)
 *   action_key  ('sales.order.create')
 *   target_type ('sales_order')
 *   target_id   (uuid)
 *   before      (snapshot before mutation, when retrievable)
 *   after       (snapshot after mutation)
 *   ip, user_agent, request_id
 *
 * Writes to shared.audit_log (which is append-only — UPDATE/DELETE
 * blocked by DB trigger).
 *
 * USE: don't apply via Express middleware; call from services where
 *      the before/after snapshots are known. This file exposes the
 *      `audit()` helper, not Express middleware.
 */

"use strict";

const { query } = require("../config/database");
const { logger } = require("../config/logger");
const { config } = require("../config/env");

/**
 * Write one audit row. Never throws — audit failure must not break
 * the user's action (the action itself is already committed).
 *
 * The caller-facing shape stays stable (action_key / target_type /
 * target_id / request_id) but is mapped onto the real shared.audit_log
 * columns: action_key → action, its prefix → module, target_type →
 * table_name, target_id → record_id, request_id → metadata.request_id.
 * `module`, `user_name`, and `business` are NOT NULL in the table, so we
 * coalesce sensible defaults ('system') when a system-level event omits
 * them.
 */
async function audit({
  business,
  user_id,
  action_key,
  target_type,
  target_id,
  before = null,
  after = null,
  metadata = null,
  request_id = null,
  ip = null,
  user_agent = null,
  is_sensitive = false,
  user_name = null,
  module = null,
}) {
  if (!config.ENABLE_AUDIT_LOG) return;
  const mod =
    module || (action_key ? String(action_key).split(".")[0] : "system");
  const meta = { ...(metadata || {}) };
  if (request_id) meta.request_id = request_id;
  try {
    await query(
      `INSERT INTO shared.audit_log
         (business, user_id, user_name, module, action, table_name, record_id,
          before_state, after_state, ip_address, user_agent, is_sensitive, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        business || "system",
        user_id,
        user_name || (user_id ? String(user_id) : "system"),
        mod,
        action_key,
        target_type,
        target_id,
        before ? JSON.stringify(before) : null,
        after ? JSON.stringify(after) : null,
        ip,
        user_agent,
        is_sensitive,
        JSON.stringify(meta),
      ],
    );
  } catch (err) {
    logger.error({ err, action_key, target_id }, "audit log write failed");
  }
}

module.exports = { audit };
