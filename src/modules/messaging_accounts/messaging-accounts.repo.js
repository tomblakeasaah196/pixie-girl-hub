/**
 * Messaging Accounts — parameterised SQL over shared.messaging_accounts.
 *
 * One row per inbound channel address per brand. Webhook handlers in
 * smartcomm look up by (platform, external_account_id) to route the
 * inbound message to the right brand's inbox.
 *
 * As of 000289 the row also carries the FULL Meta secret set for that
 * brand's WhatsApp / IG integration — access_token_enc, app_secret_enc,
 * verify_token_enc, business_account_id_enc — plus a plaintext first4
 * of each so the UI can render a masked pill without a decrypt.
 */

"use strict";

const { query } = require("../../config/database");

// Only these fields are exposed on the list/read endpoints. The
// _enc ciphertexts never leave the backend.
const PUBLIC_COLUMNS = `
  account_id, business, platform, external_account_id, display_name,
  webhook_verify_token, is_active, connected_by, connected_at,
  last_inbound_at, metadata, notes, secrets_last_rotated_at,
  (access_token_enc         IS NOT NULL) AS has_access_token,
  (app_secret_enc           IS NOT NULL) AS has_app_secret,
  (verify_token_enc         IS NOT NULL) AS has_verify_token,
  (business_account_id_enc  IS NOT NULL) AS has_business_account_id,
  (smtp_password_enc        IS NOT NULL) AS has_smtp_password,
  access_token_first4,
  app_secret_first4,
  verify_token_first4,
  business_account_first4,
  smtp_password_first4,
  smtp_host, smtp_port, smtp_secure, smtp_user,
  from_email, from_name, reply_to_email,
  created_at, updated_at
`;

async function list({ brand }) {
  const params = [];
  let where = "";
  if (brand) {
    params.push(brand);
    where = `WHERE business = $1`;
  }
  const { rows } = await query(
    `SELECT ${PUBLIC_COLUMNS}
       FROM shared.messaging_accounts
       ${where}
       ORDER BY business, platform`,
    params,
  );
  return rows;
}

async function get({ id }) {
  const { rows } = await query(
    `SELECT ${PUBLIC_COLUMNS}
       FROM shared.messaging_accounts
      WHERE account_id = $1`,
    [id],
  );
  return rows[0] || null;
}

// getRaw is used by the internal reveal + provider ping paths — never
// serialised over the wire.
async function getRaw({ id }) {
  const { rows } = await query(
    `SELECT * FROM shared.messaging_accounts WHERE account_id = $1`,
    [id],
  );
  return rows[0] || null;
}

// Look up the active row for a brand + platform. Used by every
// outbound WhatsApp/IG call to resolve the right per-brand token.
async function findActiveByBrand({ brand, platform }) {
  const { rows } = await query(
    `SELECT * FROM shared.messaging_accounts
      WHERE business = $1 AND platform = $2 AND is_active = true
      ORDER BY updated_at DESC
      LIMIT 1`,
    [brand, platform],
  );
  return rows[0] || null;
}

