/**
 * Customer Onboarding — parameterised SQL.
 */

"use strict";

const { query } = require("../../config/database");

const ex = (c) => (c ? c.query.bind(c) : query);

async function createLink({ client, link }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.customer_onboarding_submissions
       (token, business, channel_id, seed_payload, source, created_by)
     VALUES ($1,$2,$3,COALESCE($4,'{}'::jsonb),COALESCE($5,'online'),$6)
     RETURNING *`,
    [
      link.token,
      link.business,
      link.channel_id || null,
      link.seed_payload ? JSON.stringify(link.seed_payload) : null,
      link.source || null,
      link.created_by || null,
    ],
  );
  return rows[0];
}

async function findByToken({ token }) {
  const { rows } = await query(
    `SELECT * FROM shared.customer_onboarding_submissions WHERE token = $1`,
    [token],
  );
  return rows[0] || null;
}

async function listAdmin({ brand, limit = 50, offset = 0 }) {
  const params = [];
  let where = "";
  if (brand) {
    params.push(brand);
    where = `WHERE business = $1`;
  }
  params.push(limit, offset);
  const { rows } = await query(
    `SELECT s.submission_id, s.token, s.business, s.channel_id,
            s.contact_id, s.created_at, s.completed_at, s.expires_at,
            COALESCE(c.display_name, s.payload->>'display_name', 'New customer') AS display_name
       FROM shared.customer_onboarding_submissions s
       LEFT JOIN shared.contacts c ON c.contact_id = s.contact_id
       ${where}
       ORDER BY s.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return rows;
}

async function markCompleted({ client, submission_id, payload, contact_id, ip }) {
  const { rows } = await ex(client)(
    `UPDATE shared.customer_onboarding_submissions
        SET payload      = $2,
            contact_id   = $3,
            submitted_ip = $4,
            completed_at = now()
      WHERE submission_id = $1 RETURNING *`,
    [
      submission_id,
      JSON.stringify(payload || {}),
      contact_id || null,
      ip || null,
    ],
  );
  return rows[0] || null;
}

async function upsertContactAddress({ client, addr }) {
  // One default delivery address per contact — flip is_default off on
  // any existing default before inserting / updating.
  if (addr.is_default) {
    await ex(client)(
      `UPDATE shared.contact_addresses
          SET is_default = false
        WHERE contact_id = $1 AND address_type = $2`,
      [addr.contact_id, addr.address_type || "delivery"],
    );
  }
  const { rows } = await ex(client)(
    `INSERT INTO shared.contact_addresses
       (contact_id, address_type, line1, line2, area, city, state, country,
        country_code, postal_code, landmark, recipient_name, recipient_phone,
        google_maps_url, latitude, longitude, is_default, created_by)
     VALUES ($1,COALESCE($2,'delivery'),$3,$4,$5,COALESCE($6,'Lagos'),
             COALESCE($7,'Lagos'),COALESCE($8,'Nigeria'),COALESCE($9,'NG'),
             $10,$11,$12,$13,$14,$15,$16,COALESCE($17,true),$18)
     RETURNING *`,
    [
      addr.contact_id,
      addr.address_type,
      addr.line1,
      addr.line2 || null,
      addr.area || null,
      addr.city || null,
      addr.state || null,
      addr.country || null,
      addr.country_code || null,
      addr.postal_code || null,
      addr.landmark || null,
      addr.recipient_name || null,
      addr.recipient_phone || null,
      addr.google_maps_url || null,
      addr.latitude || null,
      addr.longitude || null,
      addr.is_default,
      addr.created_by || null,
    ],
  );
  return rows[0];
}

async function updateContactFromPayload({ client, contact_id, p }) {
  await ex(client)(
    `UPDATE shared.contacts
        SET first_name      = COALESCE($2, first_name),
            last_name       = COALESCE($3, last_name),
            display_name    = COALESCE($4, display_name),
            email           = COALESCE($5, email),
            primary_phone   = COALESCE($6, primary_phone),
            whatsapp_number = COALESCE($7, whatsapp_number),
            date_of_birth   = COALESCE($8, date_of_birth)
      WHERE contact_id = $1`,
    [
      contact_id,
      p.first_name || null,
      p.last_name || null,
      p.display_name || null,
      p.email ? p.email.toLowerCase() : null,
      p.primary_phone || null,
      p.whatsapp_number || null,
      p.date_of_birth || null,
    ],
  );
}

module.exports = {
  createLink,
  findByToken,
  listAdmin,
  markCompleted,
  upsertContactAddress,
  updateContactFromPayload,
};
