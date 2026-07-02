/**
 * Stylist Partner Programme (V2.2 §6.26) — repository for the v2 tables
 * (migration 000251): tiers, programme config, questionnaire + responses,
 * vetting reviews, referral links + attributions, stylist notifications, and
 * the quality-hold / routing queries that span the original tables.
 *
 * Parameterised SQL only — same rules as stylist.repo.js.
 */

"use strict";

const { query } = require("../../config/database");

const ex = (client) => (client ? client.query.bind(client) : query);

// ════════════════════════════════════════════════════════════
// Tiers (D-2: labels/multipliers from config, never hard-coded)
// ════════════════════════════════════════════════════════════
async function listTiers({ active_only = false } = {}) {
  const { rows } = await query(
    `SELECT * FROM shared.stylist_tiers
      ${active_only ? "WHERE is_active = true" : ""}
      ORDER BY display_order, rank`,
  );
  return rows;
}
async function findTier({ client, tier_key }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.stylist_tiers WHERE tier_key = $1`,
    [tier_key],
  );
  return rows[0] || null;
}
async function updateTier({ tier_key, patch }) {
  const allowed = [
    "label",
    "rank",
    "payout_multiplier",
    "validity_months",
    "badge_color",
    "display_order",
    "is_active",
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
  if (!sets.length) return findTier({ tier_key });
  params.push(tier_key);
  const { rows } = await query(
    `UPDATE shared.stylist_tiers SET ${sets.join(", ")}, updated_at = now()
      WHERE tier_key = $${i} RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ════════════════════════════════════════════════════════════
// Programme config
// ════════════════════════════════════════════════════════════
async function getConfig({ client, business }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.stylist_programme_config WHERE business = $1`,
    [business],
  );
  if (rows[0]) return rows[0];
  // Self-healing: the 000251 seed can only insert the row when the business
  // already exists in business_config; a brand provisioned later (or a fresh
  // DB where bootstrap runs after migrate:shared) lands here instead. Insert
  // the defaults row on first read — every column has a DB default.
  const { rows: created } = await ex(client)(
    `INSERT INTO shared.stylist_programme_config (business, portal_subdomain)
     SELECT business_key,
            CASE WHEN business_key = 'pixiegirl' THEN 'style.pixiegirlglobal.com' END
       FROM shared.business_config WHERE business_key = $1
     ON CONFLICT (business) DO NOTHING
     RETURNING *`,
    [business],
  );
  return created[0] || null;
}
async function updateConfig({ business, patch }) {
  const allowed = [
    "quality_hold_days",
    "offer_window_hours",
    "offer_top_n",
    "routing_weights",
    "referral_commission_pct",
    "applications_open",
    "contract_template_doc_id",
    "portal_subdomain",
  ];
  const sets = [];
  const params = [];
  let i = 1;
  for (const k of allowed) {
    if (patch[k] !== undefined) {
      sets.push(`${k} = $${i++}`);
      params.push(
        k === "routing_weights" ? JSON.stringify(patch[k]) : patch[k],
      );
    }
  }
  if (!sets.length) return getConfig({ business });
  params.push(business);
  const { rows } = await query(
    `UPDATE shared.stylist_programme_config
        SET ${sets.join(", ")}, updated_at = now()
      WHERE business = $${i} RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ════════════════════════════════════════════════════════════
// Questionnaire
// ════════════════════════════════════════════════════════════
async function listQuestions({ active_only = false } = {}) {
  const { rows } = await query(
    `SELECT * FROM shared.stylist_questionnaire_questions
      ${active_only ? "WHERE is_active = true" : ""}
      ORDER BY display_order, created_at`,
  );
  return rows;
}
async function findQuestion({ client, question_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.stylist_questionnaire_questions WHERE question_id = $1`,
    [question_id],
  );
  return rows[0] || null;
}
async function createQuestion({ q }) {
  const { rows } = await query(
    `INSERT INTO shared.stylist_questionnaire_questions
       (question, help_text, field_type, options, weight, is_required, display_order)
     VALUES ($1,$2,COALESCE($3,'textarea'),$4,COALESCE($5::numeric,0),
             COALESCE($6,true),COALESCE($7::int,0))
     RETURNING *`,
    [
      q.question,
      q.help_text || null,
      q.field_type || null,
      q.options ? JSON.stringify(q.options) : null,
      q.weight === undefined ? null : q.weight,
      q.is_required === undefined ? null : q.is_required,
      q.display_order === undefined ? null : q.display_order,
    ],
  );
  return rows[0];
}
async function updateQuestion({ question_id, patch }) {
  const allowed = [
    "question",
    "help_text",
    "field_type",
    "options",
    "weight",
    "is_required",
    "display_order",
    "is_active",
  ];
  const sets = [];
  const params = [];
  let i = 1;
  for (const k of allowed) {
    if (patch[k] !== undefined) {
      sets.push(`${k} = $${i++}`);
      params.push(k === "options" ? JSON.stringify(patch[k]) : patch[k]);
    }
  }
  if (!sets.length) return findQuestion({ question_id });
  params.push(question_id);
  const { rows } = await query(
    `UPDATE shared.stylist_questionnaire_questions
        SET ${sets.join(", ")}, updated_at = now()
      WHERE question_id = $${i} RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── Application responses ─────────────────────────────────
async function insertResponse({ client, stylist_id, question_id, answer }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.stylist_application_responses (stylist_id, question_id, answer)
     VALUES ($1,$2,$3::jsonb)
     ON CONFLICT (stylist_id, question_id) DO UPDATE SET answer = EXCLUDED.answer
     RETURNING *`,
    [stylist_id, question_id, JSON.stringify(answer)],
  );
  return rows[0];
}
async function listResponses({ stylist_id }) {
  const { rows } = await query(
    `SELECT r.*, q.question, q.field_type, q.weight, q.display_order
       FROM shared.stylist_application_responses r
       JOIN shared.stylist_questionnaire_questions q ON q.question_id = r.question_id
      WHERE r.stylist_id = $1
      ORDER BY q.display_order`,
    [stylist_id],
  );
  return rows;
}

// ── Vetting reviews ───────────────────────────────────────
async function addVettingReview({ client, r }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.stylist_vetting_reviews
       (stylist_id, reviewer_user_id, rubric, total_score, recommendation, notes)
     VALUES ($1,$2,$3::jsonb,$4,$5,$6) RETURNING *`,
    [
      r.stylist_id,
      r.reviewer_user_id,
      JSON.stringify(r.rubric),
      r.total_score,
      r.recommendation,
      r.notes || null,
    ],
  );
  return rows[0];
}
async function listVettingReviews({ stylist_id }) {
  const { rows } = await query(
    `SELECT v.*, u.display_name AS reviewer_name
       FROM shared.stylist_vetting_reviews v
       LEFT JOIN shared.users u ON u.user_id = v.reviewer_user_id
      WHERE v.stylist_id = $1
      ORDER BY v.created_at DESC`,
    [stylist_id],
  );
  return rows;
}

// ════════════════════════════════════════════════════════════
// Referral links + attributions (two-way earnings, Q17)
// ════════════════════════════════════════════════════════════
async function createReferralLink({ l }) {
  const { rows } = await query(
    `INSERT INTO shared.stylist_referral_links
       (stylist_id, business, code, label, target_path)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [l.stylist_id, l.business, l.code, l.label || null, l.target_path || null],
  );
  return rows[0];
}
async function listReferralLinks({ stylist_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.stylist_referral_links
      WHERE stylist_id = $1 ORDER BY created_at DESC`,
    [stylist_id],
  );
  return rows;
}
/**
 * Resolve a referral code to its owning ACTIVE partner. Accepts either a
 * per-link code or the partner's own referral_code (both namespaces are
 * checked; link codes win).
 */
async function resolveReferralCode({ client, code }) {
  const { rows } = await ex(client)(
    `SELECT p.stylist_id, p.referral_commission_pct, p.status,
            l.link_id, l.code AS link_code
       FROM shared.stylist_referral_links l
       JOIN shared.stylist_partners p ON p.stylist_id = l.stylist_id
      WHERE lower(l.code) = lower($1) AND l.is_active = true
      UNION ALL
     SELECT p.stylist_id, p.referral_commission_pct, p.status,
            NULL::uuid, NULL::text
       FROM shared.stylist_partners p
      WHERE lower(p.referral_code) = lower($1)
      LIMIT 1`,
    [code],
  );
  const hit = rows[0];
  if (!hit) return null;
  if (!["certified", "vetted"].includes(hit.status)) return null;
  return hit;
}
async function bumpReferralClicks({ link_id }) {
  await query(
    `UPDATE shared.stylist_referral_links
        SET clicks = clicks + 1, updated_at = now()
      WHERE link_id = $1`,
    [link_id],
  );
}
async function createAttribution({ client, a }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.stylist_referral_attributions
       (stylist_id, business, referral_code, order_id, order_number,
        order_total_ngn, commission_pct, commission_amount_ngn, currency,
        status, payable_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'NGN'),COALESCE($10,'pending'),$11)
     ON CONFLICT (business, order_id) DO NOTHING
     RETURNING *`,
    [
      a.stylist_id,
      a.business,
      a.referral_code,
      a.order_id,
      a.order_number || null,
      a.order_total_ngn,
      a.commission_pct,
      a.commission_amount_ngn,
      a.currency || null,
      a.status || null,
      a.payable_at || null,
    ],
  );
  return rows[0] || null;
}
async function listAttributions({ stylist_id, business, status }) {
  const where = [];
  const params = [];
  let i = 1;
  if (stylist_id) {
    where.push(`stylist_id = $${i++}`);
    params.push(stylist_id);
  }
  if (business) {
    where.push(`business = $${i++}`);
    params.push(business);
  }
  if (status) {
    where.push(`status = $${i++}`);
    params.push(status);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT * FROM shared.stylist_referral_attributions ${w}
      ORDER BY created_at DESC`,
    params,
  );
  return rows;
}
/** pending → payable once the hold window lapses. Returns flipped rows. */
async function sweepAttributionsPayable() {
  const { rows } = await query(
    `UPDATE shared.stylist_referral_attributions
        SET status = 'payable', updated_at = now()
      WHERE status = 'pending' AND payable_at IS NOT NULL AND payable_at <= now()
      RETURNING *`,
  );
  return rows;
}
async function payableAttributions({ client, stylist_id, period_end }) {
  // 'payable' plus lapsed 'pending' rows the sweep hasn't visited yet — a
  // payout run must never miss commission because the cron is behind.
  const { rows } = await ex(client)(
    `SELECT * FROM shared.stylist_referral_attributions
      WHERE stylist_id = $1 AND payout_id IS NULL
        AND (status = 'payable'
             OR (status = 'pending' AND payable_at IS NOT NULL AND payable_at <= now()))
        AND created_at::date <= $2
      ORDER BY created_at ASC`,
    [stylist_id, period_end],
  );
  return rows;
}
async function linkAttributionToPayout({ client, attribution_id, payout_id }) {
  await ex(client)(
    `UPDATE shared.stylist_referral_attributions
        SET payout_id = $2, updated_at = now()
      WHERE attribution_id = $1`,
    [attribution_id, payout_id],
  );
}
async function markAttributionsPaid({ client, payout_id }) {
  await ex(client)(
    `UPDATE shared.stylist_referral_attributions
        SET status = 'paid', updated_at = now()
      WHERE payout_id = $1 AND status IN ('pending','payable')`,
    [payout_id],
  );
}

// ════════════════════════════════════════════════════════════
// Notifications (in-portal feed)
// ════════════════════════════════════════════════════════════
async function insertNotification({ client, n }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.stylist_notifications (stylist_id, type, title, body, data)
     VALUES ($1,$2,$3,$4,COALESCE($5,'{}')::jsonb) RETURNING *`,
    [
      n.stylist_id,
      n.type,
      n.title,
      n.body || null,
      n.data ? JSON.stringify(n.data) : null,
    ],
  );
  return rows[0];
}
async function listNotifications({ stylist_id, unread_only, limit = 50 }) {
  const { rows } = await query(
    `SELECT * FROM shared.stylist_notifications
      WHERE stylist_id = $1 ${unread_only ? "AND read_at IS NULL" : ""}
      ORDER BY created_at DESC
      LIMIT $2`,
    [stylist_id, Math.min(limit, 200)],
  );
  return rows;
}
async function markNotificationRead({ stylist_id, notification_id }) {
  const { rows } = await query(
    `UPDATE shared.stylist_notifications SET read_at = now()
      WHERE notification_id = $1 AND stylist_id = $2 AND read_at IS NULL
      RETURNING *`,
    [notification_id, stylist_id],
  );
  return rows[0] || null;
}
async function markAllNotificationsRead({ stylist_id }) {
  const { rowCount } = await query(
    `UPDATE shared.stylist_notifications SET read_at = now()
      WHERE stylist_id = $1 AND read_at IS NULL`,
    [stylist_id],
  );
  return rowCount;
}
async function unreadNotificationCount({ stylist_id }) {
  const { rows } = await query(
    `SELECT count(*)::int AS c FROM shared.stylist_notifications
      WHERE stylist_id = $1 AND read_at IS NULL`,
    [stylist_id],
  );
  return rows[0].c;
}

// ════════════════════════════════════════════════════════════
// Routing candidates (Q13) — eligibility query; scoring is in the service
// ════════════════════════════════════════════════════════════
async function candidateStylists({ business, service_key }) {
  const { rows } = await query(
    `SELECT p.stylist_id, p.display_name, p.partner_code, p.city, p.state,
            p.country_code, p.latitude, p.longitude, p.service_radius_km,
            p.current_tier_key, p.avg_rating, p.rating_count,
            p.current_active_count, p.max_active_assignments,
            s.service_key, s.rate, s.duration_minutes,
            t.rank AS tier_rank, t.payout_multiplier
       FROM shared.stylist_partners p
       LEFT JOIN shared.stylist_specialities s
              ON s.stylist_id = p.stylist_id AND s.business = $1
             AND s.service_key = $2 AND s.is_active = true
       LEFT JOIN shared.stylist_tiers t ON t.tier_key = p.current_tier_key
      WHERE p.status = 'certified'
        AND p.current_active_count < p.max_active_assignments`,
    [business, service_key],
  );
  return rows;
}

// ════════════════════════════════════════════════════════════
// Quality-hold + verified reviews (Q14/Q15)
// ════════════════════════════════════════════════════════════
async function setAssignmentReviewToken({ client, assignment_id, token }) {
  await ex(client)(
    `UPDATE shared.stylist_assignments
        SET review_token = $2, updated_at = now()
      WHERE assignment_id = $1`,
    [assignment_id, token],
  );
}
async function findAssignmentByReviewToken({ client, token }) {
  const { rows } = await ex(client)(
    `SELECT a.*, p.display_name AS stylist_name, p.current_tier_key
       FROM shared.stylist_assignments a
       LEFT JOIN shared.stylist_partners p ON p.stylist_id = a.stylist_id
      WHERE a.review_token = $1`,
    [token],
  );
  return rows[0] || null;
}
/** Recompute the partner's denormalised verified-review aggregate. */
async function refreshPartnerRating({ client, stylist_id }) {
  await ex(client)(
    `UPDATE shared.stylist_partners p
        SET avg_rating = sub.avg, rating_count = sub.n, updated_at = now()
       FROM (SELECT round(avg(customer_rating)::numeric, 2) AS avg,
                    count(*)::int AS n
               FROM shared.stylist_assignments
              WHERE stylist_id = $1 AND customer_rating IS NOT NULL
                AND review_hidden = false) sub
      WHERE p.stylist_id = $1`,
    [stylist_id],
  );
}
async function listVerifiedReviews({ stylist_id, include_hidden }) {
  const where = ["a.customer_rating IS NOT NULL"];
  const params = [];
  let i = 1;
  if (stylist_id) {
    where.push(`a.stylist_id = $${i++}`);
    params.push(stylist_id);
  }
  if (!include_hidden) where.push("a.review_hidden = false");
  const { rows } = await query(
    `SELECT a.assignment_id, a.assignment_number, a.stylist_id, a.business,
            a.service_key, a.customer_rating, a.customer_review, a.reviewed_at,
            a.review_hidden, p.display_name AS stylist_name
       FROM shared.stylist_assignments a
       LEFT JOIN shared.stylist_partners p ON p.stylist_id = a.stylist_id
      WHERE ${where.join(" AND ")}
      ORDER BY a.reviewed_at DESC`,
    params,
  );
  return rows;
}
async function setReviewVisibility({ assignment_id, hidden }) {
  const { rows } = await query(
    `UPDATE shared.stylist_assignments
        SET review_hidden = $2, updated_at = now()
      WHERE assignment_id = $1 RETURNING *`,
    [assignment_id, hidden],
  );
  return rows[0] || null;
}
/** Completed assignments whose hold window has lapsed without confirmation. */
async function holdWindowLapsed() {
  const { rows } = await query(
    `SELECT assignment_id, stylist_id, business, assignment_number
       FROM shared.stylist_assignments
      WHERE status = 'completed' AND payout_id IS NULL
        AND satisfaction_confirmed_at IS NULL
        AND payable_at IS NOT NULL AND payable_at <= now()
        AND (disputed_at IS NULL OR dispute_resolved_at IS NOT NULL)`,
  );
  return rows;
}

// ════════════════════════════════════════════════════════════
// Offer expiry sweep
// ════════════════════════════════════════════════════════════
/** Pending offers on lapsed offered_pool assignments → 'expired'. */
async function expireStaleOffers() {
  const { rows } = await query(
    `UPDATE shared.stylist_assignment_offers o
        SET response = 'expired', responded_at = now()
       FROM shared.stylist_assignments a
      WHERE a.assignment_id = o.assignment_id
        AND o.response = 'pending'
        AND a.status = 'offered_pool'
        AND a.offer_expires_at < now()
      RETURNING o.assignment_id, o.stylist_id`,
  );
  return rows;
}
/** Lapsed offered_pool assignments with no acceptance → escalate to admin. */
async function escalateExpiredAssignments() {
  const { rows } = await query(
    `UPDATE shared.stylist_assignments
        SET status = 'escalated_to_admin', updated_at = now()
      WHERE status = 'offered_pool' AND offer_expires_at < now()
      RETURNING assignment_id, assignment_number, business`,
  );
  return rows;
}

// ════════════════════════════════════════════════════════════
// Certification expiry (Q12)
// ════════════════════════════════════════════════════════════
async function certificationsForReminder({ within_days, reminder_column }) {
  const { rows } = await query(
    `SELECT c.*, p.display_name, p.contact_id
       FROM shared.stylist_certifications c
       JOIN shared.stylist_partners p ON p.stylist_id = c.stylist_id
      WHERE c.is_current = true AND c.revoked_at IS NULL
        AND c.expires_at <= now() + ($1 || ' days')::interval
        AND c.expires_at > now()
        AND c.${reminder_column === "reminder_7_sent_at" ? "reminder_7_sent_at" : "reminder_30_sent_at"} IS NULL`,
    [within_days],
  );
  return rows;
}
async function markCertReminderSent({ certification_id, reminder_column }) {
  const col =
    reminder_column === "reminder_7_sent_at"
      ? "reminder_7_sent_at"
      : "reminder_30_sent_at";
  await query(
    `UPDATE shared.stylist_certifications SET ${col} = now()
      WHERE certification_id = $1`,
    [certification_id],
  );
}
/** Auto-lapse: current certs past expiry lose currency; tier clears. */
async function lapseExpiredCertifications() {
  const { rows } = await query(
    `UPDATE shared.stylist_certifications
        SET is_current = false
      WHERE is_current = true AND revoked_at IS NULL AND expires_at <= now()
      RETURNING certification_id, stylist_id, tier_key`,
  );
  for (const r of rows) {
    await query(
      `UPDATE shared.stylist_partners
          SET current_tier_key = NULL, current_tier_expires_at = NULL, updated_at = now()
        WHERE stylist_id = $1 AND current_tier_key = $2`,
      [r.stylist_id, r.tier_key],
    );
  }
  return rows;
}

// ════════════════════════════════════════════════════════════
// Credential reset tokens (invite + forgot-password)
// ════════════════════════════════════════════════════════════
async function findCredentialByStylist({ client, stylist_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.stylist_credentials WHERE stylist_id = $1`,
    [stylist_id],
  );
  return rows[0] || null;
}
async function setResetToken({ client, stylist_id, token, expires_at, invited }) {
  const { rows } = await ex(client)(
    `UPDATE shared.stylist_credentials
        SET reset_token = $2, reset_token_expires_at = $3,
            invited_at = CASE WHEN $4 THEN now() ELSE invited_at END,
            updated_at = now()
      WHERE stylist_id = $1 RETURNING credential_id, email`,
    [stylist_id, token, expires_at, Boolean(invited)],
  );
  return rows[0] || null;
}
async function findCredentialByResetToken({ token }) {
  const { rows } = await query(
    `SELECT * FROM shared.stylist_credentials
      WHERE reset_token = $1 AND reset_token_expires_at > now()`,
    [token],
  );
  return rows[0] || null;
}
async function resetPassword({ credential_id, password_hash }) {
  await query(
    `UPDATE shared.stylist_credentials
        SET password_hash = $2, reset_token = NULL, reset_token_expires_at = NULL,
            force_password_reset = false, failed_login_attempts = 0,
            locked_until = NULL, is_active = true, updated_at = now()
      WHERE credential_id = $1`,
    [credential_id, password_hash],
  );
}

