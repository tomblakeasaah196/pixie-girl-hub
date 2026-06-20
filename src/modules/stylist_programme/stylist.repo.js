/**
 * Stylist Partner Programme (V2.2 §6.26) — repository.
 *
 * ALL tables live in `shared` — a stylist is an external partner who can take
 * assignments from any brand. Per-brand scoping is via the `business` column
 * on stylist_specialities and stylist_assignments. Partners, credentials,
 * certifications and payouts are global to the stylist.
 */

"use strict";

const { query } = require("../../config/database");
const { t } = require("../../config/brands");

const ex = (client) => (client ? client.query.bind(client) : query);

// ── Cross-module: per-brand service_jobs (production §6.24) ──
// The styling assignment routes a service_job to an external partner; on
// acceptance the stylist is written back onto the job.
async function getServiceJob({ client, brand, job_id }) {
  const { rows } = await ex(client)(
    `SELECT job_id, customer_contact_id, assigned_stylist_id, assigned_staff_user_id,
            service_type_id, agreed_cost_ngn, scheduled_for, status
       FROM ${t(brand, "service_jobs")} WHERE job_id = $1`,
    [job_id],
  );
  return rows[0] || null;
}
async function linkServiceJobStylist({ client, brand, job_id, stylist_id }) {
  await ex(client)(
    `UPDATE ${t(brand, "service_jobs")}
        SET assigned_stylist_id = $2, updated_at = now()
      WHERE job_id = $1`,
    [job_id, stylist_id],
  );
}

