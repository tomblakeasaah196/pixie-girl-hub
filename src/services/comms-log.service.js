/**
 * Outbound comms log (PR-3) — records business→customer messages that happen
 * OUTSIDE the chat thread (receipts, invoices, tracking, reminders) so the
 * Customer-360 panel can answer "did she actually get it?".
 *
 * Best-effort and non-throwing: a logging failure must never break the send
 * it is recording. When the caller doesn't know the contact, we resolve it
 * from the recipient email so transactional sends are attributed automatically.
 */

"use strict";

const { query } = require("../config/database");
const { logger } = require("../config/logger");

async function record({
  business,
  contact_id,
  channel = "email",
  event_key,
  recipient,
  subject,
  status = "sent",
  provider_ref,
  error,
  reference_type,
  reference_id,
  message_ref,
}) {
  try {
    let cid = contact_id || null;
    if (!cid && channel === "email" && recipient) {
      const { rows } = await query(
        `SELECT contact_id FROM shared.contacts
          WHERE lower(email) = lower($1) LIMIT 1`,
        [recipient],
      );
      cid = rows[0]?.contact_id || null;
    }
    await query(
      `INSERT INTO shared.outbound_comms_log
         (business, contact_id, channel, event_key, recipient, subject,
          status, provider_ref, error, reference_type, reference_id, message_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        business || null,
        cid,
        channel,
        event_key || null,
        recipient || null,
        subject || null,
        status,
        provider_ref ? String(provider_ref) : null,
        error || null,
        reference_type || null,
        reference_id || null,
        message_ref || null,
      ],
    );
  } catch (e) {
    logger.warn({ e: e.message }, "comms-log record failed");
  }
}

/**
 * Find the send a provider event belongs to.
 *
 * `message_ref` is our own token, echoed back by the ESP — the reliable key.
 * The SMTP Message-ID (stored as provider_ref on the send row) is the fallback
 * for providers that echo only that. Returns the ORIGINATING send row, whose
 * contact/reference context the event row inherits.
 */
async function findSendForEvent({ message_ref, provider_ref }) {
  if (message_ref) {
    const { rows } = await query(
      `SELECT log_id, business, contact_id, channel, event_key, recipient,
              subject, reference_type, reference_id, message_ref
         FROM shared.outbound_comms_log
        WHERE message_ref = $1
        ORDER BY created_at ASC
        LIMIT 1`,
      [message_ref],
    );
    if (rows[0]) return rows[0];
  }
  if (provider_ref) {
    const { rows } = await query(
      `SELECT log_id, business, contact_id, channel, event_key, recipient,
              subject, reference_type, reference_id, message_ref
         FROM shared.outbound_comms_log
        WHERE provider_ref = $1
        ORDER BY created_at ASC
        LIMIT 1`,
      [String(provider_ref)],
    );
    if (rows[0]) return rows[0];
  }
  return null;
}

/**
 * Append a provider-reported receipt (delivered / opened / bounced /
 * complained) onto the send it belongs to.
 *
 * Idempotent two ways, because ESP webhooks are at-least-once AND the replay
 * sweep re-drives them:
 *   • `provider_event_id` is uniquely indexed — a redelivered event is a no-op.
 *   • repeat OPENS are collapsed. A customer who reads the same mail four times
 *     generates four events; the ledger records the first, because "when did
 *     she first see it" is the question the panel answers. Delivered/bounced/
 *     complained happen once per message anyway.
 *
 * @returns {Promise<{recorded: boolean, reason?: string}>}
 */
async function recordProviderEvent({ send, event }) {
  try {
    if (event.status === "opened") {
      const { rows } = await query(
        `SELECT 1 FROM shared.outbound_comms_log
          WHERE status = 'opened'
            AND ($1::uuid IS NULL OR reference_id = $1::uuid)
            AND ($2::text IS NULL OR message_ref = $2)
          LIMIT 1`,
        [send.reference_id || null, send.message_ref || null],
      );
      if (rows.length) return { recorded: false, reason: "already_opened" };
    }
    const { rows } = await query(
      `INSERT INTO shared.outbound_comms_log
         (business, contact_id, channel, event_key, recipient, subject,
          status, provider_ref, error, reference_type, reference_id,
          message_ref, provider, provider_event_id, event_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (provider, provider_event_id)
         WHERE provider_event_id IS NOT NULL DO NOTHING
       RETURNING log_id`,
      [
        send.business || null,
        send.contact_id || null,
        send.channel || "email",
        send.event_key || null,
        event.recipient || send.recipient || null,
        send.subject || null,
        event.status,
        event.provider_ref ? String(event.provider_ref) : null,
        event.error || null,
        send.reference_type || null,
        send.reference_id || null,
        send.message_ref || event.message_ref || null,
        event.provider,
        event.provider_event_id || null,
        event.event_at || null,
      ],
    );
    return rows[0]
      ? { recorded: true }
      : { recorded: false, reason: "duplicate_event" };
  } catch (e) {
    logger.warn(
      { e: e.message, provider: event && event.provider },
      "comms-log provider event failed",
    );
    return { recorded: false, reason: "insert_failed" };
  }
}

async function listForContact({ contact_id, limit = 10 }) {
  const { rows } = await query(
    `SELECT log_id, business, channel, event_key, recipient, subject,
            status, provider_ref, created_at
       FROM shared.outbound_comms_log
      WHERE contact_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [contact_id, limit],
  );
  return rows;
}

/**
 * Per-document send history — every outbound attempt tied to one document
 * (invoice/receipt/quote/delivery note), newest first. Powers the "was it
 * sent, did it land?" panel on a document's own detail screen.
 */
async function listForReference({ reference_type, reference_id, limit = 20 }) {
  if (!reference_type || !reference_id) return [];
  const { rows } = await query(
    `SELECT log_id, business, channel, event_key, recipient, subject,
            status, provider_ref, error, created_at,
            provider, event_at
       FROM shared.outbound_comms_log
      WHERE reference_type = $1 AND reference_id = $2
      ORDER BY created_at DESC
      LIMIT $3`,
    [reference_type, reference_id, limit],
  );
  return rows;
}

/**
 * Has a document already logged a row with this status? Lets a document without
 * its own "viewed" column (e.g. receipts) record an `opened` event exactly once.
 */
async function hasStatus({ reference_type, reference_id, status }) {
  if (!reference_type || !reference_id) return false;
  const { rows } = await query(
    `SELECT 1 FROM shared.outbound_comms_log
      WHERE reference_type = $1 AND reference_id = $2 AND status = $3
      LIMIT 1`,
    [reference_type, reference_id, status],
  );
  return rows.length > 0;
}

module.exports = {
  record,
  listForContact,
  listForReference,
  hasStatus,
  findSendForEvent,
  recordProviderEvent,
};
