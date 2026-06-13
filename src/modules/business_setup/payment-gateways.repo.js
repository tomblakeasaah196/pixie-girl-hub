/**
 * Payment-gateway configuration repository (B / PD §6.21).
 * shared.payment_gateways — per-business, per-provider. Credentials are stored
 * encrypted (credentials_enc); this repo never decrypts — the service does.
 * Parameterised SQL only.
 */

"use strict";

const { query } = require("../../config/database");

const ex = (c) => (c ? c.query.bind(c) : query);

async function list({ brand }) {
  const { rows } = await query(
    `SELECT gateway_id, business, provider, is_active, role,
            (credentials_enc IS NOT NULL) AS has_credentials,
            supported_currencies, display_label, configured_by,
            created_at, updated_at
       FROM shared.payment_gateways
      WHERE business = $1
      ORDER BY provider`,
    [brand],
  );
  return rows;
}

async function getRaw({ client, brand, provider }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.payment_gateways WHERE business = $1 AND provider = $2`,
    [brand, provider],
  );
  return rows[0] || null;
}

async function activeForCurrency({ brand, ngn }) {
  // NGN gateways are the local pair (paystack/opay) ordered primary-first;
  // non-NGN resolves to stripe. nomba is POS (excluded from online chain).
  const { rows } = await query(
    `SELECT * FROM shared.payment_gateways
      WHERE business = $1 AND is_active = true
        AND ( ($2::boolean AND provider IN ('paystack','opay'))
           OR (NOT $2::boolean AND provider = 'stripe') )
      ORDER BY CASE role WHEN 'primary' THEN 0 WHEN 'fallback' THEN 1 ELSE 2 END,
               provider`,
    [brand, ngn],
  );
  return rows;
}

async function upsert({ client, brand, row, configured_by }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.payment_gateways
       (business, provider, is_active, role, credentials_enc,
        supported_currencies, display_label, configured_by)
     VALUES ($1,$2,COALESCE($3,true),COALESCE($4,'standalone'),$5,
             COALESCE($6,ARRAY['NGN']),$7,$8)
     ON CONFLICT (business, provider) DO UPDATE
       SET is_active = COALESCE(EXCLUDED.is_active, shared.payment_gateways.is_active),
           role = COALESCE(EXCLUDED.role, shared.payment_gateways.role),
           credentials_enc = COALESCE(EXCLUDED.credentials_enc, shared.payment_gateways.credentials_enc),
           supported_currencies = COALESCE(EXCLUDED.supported_currencies, shared.payment_gateways.supported_currencies),
           display_label = COALESCE(EXCLUDED.display_label, shared.payment_gateways.display_label),
           configured_by = EXCLUDED.configured_by,
           updated_at = now()
     RETURNING *`,
    [
      brand,
      row.provider,
      row.is_active === undefined ? null : row.is_active,
      row.role || null,
      row.credentials_enc || null,
      row.supported_currencies || null,
      row.display_label || null,
      configured_by || null,
    ],
  );
  return rows[0];
}

// Demote any existing active primary for this brand (so a new primary is unique).
async function demoteExistingPrimary({ client, brand, exceptProvider }) {
  await ex(client)(
    `UPDATE shared.payment_gateways
        SET role = 'fallback', updated_at = now()
      WHERE business = $1 AND role = 'primary' AND is_active = true
        AND provider <> $2`,
    [brand, exceptProvider || ""],
  );
}

async function setFields({ client, brand, provider, fields }) {
  const sets = [];
  const params = [brand, provider];
  let i = 3;
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = $${i++}`);
    params.push(v);
  }
  if (!sets.length) return getRaw({ client, brand, provider });
  const { rows } = await ex(client)(
    `UPDATE shared.payment_gateways SET ${sets.join(", ")}, updated_at = now()
      WHERE business = $1 AND provider = $2 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function remove({ brand, provider }) {
  const { rows } = await query(
    `DELETE FROM shared.payment_gateways WHERE business = $1 AND provider = $2 RETURNING gateway_id`,
    [brand, provider],
  );
  return rows[0] || null;
}

module.exports = {
  list,
  getRaw,
  activeForCurrency,
  upsert,
  demoteExistingPrimary,
  setFields,
  remove,
};
