/**
 * WhatsApp Calls — repository. Parameterised SQL over shared.whatsapp_calls
 * + shared.whatsapp_call_events (migration 000319). Brand isolation via the
 * `business` column, same as the rest of the shared messaging domain.
 */

"use strict";

const { query, ex } = require("../../config/database");

/**
 * Idempotent insert keyed on Meta's wa_call_id. A webhook redelivery (or
 * the inline fast-path racing the durable outbox consumer) returns the
 * existing row with `duplicate: true` instead of ringing twice.
 */
async function createFromConnect({ client, call }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.whatsapp_calls
       (business, wa_call_id, contact_id, channel_id, direction, status,
        from_number, to_number, caller_name, sdp_offer, started_at)
     VALUES ($1,$2,$3,$4,'inbound','ringing',$5,$6,$7,$8,COALESCE($9, now()))
     ON CONFLICT (wa_call_id) DO NOTHING
     RETURNING *`,
    [
      call.business,
      call.wa_call_id,
      call.contact_id || null,
      call.channel_id || null,
      call.from_number || null,
      call.to_number || null,
      call.caller_name || null,
      call.sdp_offer || null,
      call.started_at || null,
    ],
  );
  if (rows[0]) return { call: rows[0], duplicate: false };
  const existing = await findByWaCallId({ client, wa_call_id: call.wa_call_id });
  return { call: existing, duplicate: true };
}

/** One row per (call, event) — duplicates are silently dropped. */
async function insertEvent({ client, e }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.whatsapp_call_events (call_id, event, actor_user_id, payload)
     VALUES ($1,$2,$3,COALESCE($4::jsonb,'{}'::jsonb))
     ON CONFLICT (call_id, event) DO NOTHING
     RETURNING event_id`,
    [e.call_id, e.event, e.actor_user_id || null, e.payload ? JSON.stringify(e.payload) : null],
  );
  return rows[0] || null;
}

async function findById({ client, business, call_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.whatsapp_calls WHERE call_id = $1 AND business = $2`,
    [call_id, business],
  );
  return rows[0] || null;
}

async function findByWaCallId({ client, wa_call_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.whatsapp_calls WHERE wa_call_id = $1`,
    [wa_call_id],
  );
  return rows[0] || null;
}

