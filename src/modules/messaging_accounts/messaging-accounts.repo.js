/**
 * Messaging Accounts — parameterised SQL over shared.messaging_accounts.
 *
 * One row per inbound channel address per brand. Webhook handlers in
 * smartcomm look up by (platform, external_account_id) to route the
 * inbound message to the right brand's inbox.
 */

"use strict";

const { query } = require("../../config/database");

async function list({ brand }) {
  const params = [];
  let where = "";
  if (brand) {
    params.push(brand);
    where = `WHERE business = $1`;
  }
  const { rows } = await query(
    `SELECT account_id, business, platform, external_account_id, display_name,
            webhook_verify_token, is_active, connected_by, connected_at,
            last_inbound_at, metadata,
            (access_token_enc IS NOT NULL) AS has_access_token,
            created_at, updated_at
       FROM shared.messaging_accounts
       ${where}
       ORDER BY business, platform`,
    params,
  );
  return rows;
}

async function get({ id }) {
  const { rows } = await query(
    `SELECT * FROM shared.messaging_accounts WHERE account_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function getRaw({ id }) {
  const { rows } = await query(
    `SELECT * FROM shared.messaging_accounts WHERE account_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function upsert({ brand, user_id, input, access_token_enc }) {
  const { rows } = await query(
    `INSERT INTO shared.messaging_accounts
       (business, platform, external_account_id, display_name,
        access_token_enc, webhook_verify_token, is_active,
        connected_by, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,true),$8,COALESCE($9,'{}'::jsonb))
     ON CONFLICT (platform, external_account_id) DO UPDATE
       SET business             = EXCLUDED.business,
           display_name         = EXCLUDED.display_name,
           access_token_enc     = COALESCE(EXCLUDED.access_token_enc,
                                            shared.messaging_accounts.access_token_enc),
           webhook_verify_token = EXCLUDED.webhook_verify_token,
           is_active            = EXCLUDED.is_active,
           metadata             = EXCLUDED.metadata,
           updated_at           = now()
     RETURNING account_id, business, platform, external_account_id,
               display_name, is_active,
               (access_token_enc IS NOT NULL) AS has_access_token,
               webhook_verify_token, connected_at, last_inbound_at, metadata,
               created_at, updated_at`,
    [
      brand,
      input.platform,
      input.external_account_id,
      input.display_name,
      access_token_enc || null,
      input.webhook_verify_token || null,
      input.is_active,
      user_id || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );
  return rows[0];
}

async function setActive({ id, is_active }) {
  const { rows } = await query(
    `UPDATE shared.messaging_accounts
        SET is_active = $2, updated_at = now()
      WHERE account_id = $1
      RETURNING account_id, is_active`,
    [id, is_active],
  );
  return rows[0] || null;
}

async function remove({ id }) {
  const { rows } = await query(
    `DELETE FROM shared.messaging_accounts WHERE account_id = $1 RETURNING account_id`,
    [id],
  );
  return rows[0] || null;
}

module.exports = { list, get, getRaw, upsert, setActive, remove };
