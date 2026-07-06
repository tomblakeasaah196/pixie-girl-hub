/**
 * Documents & Signatures (V2.2 §6.13) — e-signature repository.
 * shared.signature_requests / signature_request_signers / signature_audit_events.
 * The audit chain is hash-linked (prev_event_hash → event_hash) for tamper
 * evidence; this layer just persists what the service computes.
 */

"use strict";

const { query } = require("../../config/database");

const ex = (client) => (client ? client.query.bind(client) : query);

async function createRequest({ client, row }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.signature_requests
       (business, document_id, request_type, reference_type, reference_id, signing_order, status, subject, message, expires_at, created_by)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,'sequential'),'draft',$7,$8,$9,$10)
     RETURNING *`,
    [
      row.business,
      row.document_id,
      row.request_type,
      row.reference_type || null,
      row.reference_id || null,
      row.signing_order,
      row.subject,
      row.message || null,
      row.expires_at || null,
      row.created_by || null,
    ],
  );
  return rows[0];
}
async function addSigner({ client, signer }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.signature_request_signers
       (request_id, user_id, contact_id, external_name, external_email, external_phone,
        display_name_snapshot, display_email_snapshot, signer_role, signing_step, signing_token, signing_token_expires_at, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending') RETURNING *`,
    [
      signer.request_id,
      signer.user_id || null,
      signer.contact_id || null,
      signer.external_name || null,
      signer.external_email || null,
      signer.external_phone || null,
      signer.display_name_snapshot,
      signer.display_email_snapshot,
      signer.signer_role,
      signer.signing_step,
      signer.signing_token,
      signer.signing_token_expires_at || null,
    ],
  );
  return rows[0];
}
async function getRequest({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.signature_requests WHERE request_id = $1 AND business = $2`,
    [id, brand],
  );
  if (!rows[0]) return null;
  const { rows: signers } = await ex(client)(
    `SELECT * FROM shared.signature_request_signers WHERE request_id = $1 ORDER BY signing_step`,
    [id],
  );
  const { rows: events } = await ex(client)(
    `SELECT * FROM shared.signature_audit_events WHERE request_id = $1 ORDER BY occurred_at`,
    [id],
  );
  return { ...rows[0], signers, events };
}
async function listRequests({
  client,
  brand,
  filters = {},
  page = 1,
  page_size = 25,
  offset = 0,
}) {
  const where = ["business = $1"];
  const params = [brand];
  let i = 2;
  if (filters.status) {
    where.push(`status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.request_type) {
    where.push(`request_type = $${i++}`);
    params.push(filters.request_type);
  }
  const w = `WHERE ${where.join(" AND ")}`;
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM shared.signature_requests ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM shared.signature_requests ${w} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, page_size, offset],
  );
  return {
    data: rows,
    meta: {
      page,
      page_size,
      total: c[0].total,
      has_more: offset + rows.length < c[0].total,
    },
  };
}
async function setRequestStatus({ client, id, status, extra = {} }) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE shared.signature_requests SET ${sets.join(", ")} WHERE request_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}
async function getSignerByToken({ client, token }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.signature_request_signers WHERE signing_token = $1`,
    [token],
  );
  return rows[0] || null;
}
async function setSignerStatus({ client, signer_id, status, extra = {} }) {
  const sets = ["status = $2"];
  const params = [signer_id, status];
  let i = 3;
  for (const [col, val] of Object.entries(extra)) {
    sets.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE shared.signature_request_signers SET ${sets.join(", ")} WHERE signer_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}
async function setAllSignersSent({ client, request_id }) {
  await ex(client)(
    `UPDATE shared.signature_request_signers SET status = 'sent' WHERE request_id = $1 AND status = 'pending'`,
    [request_id],
  );
}
async function lastAuditHash({ client, request_id }) {
  const { rows } = await ex(client)(
    `SELECT event_hash FROM shared.signature_audit_events WHERE request_id = $1 ORDER BY occurred_at DESC LIMIT 1`,
    [request_id],
  );
  return rows[0] ? rows[0].event_hash : null;
}
async function addAuditEvent({ client, event }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.signature_audit_events
       (request_id, signer_id, event_type, ip_address, user_agent, device, geo_country_code, metadata, prev_event_hash, event_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10) RETURNING *`,
    [
      event.request_id,
      event.signer_id || null,
      event.event_type,
      event.ip_address || null,
      event.user_agent || null,
      event.device || null,
      event.geo_country_code || null,
      event.metadata ? JSON.stringify(event.metadata) : null,
      event.prev_event_hash || null,
      event.event_hash,
    ],
  );
  return rows[0];
}
async function countSigners({ client, request_id }) {
  const { rows } = await ex(client)(
    `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'signed')::int AS signed FROM shared.signature_request_signers WHERE request_id = $1`,
    [request_id],
  );
  return rows[0];
}

