/**
 * Kaizen operators repository — parameterised SQL only.
 */

"use strict";

const { query } = require("../../../config/database");

async function listOperators() {
  const { rows } = await query(
    `SELECT operator_id, email, display_name, phone, status,
            must_change_password, last_login_at, created_at
       FROM shared.kaizen_operators
      ORDER BY created_at ASC`,
  );
  return rows;
}

async function findByEmail(email) {
  const { rows } = await query(
    `SELECT operator_id, email, display_name, status
       FROM shared.kaizen_operators
      WHERE email = $1
      LIMIT 1`,
    [email],
  );
  return rows[0] || null;
}

async function createInvitedOperator({ email, displayName, createdBy }) {
  const { rows } = await query(
    `INSERT INTO shared.kaizen_operators (email, display_name, status, created_by)
     VALUES ($1, $2, 'invited', $3)
     RETURNING operator_id, email, display_name, status`,
    [email, displayName, createdBy || null],
  );
  return rows[0];
}

async function createInvite({ email, tokenHash, invitedBy, expiresAt }) {
  const { rows } = await query(
    `INSERT INTO shared.kaizen_operator_invites
       (email, token_hash, invited_by, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING invite_id, expires_at`,
    [email, tokenHash, invitedBy, expiresAt],
  );
  return rows[0];
}

async function findLiveInviteByTokenHash(tokenHash) {
  const { rows } = await query(
    `SELECT invite_id, email
       FROM shared.kaizen_operator_invites
      WHERE token_hash = $1
        AND accepted_at IS NULL
        AND expires_at > now()
      LIMIT 1`,
    [tokenHash],
  );
  return rows[0] || null;
}

async function markInviteAccepted(inviteId) {
  await query(
    `UPDATE shared.kaizen_operator_invites
        SET accepted_at = now()
      WHERE invite_id = $1`,
    [inviteId],
  );
}

async function setStatus(operatorId, status) {
  const { rows } = await query(
    `UPDATE shared.kaizen_operators
        SET status = $2, updated_at = now()
      WHERE operator_id = $1
      RETURNING operator_id, email, display_name, status`,
    [operatorId, status],
  );
  return rows[0] || null;
}

async function countActive() {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM shared.kaizen_operators WHERE status = 'active'`,
  );
  return rows[0].n;
}

module.exports = {
  listOperators,
  findByEmail,
  createInvitedOperator,
  createInvite,
  findLiveInviteByTokenHash,
  markInviteAccepted,
  setStatus,
  countActive,
};
