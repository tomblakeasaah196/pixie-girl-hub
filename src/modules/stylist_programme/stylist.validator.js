/**
 * Stylist Partner Programme (V2.2 §6.26) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const partnerCreate = z
  .object({
    contact_id: z.string().uuid(),
    display_name: z.string().min(1).max(160),
    country_code: z.string().min(2).max(3),
    city: z.string().min(1).max(120),
    state: z.string().max(120).optional(),
    latitude: z.coerce.number().optional(),
    longitude: z.coerce.number().optional(),
    service_radius_km: z.coerce.number().int().positive().optional(),
    max_active_assignments: z.coerce.number().int().positive().optional(),
    payout_currency: z.string().length(3).optional(),
    bio: z.string().max(2000).optional(),
    portfolio_url: z.string().url().max(500).optional(),
    login_email: z.string().email().optional(),
    login_password: z.string().min(8).max(200).optional(),
  })
  .strict();

const partnerUpdate = z
  .object({
    display_name: z.string().min(1).max(160).optional(),
    country_code: z.string().min(2).max(3).optional(),
    city: z.string().min(1).max(120).optional(),
    state: z.string().max(120).optional(),
    latitude: z.coerce.number().optional(),
    longitude: z.coerce.number().optional(),
    service_radius_km: z.coerce.number().int().positive().optional(),
    max_active_assignments: z.coerce.number().int().positive().optional(),
    payout_currency: z.string().length(3).optional(),
    payout_bank_name: z.string().max(160).optional(),
    payout_account_number: z.string().max(64).optional(),
    payout_account_name: z.string().max(160).optional(),
    paystack_recipient_code: z.string().max(120).optional(),
    bio: z.string().max(2000).optional(),
    portfolio_url: z.string().url().max(500).optional(),
    instagram_url: z.string().url().max(500).optional(),
    youtube_url: z.string().url().max(500).optional(),
    website_url: z.string().url().max(500).optional(),
    probation_ends_at: z.string().datetime().nullable().optional(),
    referral_commission_pct: z.coerce.number().min(0).max(100).nullable().optional(),
    vetting_decision_note: z.string().max(2000).optional(),
  })
  .strict();

const statusChange = z
  .object({
    status: z.enum([
      "applicant",
      "vetting",
      "vetted",
      "certified",
      "suspended",
      "terminated",
    ]),
    reason: z.string().max(1000).optional(),
  })
  .strict();

const specialitySet = z
  .object({
    service_key: z.string().min(1).max(60),
    display_name: z.string().min(1).max(160),
    rate: z.coerce.number().nonnegative(),
    duration_minutes: z.coerce.number().int().positive().optional(),
    pending_admin_review: z.boolean().optional(),
  })
  .strict();

const certAward = z
  .object({
    tier_key: z.string().min(1).max(40),
    expires_at: z.string().datetime(),
    document_id: z.string().uuid().optional(),
    assessment_score: z.coerce.number().min(0).max(100).optional(),
    assessment_notes: z.string().max(2000).optional(),
  })
  .strict();

const assignmentOpen = z
  .object({
    customer_contact_id: z.string().uuid(),
    reference_type: z.enum([
      "sales_order",
      "service_booking",
      "production_run",
    ]),
    reference_id: z.string().uuid(),
    service_key: z.string().min(1).max(60),
    base_rate: z.coerce.number().nonnegative().optional(),
    platform_fee_pct: z.coerce.number().min(0).max(100).optional(),
    payout_currency: z.string().length(3).optional(),
    offer_window_hours: z.coerce.number().int().positive().max(720).optional(),
    offer_expires_at: z.string().datetime().optional(),
    scheduled_at: z.string().datetime().optional(),
    service_address: z.record(z.any()).optional(),
    candidate_stylist_ids: z.array(z.string().uuid()).optional(),
    // Routing target (Q13) — used when candidates are not hand-picked.
    auto_offer: z.boolean().optional(),
    offer_top_n: z.coerce.number().int().positive().max(20).optional(),
    city: z.string().max(120).optional(),
    state: z.string().max(120).optional(),
    country_code: z.string().min(2).max(3).optional(),
    latitude: z.coerce.number().optional(),
    longitude: z.coerce.number().optional(),
  })
  .strict();

const payoutGenerate = z
  .object({
    stylist_id: z.string().uuid(),
    period_start: z.string().date(),
    period_end: z.string().date(),
  })
  .strict();

const ratingBody = z
  .object({
    rating: z.coerce.number().int().min(1).max(5),
    review: z.string().max(2000).optional(),
  })
  .strict();

const reasonBody = z
  .object({ reason: z.string().max(1000).optional() })
  .strict();
const paidBody = z
  .object({ transfer_code: z.string().max(120).optional() })
  .strict();
const loginBody = z
  .object({ email: z.string().email(), password: z.string().min(1).max(200) })
  .strict();

// ── v2 additions (applications, vetting, config, referrals, portal) ──
const publicApply = z
  .object({
    display_name: z.string().min(1).max(160),
    first_name: z.string().max(80).optional(),
    last_name: z.string().max(80).optional(),
    email: z.string().email().max(200),
    phone: z.string().max(40).optional(),
    whatsapp_number: z.string().max(40).optional(),
    country_code: z.string().min(2).max(3),
    city: z.string().min(1).max(120),
    state: z.string().max(120).optional(),
    latitude: z.coerce.number().optional(),
    longitude: z.coerce.number().optional(),
    bio: z.string().max(2000).optional(),
    portfolio_url: z.string().url().max(500).optional(),
    instagram_url: z.string().url().max(500).optional(),
    youtube_url: z.string().url().max(500).optional(),
    website_url: z.string().url().max(500).optional(),
    answers: z
      .array(
        z.object({
          question_id: z.string().uuid(),
          answer: z.union([z.string().max(4000), z.boolean()]),
        }),
      )
      .max(50)
      .optional(),
  })
  .passthrough(); // multipart fields may include file placeholders

const vettingReview = z
  .object({
    rubric: z
      .array(
        z.object({
          criterion: z.string().min(1).max(200),
          score: z.coerce.number().min(0).max(100),
          max: z.coerce.number().positive().max(100),
        }),
      )
      .min(1)
      .max(20),
    recommendation: z.enum(["advance", "reject", "hold"]),
    notes: z.string().max(4000).optional(),
  })
  .strict();

const applicationDecision = z
  .object({
    decision: z.enum(["start_vetting", "approve", "reject"]),
    probation_months: z.coerce.number().int().min(0).max(24).optional(),
    note: z.string().max(2000).optional(),
  })
  .strict();

const configPatch = z
  .object({
    quality_hold_days: z.coerce.number().int().min(0).max(90).optional(),
    offer_window_hours: z.coerce.number().int().positive().max(720).optional(),
    offer_top_n: z.coerce.number().int().positive().max(20).optional(),
    routing_weights: z
      .object({
        distance: z.coerce.number().min(0).max(100),
        tier: z.coerce.number().min(0).max(100),
        rating: z.coerce.number().min(0).max(100),
        capacity: z.coerce.number().min(0).max(100),
        specialty: z.coerce.number().min(0).max(100),
      })
      .optional(),
    referral_commission_pct: z.coerce.number().min(0).max(100).optional(),
    applications_open: z.boolean().optional(),
    contract_template_doc_id: z.string().uuid().nullable().optional(),
    portal_subdomain: z.string().max(200).optional(),
  })
  .strict();

const tierPatch = z
  .object({
    label: z.string().min(1).max(80).optional(),
    rank: z.coerce.number().int().min(1).max(20).optional(),
    payout_multiplier: z.coerce.number().positive().max(10).optional(),
    validity_months: z.coerce.number().int().positive().max(120).optional(),
    badge_color: z.string().max(20).optional(),
    display_order: z.coerce.number().int().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

const questionBody = z
  .object({
    question: z.string().min(1).max(500),
    help_text: z.string().max(1000).nullable().optional(),
    field_type: z.enum(["text", "textarea", "select", "boolean"]).optional(),
    options: z.array(z.string().max(200)).max(20).nullable().optional(),
    weight: z.coerce.number().min(0).max(100).optional(),
    is_required: z.boolean().optional(),
    display_order: z.coerce.number().int().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();
const questionPatch = questionBody.partial();

const addOffersBody = z
  .object({ stylist_ids: z.array(z.string().uuid()).min(1).max(20) })
  .strict();

const disputeBody = z
  .object({
    action: z.enum(["open", "resolve"]),
    reason: z.string().max(2000).optional(),
    resolution: z.string().max(2000).optional(),
    outcome: z.enum(["release", "uphold"]).optional(),
  })
  .strict();

const reviewVisibilityBody = z.object({ hidden: z.boolean() }).strict();

const forgotBody = z.object({ email: z.string().email() }).strict();
const resetBody = z
  .object({ token: z.string().min(16).max(200), password: z.string().min(8).max(200) })
  .strict();

const myProfilePatch = z
  .object({
    bio: z.string().max(2000).optional(),
    portfolio_url: z.string().url().max(500).optional(),
    instagram_url: z.string().url().max(500).optional(),
    youtube_url: z.string().url().max(500).optional(),
    website_url: z.string().url().max(500).optional(),
    city: z.string().min(1).max(120).optional(),
    state: z.string().max(120).optional(),
    country_code: z.string().min(2).max(3).optional(),
    latitude: z.coerce.number().optional(),
    longitude: z.coerce.number().optional(),
    service_radius_km: z.coerce.number().int().positive().max(1000).optional(),
  })
  .strict();

const myPayoutDetailsPatch = z
  .object({
    payout_currency: z.string().length(3).optional(),
    payout_bank_name: z.string().min(1).max(160).optional(),
    payout_account_number: z.string().min(4).max(64).optional(),
    payout_account_name: z.string().min(1).max(160).optional(),
  })
  .strict();

const referralLinkBody = z
  .object({
    label: z.string().max(120).optional(),
    target_path: z
      .string()
      .max(300)
      .regex(/^\//, "target_path must start with /")
      .optional(),
  })
  .strict();

const contractSignBody = z
  .object({
    signature_image: z
      .string()
      .regex(/^data:image\/(png|jpeg);base64,/, "PNG/JPEG data URL required")
      .max(3_000_000),
  })
  .strict();

const mk = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body || {});
  next();
};

module.exports = {
  validatePartnerCreate: mk(partnerCreate),
  validatePartnerUpdate: mk(partnerUpdate),
  validateStatusChange: mk(statusChange),
  validateSpecialitySet: mk(specialitySet),
  validateCertAward: mk(certAward),
  validateAssignmentOpen: mk(assignmentOpen),
  validatePayoutGenerate: mk(payoutGenerate),
  validateRating: mk(ratingBody),
  validateReason: mk(reasonBody),
  validatePaid: mk(paidBody),
  validateLogin: mk(loginBody),
  validatePublicApply: mk(publicApply),
  validateVettingReview: mk(vettingReview),
  validateApplicationDecision: mk(applicationDecision),
  validateConfigPatch: mk(configPatch),
  validateTierPatch: mk(tierPatch),
  validateQuestionCreate: mk(questionBody),
  validateQuestionPatch: mk(questionPatch),
  validateAddOffers: mk(addOffersBody),
  validateDispute: mk(disputeBody),
  validateReviewVisibility: mk(reviewVisibilityBody),
  validateForgot: mk(forgotBody),
  validateReset: mk(resetBody),
  validateMyProfilePatch: mk(myProfilePatch),
  validateMyPayoutDetails: mk(myPayoutDetailsPatch),
  validateReferralLink: mk(referralLinkBody),
  validateContractSign: mk(contractSignBody),
};