// ── Signature on file (PIN-protected, email-keyed) ────────
/** Fetch a signer's saved signature profile by email (or null). */
async function getSignerSignatureByEmail({ client, email }) {
  if (!email) return null;
  const { rows } = await ex(client)(
    `SELECT * FROM shared.signer_signatures WHERE signer_email = $1`,
    [email],
  );
  return rows[0] || null;
}
/** Create or replace a signer's saved signature + PIN, keyed by email. */
async function upsertSignerSignature({
  client,
  email,
  user_id,
  signature_data_url,
  pin_hash,
}) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.signer_signatures
       (signer_email, user_id, signature_data_url, pin_hash, pin_set_at, pin_failed_count)
     VALUES ($1,$2,$3,$4, now(), 0)
     ON CONFLICT (signer_email) DO UPDATE
        SET user_id = COALESCE(EXCLUDED.user_id, shared.signer_signatures.user_id),
            signature_data_url = EXCLUDED.signature_data_url,
            pin_hash = EXCLUDED.pin_hash,
            pin_set_at = now(),
            pin_failed_count = 0,
            pin_locked_until = NULL
     RETURNING *`,
    [email, user_id || null, signature_data_url, pin_hash],
  );
  return rows[0];
}
/** Record a failed PIN attempt; lock the saved signature for a cool-off at 5 strikes. */
async function recordSignerPinFail({ client, email }) {
  const { rows } = await ex(client)(
    `UPDATE shared.signer_signatures
        SET pin_failed_count = pin_failed_count + 1,
            pin_locked_until = CASE WHEN pin_failed_count + 1 >= 5
                                    THEN now() + interval '15 minutes'
                                    ELSE pin_locked_until END
      WHERE signer_email = $1
      RETURNING pin_failed_count, pin_locked_until`,
    [email],
  );
  return rows[0] || null;
}
/** Record a successful PIN use; clear the strike counter + lock, stamp last_used_at. */
async function recordSignerPinSuccess({ client, email }) {
  await ex(client)(
    `UPDATE shared.signer_signatures
        SET pin_failed_count = 0,
            pin_locked_until = NULL,
            last_used_at = now()
      WHERE signer_email = $1`,
    [email],
  );
}
/** Link the generated signed document to the request. */
async function setSignedDocument({ client, request_id, document_id }) {
  await ex(client)(
    `UPDATE shared.signature_requests SET signed_document_id = $2 WHERE request_id = $1`,
    [request_id, document_id],
  );
}
/** Resolve a signer row by its public verification code (for the verify page). */
async function getSignerByVerificationCode({ client, code }) {
  const { rows } = await ex(client)(
    `SELECT s.*, r.business, r.document_id, r.subject, r.request_type
       FROM shared.signature_request_signers s
       JOIN shared.signature_requests r ON r.request_id = s.request_id
      WHERE s.verification_code = $1
      LIMIT 1`,
    [code],
  );
  return rows[0] || null;
}

module.exports = {
  createRequest,
  addSigner,
  getRequest,
  listRequests,
  setRequestStatus,
  getSignerByToken,
  setSignerStatus,
  setAllSignersSent,
  lastAuditHash,
  addAuditEvent,
  countSigners,
  getSignerSignatureByEmail,
  upsertSignerSignature,
  recordSignerPinFail,
  recordSignerPinSuccess,
  getSignerByVerificationCode,
  setSignedDocument,
};