// ════════════════════════════════════════════════════════════
// Partners
// ════════════════════════════════════════════════════════════
async function createPartner({ client, p }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.stylist_partners
       (partner_code, contact_id, display_name, country_code, city, state,
        latitude, longitude, service_radius_km, max_active_assignments,
        payout_currency, bio, portfolio_url)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,25),COALESCE($10,5),
             COALESCE($11,'NGN'),$12,$13)
     RETURNING *`,
    [
      p.partner_code,
      p.contact_id,
      p.display_name,
      p.country_code,
      p.city,
      p.state || null,
      p.latitude || null,
      p.longitude || null,
      p.service_radius_km === undefined ? null : p.service_radius_km,
      p.max_active_assignments === undefined ? null : p.max_active_assignments,
      p.payout_currency || null,
      p.bio || null,
      p.portfolio_url || null,
    ],
  );
  return rows[0];
}
async function listPartners({ status, country_code, city, contact_id }) {
  const where = [];
  const params = [];
  let i = 1;
  if (status) {
    where.push(`status = $${i++}`);
    params.push(status);
  }
  if (contact_id) {
    where.push(`contact_id = $${i++}`);
    params.push(contact_id);
  }
  if (country_code) {
    where.push(`country_code = $${i++}`);
    params.push(country_code);
  }
  if (city) {
    where.push(`city ILIKE $${i++}`);
    params.push(city);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT * FROM shared.stylist_partners ${w} ORDER BY created_at DESC`,
    params,
  );
  return rows;
}
async function findPartner({ client, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.stylist_partners WHERE stylist_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function findPartnerByContact({ client, contact_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.stylist_partners WHERE contact_id = $1`,
    [contact_id],
  );
  return rows[0] || null;
}
async function findPartnerByBadge({ token }) {
  const { rows } = await query(
    `SELECT stylist_id, partner_code, display_name, status, city, country_code,
            current_tier_key, current_tier_expires_at, badge_token, badge_revoked_at,
            portfolio_url, bio
       FROM shared.stylist_partners
      WHERE badge_token = $1`,
    [token],
  );
  return rows[0] || null;
}
async function updatePartner({ client, id, patch }) {
  const allowed = [
    "display_name",
    "country_code",
    "city",
    "state",
    "latitude",
    "longitude",
    "service_radius_km",
    "max_active_assignments",
    "payout_currency",
    "payout_bank_name",
    "payout_account_number",
    "payout_account_name",
    "paystack_recipient_code",
    "bio",
    "portfolio_url",
  ];
  const sets = [];
  const params = [];
  let i = 1;
  for (const k of allowed) {
    if (patch[k] !== undefined) {
      sets.push(`${k} = $${i++}`);
      params.push(patch[k]);
    }
  }
  if (!sets.length) return findPartner({ client, id });
  params.push(id);
  const { rows } = await ex(client)(
    `UPDATE shared.stylist_partners SET ${sets.join(", ")}, updated_at = now()
      WHERE stylist_id = $${i} RETURNING *`,
    params,
  );
  return rows[0] || null;
}
async function setPartnerStatus({ client, id, status, fields = {} }) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = $${i++}`);
    params.push(v);
  }
  const { rows } = await ex(client)(
    `UPDATE shared.stylist_partners SET ${sets.join(", ")}, updated_at = now()
      WHERE stylist_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}
async function setBadge({ client, id, badge_token, revoked }) {
  const { rows } = await ex(client)(
    `UPDATE shared.stylist_partners
        SET badge_token = $2,
            badge_revoked_at = $3,
            updated_at = now()
      WHERE stylist_id = $1 RETURNING stylist_id, badge_token, badge_revoked_at`,
    [id, badge_token, revoked ? new Date().toISOString() : null],
  );
  return rows[0] || null;
}
async function setCurrentTier({ client, id, tier_key, expires_at }) {
  const { rows } = await ex(client)(
    `UPDATE shared.stylist_partners
        SET current_tier_key = $2, current_tier_expires_at = $3, updated_at = now()
      WHERE stylist_id = $1 RETURNING *`,
    [id, tier_key, expires_at || null],
  );
  return rows[0] || null;
}
async function bumpActiveCount({ client, id, delta }) {
  const { rows } = await ex(client)(
    `UPDATE shared.stylist_partners
        SET current_active_count = GREATEST(0, current_active_count + $2), updated_at = now()
      WHERE stylist_id = $1 RETURNING current_active_count`,
    [id, delta],
  );
  return rows[0] || null;
}

// ════════════════════════════════════════════════════════════
// Credentials (portal login)
// ════════════════════════════════════════════════════════════
async function createCredential({ client, c }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.stylist_credentials (stylist_id, email, password_hash)
     VALUES ($1,$2,$3) RETURNING credential_id, stylist_id, email, is_active, force_password_reset`,
    [c.stylist_id, c.email, c.password_hash],
  );
  return rows[0];
}
async function findCredentialByEmail({ email }) {
  const { rows } = await query(
    `SELECT * FROM shared.stylist_credentials WHERE email = $1`,
    [email],
  );
  return rows[0] || null;
}
async function recordCredentialLogin({ stylist_id, ip }) {
  await query(
    `UPDATE shared.stylist_credentials
        SET last_login_at = now(), last_login_ip = $2, failed_login_attempts = 0
      WHERE stylist_id = $1`,
    [stylist_id, ip || null],
  );
}
async function recordCredentialFailure({ credential_id }) {
  await query(
    `UPDATE shared.stylist_credentials
        SET failed_login_attempts = failed_login_attempts + 1,
            locked_until = CASE WHEN failed_login_attempts + 1 >= 5
                                THEN now() + interval '15 minutes' ELSE locked_until END
      WHERE credential_id = $1`,
    [credential_id],
  );
}

// ════════════════════════════════════════════════════════════
// Specialities (per-brand rates)
// ════════════════════════════════════════════════════════════
async function listSpecialities({ stylist_id, business }) {
  const where = ["stylist_id = $1"];
  const params = [stylist_id];
  let i = 2;
  if (business) {
    where.push(`business = $${i++}`);
    params.push(business);
  }
  const { rows } = await query(
    `SELECT * FROM shared.stylist_specialities WHERE ${where.join(" AND ")} ORDER BY service_key`,
    params,
  );
  return rows;
}
async function findSpeciality({ client, stylist_id, business, service_key }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.stylist_specialities
      WHERE stylist_id = $1 AND business = $2 AND service_key = $3`,
    [stylist_id, business, service_key],
  );
  return rows[0] || null;
}
async function upsertSpeciality({ client, s }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.stylist_specialities
       (stylist_id, business, service_key, display_name, rate, duration_minutes,
        pending_admin_review)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,false))
     ON CONFLICT (stylist_id, business, service_key) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           rate = EXCLUDED.rate,
           duration_minutes = EXCLUDED.duration_minutes,
           pending_admin_review = EXCLUDED.pending_admin_review,
           is_active = true,
           updated_at = now()
     RETURNING *`,
    [
      s.stylist_id,
      s.business,
      s.service_key,
      s.display_name,
      s.rate,
      s.duration_minutes === undefined ? null : s.duration_minutes,
      s.pending_admin_review === undefined ? null : s.pending_admin_review,
    ],
  );
  return rows[0];
}
async function deactivateSpeciality({ id }) {
  const { rows } = await query(
    `UPDATE shared.stylist_specialities SET is_active = false, updated_at = now()
      WHERE speciality_id = $1 RETURNING speciality_id`,
    [id],
  );
  return rows[0] || null;
}