// ── Contacts (application intake) ─────────────────────────
// A stylist is also a contact (stylist_partners.contact_id NOT NULL) so they
// appear in CRM/messaging. Same upsert shape as the storefront checkout.
async function findContactByEmailOrPhone({ client, email, phone }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.contacts
      WHERE is_deleted = false
        AND ( ($1::citext IS NOT NULL AND email = $1)
           OR ($2::text  IS NOT NULL AND primary_phone = $2) )
      ORDER BY created_at LIMIT 1`,
    [email || null, phone || null],
  );
  return rows[0] || null;
}
async function createContact({ client, brand, contact }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.contacts
       (contact_type, display_name, first_name, last_name, primary_phone,
        whatsapp_number, email, visible_to)
     VALUES (ARRAY['stylist'], $1, $2, $3, $4, $5, $6, ARRAY[$7])
     RETURNING *`,
    [
      contact.display_name,
      contact.first_name || null,
      contact.last_name || null,
      contact.primary_phone || null,
      contact.whatsapp_number || null,
      contact.email || null,
      brand,
    ],
  );
  return rows[0];
}
async function tagContactAsStylist({ client, contact_id }) {
  await ex(client)(
    `UPDATE shared.contacts
        SET contact_type = array_append(contact_type, 'stylist'), updated_at = now()
      WHERE contact_id = $1 AND NOT ('stylist' = ANY(contact_type))`,
    [contact_id],
  );
}

