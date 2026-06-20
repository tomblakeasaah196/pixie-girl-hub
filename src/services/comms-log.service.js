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
          status, provider_ref, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
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
      ],
    );
  } catch (e) {
    logger.warn({ e: e.message }, "comms-log record failed");
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

module.exports = { record, listForContact };