// Look up by the provider's own id (phone_number_id / IG business id / page id).
// Used by the inbound webhook path — the payload only carries this id, so
// we resolve the brand + app secret from it.
async function findByExternalId({ platform, external_account_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.messaging_accounts
      WHERE platform = $1 AND external_account_id = $2
      LIMIT 1`,
    [platform, external_account_id],
  );
  return rows[0] || null;
}

async function upsert({ brand, user_id, input, secrets }) {
  // `secrets` is a pre-encrypted bundle:
  //   { access_token_enc, app_secret_enc, verify_token_enc,
  //     business_account_id_enc, smtp_password_enc, access_token_first4, ... }
  // Any missing key means "don't touch this secret" — the ON CONFLICT
  // COALESCEs the incoming value against the existing one.
  const s = secrets || {};
  const { rows } = await query(
    `INSERT INTO shared.messaging_accounts
       (business, platform, external_account_id, display_name,
        access_token_enc, app_secret_enc, verify_token_enc,
        business_account_id_enc, smtp_password_enc,
        access_token_first4, app_secret_first4, verify_token_first4,
        business_account_first4, smtp_password_first4,
        webhook_verify_token, is_active, connected_by, metadata, notes,
        smtp_host, smtp_port, smtp_secure, smtp_user,
        from_email, from_name, reply_to_email,
        secrets_last_rotated_at)
     VALUES ($1,$2,$3,$4,
             $5,$6,$7,$8,$9,
             $10,$11,$12,$13,$14,
             $15,COALESCE($16,true),$17,COALESCE($18,'{}'::jsonb),$19,
             $20,$21,COALESCE($22,false),$23,
             $24,$25,$26,
             CASE WHEN COALESCE($5,$6,$7,$8,$9) IS NOT NULL THEN now() ELSE NULL END)
     ON CONFLICT (platform, external_account_id) DO UPDATE
       SET business                = EXCLUDED.business,
           display_name            = EXCLUDED.display_name,
           access_token_enc        = COALESCE(EXCLUDED.access_token_enc,
                                              shared.messaging_accounts.access_token_enc),
           app_secret_enc          = COALESCE(EXCLUDED.app_secret_enc,
                                              shared.messaging_accounts.app_secret_enc),
           verify_token_enc        = COALESCE(EXCLUDED.verify_token_enc,
                                              shared.messaging_accounts.verify_token_enc),
           business_account_id_enc = COALESCE(EXCLUDED.business_account_id_enc,
                                              shared.messaging_accounts.business_account_id_enc),
           smtp_password_enc       = COALESCE(EXCLUDED.smtp_password_enc,
                                              shared.messaging_accounts.smtp_password_enc),
           access_token_first4     = COALESCE(EXCLUDED.access_token_first4,
                                              shared.messaging_accounts.access_token_first4),
           app_secret_first4       = COALESCE(EXCLUDED.app_secret_first4,
                                              shared.messaging_accounts.app_secret_first4),
           verify_token_first4     = COALESCE(EXCLUDED.verify_token_first4,
                                              shared.messaging_accounts.verify_token_first4),
           business_account_first4 = COALESCE(EXCLUDED.business_account_first4,
                                              shared.messaging_accounts.business_account_first4),
           smtp_password_first4    = COALESCE(EXCLUDED.smtp_password_first4,
                                              shared.messaging_accounts.smtp_password_first4),
           webhook_verify_token    = EXCLUDED.webhook_verify_token,
           is_active               = EXCLUDED.is_active,
           metadata                = EXCLUDED.metadata,
           notes                   = COALESCE(EXCLUDED.notes,
                                              shared.messaging_accounts.notes),
           smtp_host               = COALESCE(EXCLUDED.smtp_host,
                                              shared.messaging_accounts.smtp_host),
           smtp_port               = COALESCE(EXCLUDED.smtp_port,
                                              shared.messaging_accounts.smtp_port),
           smtp_secure             = COALESCE($22, shared.messaging_accounts.smtp_secure, false),
           smtp_user               = COALESCE(EXCLUDED.smtp_user,
                                              shared.messaging_accounts.smtp_user),
           from_email              = COALESCE(EXCLUDED.from_email,
                                              shared.messaging_accounts.from_email),
           from_name               = COALESCE(EXCLUDED.from_name,
                                              shared.messaging_accounts.from_name),
           reply_to_email          = COALESCE(EXCLUDED.reply_to_email,
                                              shared.messaging_accounts.reply_to_email),
           secrets_last_rotated_at = CASE
             WHEN EXCLUDED.access_token_enc        IS NOT NULL
               OR EXCLUDED.app_secret_enc          IS NOT NULL
               OR EXCLUDED.verify_token_enc        IS NOT NULL
               OR EXCLUDED.business_account_id_enc IS NOT NULL
               OR EXCLUDED.smtp_password_enc       IS NOT NULL
             THEN now()
             ELSE shared.messaging_accounts.secrets_last_rotated_at
           END,
           updated_at              = now()
     RETURNING ${PUBLIC_COLUMNS}`,
    [
      brand,
      input.platform,
      input.external_account_id,
      input.display_name,
      s.access_token_enc         || null,
      s.app_secret_enc           || null,
      s.verify_token_enc         || null,
      s.business_account_id_enc  || null,
      s.smtp_password_enc        || null,
      s.access_token_first4      || null,
      s.app_secret_first4        || null,
      s.verify_token_first4      || null,
      s.business_account_first4  || null,
      s.smtp_password_first4     || null,
      input.webhook_verify_token || null,
      input.is_active,
      user_id || null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.notes || null,
      input.smtp_host    || null,
      input.smtp_port    || null,
      input.smtp_secure === undefined ? null : input.smtp_secure,
      input.smtp_user    || null,
      input.from_email      || null,
      input.from_name       || null,
      input.reply_to_email  || null,
    ],
  );
  return rows[0];
}

// Persist the Meta App ID onto the row's metadata jsonb. The App ID is
// public (not a secret) and is needed for the resumable upload used to
// set the WhatsApp display picture. jsonb_set is surgical — it merges
// the one key without disturbing anything else in metadata.
async function setAppId({ id, app_id }) {
  const { rows } = await query(
    `UPDATE shared.messaging_accounts
        SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb),
                                 '{app_id}', to_jsonb($2::text), true),
            updated_at = now()
      WHERE account_id = $1
      RETURNING account_id, metadata`,
    [id, String(app_id)],
  );
  return rows[0] || null;
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

// Record a password-verified secret reveal for forensic audit.
async function recordReveal({ account_id, user_id, field, source_ip, request_id }) {
  await query(
    `INSERT INTO shared.messaging_account_secret_reveals
       (account_id, user_id, field, source_ip, request_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [account_id, user_id, field, source_ip || null, request_id || null],
  );
}

async function listReveals({ account_id, limit = 25 }) {
  const { rows } = await query(
    `SELECT r.reveal_id, r.field, r.revealed_at, r.source_ip,
            u.display_name, u.email
       FROM shared.messaging_account_secret_reveals r
       LEFT JOIN shared.users u ON u.user_id = r.user_id
      WHERE r.account_id = $1
      ORDER BY r.revealed_at DESC
      LIMIT $2`,
    [account_id, limit],
  );
  return rows;
}

module.exports = {
  list,
  get,
  getRaw,
  findActiveByBrand,
  findByExternalId,
  upsert,
  setAppId,
  setActive,
  remove,
  recordReveal,
  listReveals,
};
