/**
 * Customer auth repository. Parameterised SQL only.
 * Customer principal = shared.contacts (storefront_password_hash). Refresh
 * sessions in shared.customer_sessions (we store only the sha256 of the token).
 */

"use strict";

const crypto = require("crypto");
const { query } = require("../../config/database");
const { VALID_BRANDS } = require("../../config/brands");

const sha256 = (s) =>
  crypto.createHash("sha256").update(String(s)).digest("hex");

async function findContactByEmail(email) {
  const { rows } = await query(
    `SELECT contact_id, display_name, first_name, last_name, email, primary_phone,
            storefront_password_hash, storefront_email_verified
       FROM shared.contacts
      WHERE email = $1 AND is_deleted = false
      ORDER BY created_at LIMIT 1`,
    [String(email).toLowerCase().trim()],
  );
  return rows[0] || null;
}

async function createCustomerContact({
  email,
  first_name,
  last_name,
  phone,
  password_hash,
  brand,
}) {
  const displayName =
    [first_name, last_name].filter(Boolean).join(" ").trim() || email;
  const { rows } = await query(
    `INSERT INTO shared.contacts
       (contact_type, display_name, first_name, last_name, email, primary_phone,
        storefront_password_hash, source, visible_to)
     VALUES (ARRAY['customer'], $1, $2, $3, $4, $5, $6, 'storefront_register', ARRAY[$7])
     RETURNING contact_id, display_name, first_name, last_name, email, primary_phone`,
    [
      displayName,
      first_name || null,
      last_name || null,
      String(email).toLowerCase().trim(),
      phone || null,
      password_hash,
      brand,
    ],
  );
  return rows[0];
}

async function setPasswordHash(contact_id, password_hash) {
  await query(
    `UPDATE shared.contacts SET storefront_password_hash = $2 WHERE contact_id = $1`,
    [contact_id, password_hash],
  );
}

async function getProfile(contact_id) {
  const { rows } = await query(
    `SELECT contact_id, display_name, first_name, last_name, email, primary_phone,
            storefront_email_verified
       FROM shared.contacts WHERE contact_id = $1`,
    [contact_id],
  );
  return rows[0] || null;
}

async function createSession({
  contact_id,
  refresh_token,
  user_agent,
  ip,
  ttlDays = 30,
}) {
  await query(
    `INSERT INTO shared.customer_sessions
       (contact_id, refresh_token_hash, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' days')::interval)`,
    [
      contact_id,
      sha256(refresh_token),
      user_agent || null,
      ip || null,
      String(ttlDays),
    ],
  );
}

async function findLiveSession(refresh_token) {
  const { rows } = await query(
    `SELECT session_id, contact_id FROM shared.customer_sessions
      WHERE refresh_token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [sha256(refresh_token)],
  );
  return rows[0] || null;
}

async function revokeSession(refresh_token) {
  await query(
    `UPDATE shared.customer_sessions SET revoked_at = now()
      WHERE refresh_token_hash = $1 AND revoked_at IS NULL`,
    [sha256(refresh_token)],
  );
}

// Best-effort loyalty balance for the account page. Table may not exist on every
// deploy; never let it break the profile read.
async function loyaltyPoints(contact_id) {
  try {
    const { rows } = await query(
      `SELECT points_balance FROM shared.customer_loyalty_state WHERE contact_id = $1`,
      [contact_id],
    );
    return rows[0] ? Number(rows[0].points_balance) || 0 : 0;
  } catch {
    return 0;
  }
}

async function listOrders({ brand, contact_id }) {
  if (!VALID_BRANDS.has(brand)) return [];
  const { rows } = await query(
    `SELECT order_number, status, total_ngn, display_currency, display_total,
            created_at, public_tracking_token
       FROM ${brand}.sales_orders
      WHERE contact_id = $1
      ORDER BY created_at DESC
      LIMIT 50`,
    [contact_id],
  );
  return rows;
}

module.exports = {
  findContactByEmail,
  createCustomerContact,
  setPasswordHash,
  getProfile,
  createSession,
  findLiveSession,
  revokeSession,
  loyaltyPoints,
  listOrders,
};