/** Lifecycle jobs run without a brand context — lookup by pk alone. */
async function findByCallIdUnscoped({ call_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.whatsapp_calls WHERE call_id = $1`,
    [call_id],
  );
  return rows[0] || null;
}

/** Conversation owner (message_channels.assigned_to) for ring targeting. */
async function getChannelOwner(channel_id) {
  const { rows } = await query(
    `SELECT assigned_to FROM shared.message_channels WHERE channel_id = $1`,
    [channel_id],
  );
  return rows[0] ? rows[0].assigned_to : null;
}

async function getUserName(user_id) {
  const { rows } = await query(
    `SELECT display_name FROM shared.users WHERE user_id = $1`,
    [user_id],
  );
  return rows[0] ? rows[0].display_name : null;
}

/**
 * Atomic claim: exactly one agent wins the ringing call (first UPDATE
 * flips it to in_progress; everyone else sees zero rows and gets a clean
 * "already answered" error upstream).
 */
async function claim({ business, call_id, user_id }) {
  const { rows } = await query(
    `UPDATE shared.whatsapp_calls
        SET status = 'in_progress', answered_by = $3, answered_at = now()
      WHERE call_id = $1 AND business = $2 AND status = 'ringing'
      RETURNING *`,
    [call_id, business, user_id],
  );
  return rows[0] || null;
}

/**
 * Release a claim whose Graph accept failed — back to ringing so another
 * agent (or a retry) can still take it before Meta times the call out.
 */
async function releaseClaim({ call_id, user_id }) {
  const { rows } = await query(
    `UPDATE shared.whatsapp_calls
        SET status = 'ringing', answered_by = NULL, answered_at = NULL
      WHERE call_id = $1 AND answered_by = $2 AND status = 'in_progress'
      RETURNING *`,
    [call_id, user_id],
  );
  return rows[0] || null;
}

/**
 * Terminal transition. Only ever moves forward — a call already in a
 * terminal state keeps its first verdict (webhook redelivery / hangup
 * racing the terminate webhook are both no-ops). Clears the SDP offer;
 * it is single-use and has no value at rest.
 */
async function markEnded({ call_id, status, end_reason, ended_at, duration_seconds }) {
  const { rows } = await query(
    `UPDATE shared.whatsapp_calls
        SET status = $2,
            end_reason = COALESCE($3, end_reason),
            ended_at = COALESCE($4::timestamptz, now()),
            duration_seconds = COALESCE($5, duration_seconds,
              GREATEST(0, EXTRACT(EPOCH FROM (COALESCE($4::timestamptz, now()) - answered_at))::int)),
            sdp_offer = NULL
      WHERE call_id = $1 AND status IN ('ringing','in_progress')
      RETURNING *`,
    [call_id, status, end_reason || null, ended_at || null, duration_seconds ?? null],
  );
  return rows[0] || null;
}

async function setEscalated({ call_id }) {
  const { rows } = await query(
    `UPDATE shared.whatsapp_calls
        SET escalated_at = now()
      WHERE call_id = $1 AND status = 'ringing' AND escalated_at IS NULL
      RETURNING *`,
    [call_id],
  );
  return rows[0] || null;
}

async function setTimelineMessage({ call_id, message_id }) {
  await query(
    `UPDATE shared.whatsapp_calls SET message_id = $2 WHERE call_id = $1`,
    [call_id, message_id],
  );
}

async function setMissedFollowups({ call_id, auto_reply_sent, missed_task_id }) {
  await query(
    `UPDATE shared.whatsapp_calls
        SET auto_reply_sent = COALESCE($2, auto_reply_sent),
            missed_task_id = COALESCE($3, missed_task_id)
      WHERE call_id = $1`,
    [call_id, auto_reply_sent ?? null, missed_task_id || null],
  );
}

async function setOutcome({ call_id, business, outcome, outcome_notes, user_id }) {
  const { rows } = await query(
    `UPDATE shared.whatsapp_calls
        SET outcome = $3, outcome_notes = $4,
            outcome_recorded_by = $5, outcome_recorded_at = now()
      WHERE call_id = $1 AND business = $2 AND status = 'completed'
      RETURNING *`,
    [call_id, business, outcome, outcome_notes || null, user_id],
  );
  return rows[0] || null;
}

/**
 * Call log for the brand. Filters: status, contact_id, answered_by,
 * missed_only (status = missed). Joined with contact + agent display
 * names so the history list renders in one read.
 */
async function list({ business, status, contact_id, answered_by, limit, offset }) {
  const where = ["c.business = $1"];
  const params = [business];
  if (status) {
    params.push(status);
    where.push(`c.status = $${params.length}`);
  }
  if (contact_id) {
    params.push(contact_id);
    where.push(`c.contact_id = $${params.length}`);
  }
  if (answered_by) {
    params.push(answered_by);
    where.push(`c.answered_by = $${params.length}`);
  }
  params.push(Math.min(limit || 50, 100));
  const limIdx = params.length;
  params.push(offset || 0);
  const offIdx = params.length;
  const { rows } = await query(
    `SELECT c.call_id, c.business, c.wa_call_id, c.contact_id, c.channel_id,
            c.direction, c.status, c.from_number, c.caller_name,
            c.answered_by, c.answered_at, c.started_at, c.ended_at,
            c.duration_seconds, c.end_reason, c.outcome, c.outcome_notes,
            c.outcome_recorded_at, c.auto_reply_sent, c.missed_task_id,
            con.display_name AS contact_name,
            u.display_name AS answered_by_name
       FROM shared.whatsapp_calls c
       LEFT JOIN shared.contacts con ON con.contact_id = c.contact_id
       LEFT JOIN shared.users u ON u.user_id = c.answered_by
      WHERE ${where.join(" AND ")}
      ORDER BY c.started_at DESC
      LIMIT $${limIdx} OFFSET $${offIdx}`,
    params,
  );
  return rows;
}

/** Ringing calls older than `seconds` — the stale sweep's candidates. */
async function findStaleRinging({ olderThanSeconds }) {
  const { rows } = await query(
    `SELECT * FROM shared.whatsapp_calls
      WHERE status = 'ringing'
        AND started_at < now() - ($1 || ' seconds')::interval`,
    [String(olderThanSeconds)],
  );
  return rows;
}

/** First CEO user — fallback creator for system-generated CRM tasks. */
async function findFallbackTaskCreator() {
  const { rows } = await query(
    `SELECT user_id FROM shared.users
      WHERE is_ceo = true AND (status IS NULL OR status = 'active')
      ORDER BY created_at
      LIMIT 1`,
  );
  return rows[0] ? rows[0].user_id : null;
}

module.exports = {
  createFromConnect,
  insertEvent,
  findById,
  findByWaCallId,
  findByCallIdUnscoped,
  getChannelOwner,
  getUserName,
  claim,
  releaseClaim,
  markEnded,
  setEscalated,
  setTimelineMessage,
  setMissedFollowups,
  setOutcome,
  list,
  findStaleRinging,
  findFallbackTaskCreator,
};