// ── Brand-schema referral capture (soft join back to the order) ──
async function findOrderReferralCode({ client, brand, order_id }) {
  const { t } = require("../../config/brands");
  const { rows } = await ex(client)(
    `SELECT order_id, order_number, total_ngn, stylist_referral_code
       FROM ${t(brand, "sales_orders")} WHERE order_id = $1`,
    [order_id],
  );
  return rows[0] || null;
}

module.exports = {
  listTiers,
  findTier,
  updateTier,
  getConfig,
  updateConfig,
  listQuestions,
  findQuestion,
  createQuestion,
  updateQuestion,
  insertResponse,
  listResponses,
  addVettingReview,
  listVettingReviews,
  createReferralLink,
  listReferralLinks,
  resolveReferralCode,
  bumpReferralClicks,
  createAttribution,
  listAttributions,
  sweepAttributionsPayable,
  payableAttributions,
  linkAttributionToPayout,
  markAttributionsPaid,
  insertNotification,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  unreadNotificationCount,
  candidateStylists,
  setAssignmentReviewToken,
  findAssignmentByReviewToken,
  refreshPartnerRating,
  listVerifiedReviews,
  setReviewVisibility,
  holdWindowLapsed,
  expireStaleOffers,
  escalateExpiredAssignments,
  certificationsForReminder,
  markCertReminderSent,
  lapseExpiredCertifications,
  findCredentialByStylist,
  setResetToken,
  findCredentialByResetToken,
  resetPassword,
  findContactByEmailOrPhone,
  createContact,
  tagContactAsStylist,
  findOrderReferralCode,
};
