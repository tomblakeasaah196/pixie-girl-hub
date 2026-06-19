/**
 * Outbound Channel Policy — parameterised SQL.
 *
 * The policy table is the CEO's cost-discipline switchboard. The Hub
 * never sends an outbound notification without first reading this table
 * and respecting `block_whatsapp` as an unconditional guardrail.
 */

"use strict";

const { query } = require("../../config/database");

async function listPolicies({ brand }) {
  const { rows } = await query(
    `SELECT * FROM shared.outbound_channel_policy
      WHERE business = $1
      ORDER BY event_key`,
    [brand],
  );
  return rows;
}

async function getPolicy({ brand, event_key }) {
  const { rows } = await query(
    `SELECT * FROM shared.outbound_channel_policy
      WHERE business = $1 AND event_key = $2`,
    [brand, event_key],
  );
  return rows[0] || null;
}

async function upsertPolicy({ brand, user_id, input }) {
  const { rows } = await query(
    `INSERT INTO shared.outbound_channel_policy
       (business, event_key, channel_preference, fallback_channel,
        rationale, block_whatsapp, is_active, updated_by)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,false),COALESCE($7,true),$8)
     ON CONFLICT (business, event_key) DO UPDATE
       SET channel_preference = EXCLUDED.channel_preference,
           fallback_channel   = EXCLUDED.fallback_channel,
           rationale          = COALESCE(EXCLUDED.rationale,
                                          shared.outbound_channel_policy.rationale),
           block_whatsapp     = EXCLUDED.block_whatsapp,
           is_active          = EXCLUDED.is_active,
           updated_by         = EXCLUDED.updated_by,
           updated_at         = now()
     RETURNING *`,
    [
      brand,
      input.event_key,
      input.channel_preference,
      input.fallback_channel || null,
      input.rationale || null,
      input.block_whatsapp,
      input.is_active,
      user_id || null,
    ],
  );
  return rows[0];
}

/**
 * Resolve which channel to use for an outbound event for a contact.
 * The decision tree:
 *
 *   1. If the contact has `preferred_channel='none'`        → 'disabled'
 *   2. If the policy is 'disabled'                          → 'disabled'
 *   3. If the policy says 'respect_contact_pref' AND the contact has a
 *      preferred_channel that isn't blocked by block_whatsapp → use it
 *   4. Otherwise → use policy.channel_preference
 *   5. If the resolved channel is whatsapp BUT the policy has
 *      block_whatsapp=true → fall back to fallback_channel or email
 *
 * Returns { channel, reason } — reason is a short string the audit log
 * can stamp for traceability.
 */
async function resolveChannel({ brand, event_key, contact_id }) {
  const { rows } = await query(
    `SELECT p.channel_preference, p.fallback_channel, p.block_whatsapp,
            p.is_active, c.preferred_channel
       FROM shared.outbound_channel_policy p
       LEFT JOIN shared.contacts c ON c.contact_id = $3
      WHERE p.business = $1 AND p.event_key = $2`,
    [brand, event_key, contact_id || null],
  );
  const p = rows[0];
  // No policy row at all → safest default: email.
  if (!p)
    return {
      channel: "email",
      reason: "no_policy_default_email",
    };
  if (!p.is_active) return { channel: "disabled", reason: "policy_inactive" };
  if (p.preferred_channel === "none")
    return { channel: "disabled", reason: "contact_do_not_contact" };

  let chosen = p.channel_preference;
  let reason = "policy_default";
  if (chosen === "respect_contact_pref") {
    chosen = p.preferred_channel || p.fallback_channel || "email";
    reason = p.preferred_channel
      ? "contact_preference"
      : "fallback_no_preference";
  }
  // Hard guardrail: never send WhatsApp on a blocked event regardless.
  if (chosen === "whatsapp" && p.block_whatsapp) {
    chosen = p.fallback_channel || "email";
    reason = "whatsapp_blocked_fallback";
  }
  return { channel: chosen, reason };
}

module.exports = {
  listPolicies,
  getPolicy,
  upsertPolicy,
  resolveChannel,
};
