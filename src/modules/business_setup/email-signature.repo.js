/**
 * Email signatures (V2.2 §6.13) — repository.
 *
 * The brand's single template lives in shared.business_config
 * (email_signature_template); the rendered per-staff signatures live in
 * shared.email_signatures (UNIQUE (user_id, business)). Parameterised SQL.
 */

"use strict";

const { ex } = require("../../config/database");
async function getTemplate({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT email_signature_template, display_name
       FROM shared.business_config WHERE business_key = $1`,
    [brand],
  );
  return rows[0] || null;
}

async function setTemplate({ client, brand, html }) {
  const { rows } = await ex(client)(
    `UPDATE shared.business_config
        SET email_signature_template = $2, updated_at = now()
      WHERE business_key = $1
      RETURNING email_signature_template`,
    [brand, html],
  );
  return rows[0] || null;
}

async function listSignatures({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.email_signatures
      WHERE business = $1 ORDER BY full_name`,
    [brand],
  );
  return rows;
}

async function getSignature({ client, brand, user_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.email_signatures
      WHERE business = $1 AND user_id = $2`,
    [brand, user_id],
  );
  return rows[0] || null;
}

/** Upsert the rendered signature for a staff member (one per user+brand). */
async function upsertSignature({ client, brand, sig }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.email_signatures
       (user_id, business, full_name, job_title, phone, html_content)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, business) DO UPDATE
       SET full_name    = EXCLUDED.full_name,
           job_title    = EXCLUDED.job_title,
           phone        = EXCLUDED.phone,
           html_content = EXCLUDED.html_content,
           template_version = shared.email_signatures.template_version + 1,
           updated_at   = now()
     RETURNING *`,
    [
      sig.user_id,
      brand,
      sig.full_name,
      sig.job_title,
      sig.phone || null,
      sig.html_content,
    ],
  );
  return rows[0];
}

module.exports = {
  getTemplate,
  setTemplate,
  listSignatures,
  getSignature,
  upsertSignature,
};