// ════════════════════════════════════════════════════════════
// Certifications
// ════════════════════════════════════════════════════════════
async function listCertifications({ stylist_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.stylist_certifications
      WHERE stylist_id = $1 ORDER BY awarded_at DESC`,
    [stylist_id],
  );
  return rows;
}
async function supersedeCurrentCerts({ client, stylist_id }) {
  await ex(client)(
    `UPDATE shared.stylist_certifications SET is_current = false
      WHERE stylist_id = $1 AND is_current = true`,
    [stylist_id],
  );
}
async function addCertification({ client, c }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.stylist_certifications
       (stylist_id, tier_key, awarded_by, expires_at, document_id,
        assessment_score, assessment_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      c.stylist_id,
      c.tier_key,
      c.awarded_by,
      c.expires_at,
      c.document_id || null,
      c.assessment_score === undefined ? null : c.assessment_score,
      c.assessment_notes || null,
    ],
  );
  return rows[0];
}
async function revokeCertification({ client, id, revoked_by, reason }) {
  const { rows } = await ex(client)(
    `UPDATE shared.stylist_certifications
        SET revoked_at = now(), revoked_by = $2, revoked_reason = $3, is_current = false
      WHERE certification_id = $1 RETURNING *`,
    [id, revoked_by || null, reason || null],
  );
  return rows[0] || null;
}
async function expiringCertifications({ within_days = 30 }) {
  const { rows } = await query(
    `SELECT * FROM shared.stylist_certifications
      WHERE is_current = true AND revoked_at IS NULL
        AND expires_at <= now() + ($1 || ' days')::interval
      ORDER BY expires_at ASC`,
    [within_days],
  );
  return rows;
}

// ════════════════════════════════════════════════════════════
// Assignments + offers
// ════════════════════════════════════════════════════════════
async function createAssignment({ client, a }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.stylist_assignments
       (assignment_number, business, customer_contact_id, reference_type,
        reference_id, service_key, offer_expires_at, base_rate,
        platform_fee_pct, payout_currency, scheduled_at, service_address)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,0),$10,$11,$12)
     RETURNING *`,
    [
      a.assignment_number,
      a.business,
      a.customer_contact_id,
      a.reference_type,
      a.reference_id,
      a.service_key,
      a.offer_expires_at,
      a.base_rate === undefined ? null : a.base_rate,
      a.platform_fee_pct === undefined ? null : a.platform_fee_pct,
      a.payout_currency || null,
      a.scheduled_at || null,
      a.service_address ? JSON.stringify(a.service_address) : null,
    ],
  );
  return rows[0];
}
async function findAssignment({ client, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.stylist_assignments WHERE assignment_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function listAssignments({
  business,
  stylist_id,
  status,
  customer_contact_id,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (business) {
    where.push(`business = $${i++}`);
    params.push(business);
  }
  if (stylist_id) {
    where.push(`stylist_id = $${i++}`);
    params.push(stylist_id);
  }
  if (status) {
    where.push(`status = $${i++}`);
    params.push(status);
  }
  if (customer_contact_id) {
    where.push(`customer_contact_id = $${i++}`);
    params.push(customer_contact_id);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT * FROM shared.stylist_assignments ${w} ORDER BY created_at DESC`,
    params,
  );
  return rows;
}
async function setAssignmentStatus({ client, id, status, fields = {} }) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = $${i++}`);
    params.push(v);
  }
  const { rows } = await ex(client)(
    `UPDATE shared.stylist_assignments SET ${sets.join(", ")}, updated_at = now()
      WHERE assignment_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}
async function createOffer({ client, assignment_id, stylist_id }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.stylist_assignment_offers (assignment_id, stylist_id)
     VALUES ($1,$2)
     ON CONFLICT (assignment_id, stylist_id) DO NOTHING
     RETURNING *`,
    [assignment_id, stylist_id],
  );
  return rows[0] || null;
}
async function listOffersForAssignment({ client, assignment_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.stylist_assignment_offers WHERE assignment_id = $1`,
    [assignment_id],
  );
  return rows;
}
async function findOffer({ client, assignment_id, stylist_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.stylist_assignment_offers
      WHERE assignment_id = $1 AND stylist_id = $2`,
    [assignment_id, stylist_id],
  );
  return rows[0] || null;
}
async function respondOffer({
  client,
  assignment_id,
  stylist_id,
  response,
  decline_reason,
}) {
  const { rows } = await ex(client)(
    `UPDATE shared.stylist_assignment_offers
        SET response = $3, responded_at = now(), decline_reason = $4
      WHERE assignment_id = $1 AND stylist_id = $2 RETURNING *`,
    [assignment_id, stylist_id, response, decline_reason || null],
  );
  return rows[0] || null;
}
async function supersedeOtherOffers({
  client,
  assignment_id,
  winner_stylist_id,
}) {
  await ex(client)(
    `UPDATE shared.stylist_assignment_offers
        SET response = 'superseded', responded_at = now()
      WHERE assignment_id = $1 AND stylist_id <> $2 AND response = 'pending'`,
    [assignment_id, winner_stylist_id],
  );
}
async function listOpenOffersForStylist({ stylist_id }) {
  const { rows } = await query(
    `SELECT o.*, a.assignment_number, a.business, a.service_key, a.offer_expires_at,
            a.base_rate, a.scheduled_at, a.service_address, a.status AS assignment_status
       FROM shared.stylist_assignment_offers o
       JOIN shared.stylist_assignments a ON a.assignment_id = o.assignment_id
      WHERE o.stylist_id = $1 AND o.response = 'pending'
        AND a.status = 'offered_pool' AND a.offer_expires_at >= now()
      ORDER BY a.offer_expires_at ASC`,
    [stylist_id],
  );
  return rows;
}

// ════════════════════════════════════════════════════════════
// Payouts
// ════════════════════════════════════════════════════════════
async function completedUnpaidAssignments({
  client,
  stylist_id,
  period_start,
  period_end,
}) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.stylist_assignments
      WHERE stylist_id = $1 AND status = 'completed' AND payout_id IS NULL
        AND completed_at::date BETWEEN $2 AND $3
      ORDER BY completed_at ASC`,
    [stylist_id, period_start, period_end],
  );
  return rows;
}
async function createPayout({ client, p }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.stylist_payouts
       (payout_number, stylist_id, period_start, period_end, currency,
        gross_amount, platform_fee_amount, adjustments_amount, net_amount,
        amount_ngn, fx_rate_used, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,0),$9,COALESCE($10,0),$11,$12)
     RETURNING *`,
    [
      p.payout_number,
      p.stylist_id,
      p.period_start,
      p.period_end,
      p.currency,
      p.gross_amount,
      p.platform_fee_amount,
      p.adjustments_amount === undefined ? null : p.adjustments_amount,
      p.net_amount,
      p.amount_ngn === undefined ? null : p.amount_ngn,
      p.fx_rate_used || null,
      p.created_by || null,
    ],
  );
  return rows[0];
}
async function addPayoutLine({ client, line }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.stylist_payout_lines
       (payout_id, assignment_id, gross_amount, platform_fee_amount, net_amount, description)
     VALUES ($1,$2,$3,COALESCE($4,0),$5,$6) RETURNING *`,
    [
      line.payout_id,
      line.assignment_id,
      line.gross_amount,
      line.platform_fee_amount,
      line.net_amount,
      line.description || null,
    ],
  );
  return rows[0];
}
async function linkAssignmentToPayout({ client, assignment_id, payout_id }) {
  await ex(client)(
    `UPDATE shared.stylist_assignments SET payout_id = $2, updated_at = now()
      WHERE assignment_id = $1`,
    [assignment_id, payout_id],
  );
}
async function listPayouts({ stylist_id, status }) {
  const where = [];
  const params = [];
  let i = 1;
  if (stylist_id) {
    where.push(`stylist_id = $${i++}`);
    params.push(stylist_id);
  }
  if (status) {
    where.push(`status = $${i++}`);
    params.push(status);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT * FROM shared.stylist_payouts ${w} ORDER BY period_end DESC`,
    params,
  );
  return rows;
}
async function findPayout({ client, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.stylist_payouts WHERE payout_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { rows: lines } = await ex(client)(
    `SELECT * FROM shared.stylist_payout_lines WHERE payout_id = $1`,
    [id],
  );
  return { ...rows[0], lines };
}
async function setPayoutStatus({ client, id, status, fields = {} }) {
  const sets = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = $${i++}`);
    params.push(v);
  }
  const { rows } = await ex(client)(
    `UPDATE shared.stylist_payouts SET ${sets.join(", ")}, updated_at = now()
      WHERE payout_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

module.exports = {
  getServiceJob,
  linkServiceJobStylist,
  createPartner,
  listPartners,
  findPartner,
  findPartnerByContact,
  findPartnerByBadge,
  updatePartner,
  setPartnerStatus,
  setBadge,
  setCurrentTier,
  bumpActiveCount,
  createCredential,
  findCredentialByEmail,
  recordCredentialLogin,
  recordCredentialFailure,
  listSpecialities,
  findSpeciality,
  upsertSpeciality,
  deactivateSpeciality,
  listCertifications,
  supersedeCurrentCerts,
  addCertification,
  revokeCertification,
  expiringCertifications,
  createAssignment,
  findAssignment,
  listAssignments,
  setAssignmentStatus,
  createOffer,
  listOffersForAssignment,
  findOffer,
  respondOffer,
  supersedeOtherOffers,
  listOpenOffersForStylist,
  completedUnpaidAssignments,
  createPayout,
  addPayoutLine,
  linkAssignmentToPayout,
  listPayouts,
  findPayout,
  setPayoutStatus,
};
