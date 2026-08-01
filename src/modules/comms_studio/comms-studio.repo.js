/**
 * Comms Studio — parameterised SQL over shared.outbound_channel_policy and
 * shared.automation_send_log. All queries are brand-scoped; the module
 * itself is CEO-editable (settings-level surface).
 */

"use strict";

const { query } = require("../../config/database");

/** List every automation configured for a brand, ordered for the Studio UI. */
async function listAutomations({ brand }) {
  const { rows } = await query(
    `SELECT policy_id, business, event_key, channel_preference, fallback_channel,
            rationale, block_whatsapp, is_active,
            display_name, description, category, trigger_type, cadence_config,
            subject_template, preheader_template, email_blocks_json,
            whatsapp_body_template, instagram_body_template, variables_schema,
            updated_by, updated_at, created_at
       FROM shared.outbound_channel_policy
      WHERE business = $1
      ORDER BY
        CASE category
          WHEN 'transactional' THEN 1
          WHEN 'lifecycle'     THEN 2
          WHEN 'marketing'     THEN 3
          WHEN 'operational'   THEN 4
          ELSE 5
        END,
        COALESCE(display_name, event_key)`,
    [brand],
  );
  return rows;
}

/**
 * Lean on/off + channel state for a set of automations, keyed by event_key.
 * For surfaces that only need "will this message actually send?" (e.g. the
 * Sales order-status impact modal) without pulling the full template payload.
 * event_keys with no configured policy row simply don't come back — the caller
 * decides how to represent "not configured".
 */
async function getAutomationStates({ brand, event_keys }) {
  if (!Array.isArray(event_keys) || event_keys.length === 0) return [];
  const { rows } = await query(
    `SELECT event_key, is_active, channel_preference
       FROM shared.outbound_channel_policy
      WHERE business = $1 AND event_key = ANY($2)`,
    [brand, event_keys],
  );
  return rows;
}

/** One automation by event_key. */
async function getAutomation({ brand, event_key }) {
  const { rows } = await query(
    `SELECT * FROM shared.outbound_channel_policy
      WHERE business = $1 AND event_key = $2`,
    [brand, event_key],
  );
  return rows[0] || null;
}

/**
 * Update the CEO-editable fields on one automation. event_key is the
 * lookup key — it is never mutated (foreign to the outbound dispatcher).
 * We COALESCE every field so a partial payload only touches what was
 * sent, matching the Studio's per-tab save pattern.
 */
async function updateAutomation({ brand, user_id, input }) {
  const { rows } = await query(
    `UPDATE shared.outbound_channel_policy
        SET channel_preference     = COALESCE($3, channel_preference),
            fallback_channel       = COALESCE($4, fallback_channel),
            block_whatsapp         = COALESCE($5, block_whatsapp),
            is_active              = COALESCE($6, is_active),
            display_name           = COALESCE($7, display_name),
            description            = COALESCE($8, description),
            category               = COALESCE($9, category),
            trigger_type           = COALESCE($10, trigger_type),
            cadence_config         = COALESCE($11::jsonb, cadence_config),
            subject_template       = COALESCE($12, subject_template),
            preheader_template     = COALESCE($13, preheader_template),
            email_blocks_json      = COALESCE($14::jsonb, email_blocks_json),
            whatsapp_body_template = COALESCE($15, whatsapp_body_template),
            instagram_body_template= COALESCE($16, instagram_body_template),
            variables_schema       = COALESCE($17::jsonb, variables_schema),
            rationale              = COALESCE($18, rationale),
            updated_by             = $19,
            updated_at             = now()
      WHERE business = $1 AND event_key = $2
      RETURNING *`,
    [
      brand,
      input.event_key,
      input.channel_preference ?? null,
      input.fallback_channel ?? null,
      input.block_whatsapp ?? null,
      input.is_active ?? null,
      input.display_name ?? null,
      input.description ?? null,
      input.category ?? null,
      input.trigger_type ?? null,
      input.cadence_config !== undefined ? JSON.stringify(input.cadence_config) : null,
      input.subject_template ?? null,
      input.preheader_template ?? null,
      input.email_blocks_json !== undefined ? JSON.stringify(input.email_blocks_json) : null,
      input.whatsapp_body_template ?? null,
      input.instagram_body_template ?? null,
      input.variables_schema !== undefined ? JSON.stringify(input.variables_schema) : null,
      input.rationale ?? null,
      user_id || null,
    ],
  );
  return rows[0] || null;
}

// ── automation_send_log ────────────────────────────────────

/**
 * Reserve a dedup slot before actually sending. Uses ON CONFLICT DO NOTHING
 * against the (business, event_key, dedup_key) UNIQUE index so a re-run of
 * the same send is a silent no-op — the caller inspects rowCount to know
 * whether it "owned" the send. This is how the birthday cron guarantees
 * once-per-year-per-contact even if the sweep restarts mid-run.
 */
async function claimSend({ brand, event_key, contact_id, dedup_key, channel, variables }) {
  const { rows } = await query(
    `INSERT INTO shared.automation_send_log
       (business, event_key, contact_id, dedup_key, channel, variables, status)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'queued')
     ON CONFLICT (business, event_key, dedup_key) DO NOTHING
     RETURNING send_id`,
    [
      brand,
      event_key,
      contact_id || null,
      dedup_key,
      channel,
      JSON.stringify(variables || {}),
    ],
  );
  return rows[0] || null;
}

async function markSendStatus({ send_id, status, failure_reason }) {
  await query(
    `UPDATE shared.automation_send_log
        SET status = $2, failure_reason = $3
      WHERE send_id = $1`,
    [send_id, status, failure_reason || null],
  );
}

/** Returns the last N sends for the Studio's per-automation activity log. */
async function listSendLog({ brand, event_key, limit = 25 }) {
  const { rows } = await query(
    `SELECT send_id, contact_id, dedup_key, channel, status, failure_reason, sent_at
       FROM shared.automation_send_log
      WHERE business = $1 AND event_key = $2
      ORDER BY sent_at DESC
      LIMIT $3`,
    [brand, event_key, Math.min(Math.max(limit, 1), 100)],
  );
  return rows;
}

module.exports = {
  listAutomations,
  getAutomationStates,
  getAutomation,
  updateAutomation,
  claimSend,
  markSendStatus,
  listSendLog,
};
